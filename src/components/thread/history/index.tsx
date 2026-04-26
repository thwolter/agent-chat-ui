import { Button } from "@/components/ui/button";
import { AssistantSettingsDialog } from "@/components/thread/assistant-settings";
import { useAgentContext } from "@/providers/Stream";
import { useThreads } from "@/providers/Thread";
import { Thread } from "@langchain/langgraph-sdk";
import { RefObject, useEffect, useRef, useState } from "react";

import { getContentString } from "../utils";
import { useQueryState, parseAsBoolean } from "nuqs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PanelRightOpen,
  PanelRightClose,
  LogOut,
  Settings,
  UserPlus,
} from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { toast } from "sonner";
import { logout } from "@/lib/auth-client";

function ThreadList({
  threads,
  onThreadClick,
}: {
  threads: Thread[];
  onThreadClick?: (thread: Thread) => void;
}) {
  const [threadId, setThreadId] = useQueryState("threadId");
  const { setSelectedAgentId } = useAgentContext();

  return (
    <div className="flex h-full w-full flex-col items-start justify-start gap-2 overflow-y-scroll [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent">
      {threads.map((t) => {
        let itemText = t.thread_id;
        const agentId =
          typeof t.metadata?.agent_id === "string"
            ? t.metadata.agent_id
            : undefined;
        const agentName =
          typeof t.metadata?.agent_name === "string"
            ? t.metadata.agent_name
            : undefined;
        if (
          typeof t.values === "object" &&
          t.values &&
          "messages" in t.values &&
          Array.isArray(t.values.messages) &&
          t.values.messages?.length > 0
        ) {
          const firstMessage = t.values.messages[0];
          itemText = getContentString(firstMessage.content);
        }
        return (
          <div
            key={`${agentId ?? "unknown"}:${t.thread_id}`}
            className="w-full px-1"
          >
            <Button
              variant="ghost"
              className="w-[280px] items-start justify-start text-left font-normal"
              onClick={(e) => {
                e.preventDefault();
                onThreadClick?.(t);
                if (agentId) setSelectedAgentId(agentId);
                if (t.thread_id === threadId) return;
                setThreadId(t.thread_id);
              }}
            >
              <div className="flex min-w-0 flex-col items-start">
                <p className="max-w-full truncate text-ellipsis">{itemText}</p>
                {agentName && (
                  <p className="text-muted-foreground max-w-full truncate text-xs">
                    {agentName}
                  </p>
                )}
              </div>
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function ThreadHistoryLoading() {
  return (
    <div className="flex h-full w-full flex-col items-start justify-start gap-2 overflow-y-scroll [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent">
      {Array.from({ length: 30 }).map((_, i) => (
        <Skeleton
          key={`skeleton-${i}`}
          className="h-10 w-[280px]"
        />
      ))}
    </div>
  );
}

export default function ThreadHistory() {
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assistantDialogOpen, setAssistantDialogOpen] = useState(false);
  const desktopSettingsMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileSettingsMenuRef = useRef<HTMLDivElement | null>(null);
  const [chatHistoryOpen, setChatHistoryOpen] = useQueryState(
    "chatHistoryOpen",
    parseAsBoolean.withDefault(false),
  );

  const { getThreads, threads, setThreads, threadsLoading, setThreadsLoading } =
    useThreads();

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      toast.error("Failed to log out");
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    setThreadsLoading(true);
    getThreads()
      .then(setThreads)
      .catch(console.error)
      .finally(() => setThreadsLoading(false));
  }, [getThreads, setThreads, setThreadsLoading]);

  useEffect(() => {
    if (!settingsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const isInDesktopMenu = desktopSettingsMenuRef.current?.contains(target);
      const isInMobileMenu = mobileSettingsMenuRef.current?.contains(target);
      if (!isInDesktopMenu && !isInMobileMenu) {
        setSettingsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsOpen]);

  const renderSettingsMenu = (ref: RefObject<HTMLDivElement | null>) => (
    <div
      ref={ref}
      className="relative"
    >
      <Button
        variant="ghost"
        className="gap-2 px-2"
        onClick={() => setSettingsOpen((open) => !open)}
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={settingsOpen}
      >
        <Settings className="size-4" />
        Settings
      </Button>
      {settingsOpen && (
        <div
          role="menu"
          className="bg-background absolute bottom-full left-0 z-30 mb-2 min-w-56 overflow-hidden rounded-md border shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100"
            onClick={() => {
              setSettingsOpen(false);
              setAssistantDialogOpen(true);
            }}
          >
            <UserPlus className="size-4" />
            Manage assistants
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <AssistantSettingsDialog
        open={assistantDialogOpen}
        onOpenChange={setAssistantDialogOpen}
      />
      <div className="shadow-inner-right hidden h-screen w-[300px] shrink-0 flex-col items-start justify-start border-r-[1px] border-slate-300 lg:flex">
        <div className="flex w-full items-center justify-between px-4 pt-1.5">
          <Button
            className="hover:bg-gray-100"
            variant="ghost"
            onClick={() => setChatHistoryOpen((p) => !p)}
          >
            {chatHistoryOpen ? (
              <PanelRightOpen className="size-5" />
            ) : (
              <PanelRightClose className="size-5" />
            )}
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">
            Thread History
          </h1>
        </div>
        <div className="min-h-0 w-full flex-1 px-0 pt-6">
          {threadsLoading ? (
            <ThreadHistoryLoading />
          ) : (
            <ThreadList threads={threads} />
          )}
        </div>
        <div className="flex w-full items-center justify-between gap-2 border-t px-3 py-3">
          {renderSettingsMenu(desktopSettingsMenuRef)}
          <Button
            variant="ghost"
            className="justify-end gap-2 px-2"
            onClick={handleLogout}
          >
            <LogOut className="size-4" />
            Log out
          </Button>
        </div>
      </div>
      <div className="lg:hidden">
        <Sheet
          open={!!chatHistoryOpen && !isLargeScreen}
          onOpenChange={(open) => {
            if (isLargeScreen) return;
            setChatHistoryOpen(open);
          }}
        >
          <SheetContent
            side="left"
            className="flex lg:hidden"
          >
            <SheetHeader>
              <SheetTitle>Thread History</SheetTitle>
            </SheetHeader>
            <div className="mt-4 flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                <ThreadList
                  threads={threads}
                  onThreadClick={() => setChatHistoryOpen((o) => !o)}
                />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
                {renderSettingsMenu(mobileSettingsMenuRef)}
                <Button
                  variant="ghost"
                  className="justify-end gap-2 px-2"
                  onClick={handleLogout}
                >
                  <LogOut className="size-4" />
                  Log out
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
