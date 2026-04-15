import React, { createContext, useContext, ReactNode, useEffect, useState } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import { type Message } from "@langchain/langgraph-sdk";
import {
  uiMessageReducer,
  isUIMessage,
  isRemoveUIMessage,
  type UIMessage,
  type RemoveUIMessage,
} from "@langchain/langgraph-sdk/react-ui";
import { useQueryState } from "nuqs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ArrowRight } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { useThreads } from "./Thread";
import { resolveApiUrl } from "./client";
import { toast } from "sonner";
import {
  REMEMBERED_BACKEND_URL_KEY,
  REMEMBERED_USERNAME_KEY,
} from "@/lib/auth";
import { getThreadSearchMetadata } from "@/lib/thread-search-metadata";

export type StateType = { messages: Message[]; ui?: UIMessage[] };

const useTypedStream = useStream<
  StateType,
  {
    UpdateType: {
      messages?: Message[] | Message | string;
      ui?: (UIMessage | RemoveUIMessage)[] | UIMessage | RemoveUIMessage;
      context?: Record<string, unknown>;
    };
    CustomEventType: UIMessage | RemoveUIMessage;
  }
>;

type StreamContextType = ReturnType<typeof useTypedStream>;
const StreamContext = createContext<StreamContextType | undefined>(undefined);

type SessionResponse = {
  authenticated: boolean;
  backendUrl?: string | null;
  expiresAt?: number | null;
  user?: {
    user_id: number;
    username: string;
    is_admin: boolean;
    panels: string[];
  };
};

async function sleep(ms = 4000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkGraphStatus(apiUrl: string): Promise<boolean> {
  try {
    const infoResponse = await fetch(`${apiUrl}/info`);
    if (infoResponse.ok) return true;

    const healthResponse = await fetch(`${apiUrl}/healthz`);
    return healthResponse.ok;
  } catch (e) {
    console.error(e);
    return false;
  }
}

const StreamSession = ({
  children,
  apiUrl,
  assistantId,
}: {
  children: ReactNode;
  apiUrl: string;
  assistantId: string;
}) => {
  const [threadId, setThreadId] = useQueryState("threadId");
  const { getThreads, setThreads } = useThreads();

  const streamValue = useTypedStream({
    apiUrl,
    assistantId,
    threadId: threadId ?? null,
    fetchStateHistory: true,
    onCustomEvent: (event, options) => {
      if (isUIMessage(event) || isRemoveUIMessage(event)) {
        options.mutate((prev) => {
          const ui = uiMessageReducer(prev.ui ?? [], event);
          return { ...prev, ui };
        });
      }
    },
    onThreadId: (id) => {
      setThreadId(id);
      sleep().then(() => getThreads().then(setThreads).catch(console.error));
    },
  });

  const streamValueWithMetadata = {
    ...streamValue,
    submit: (values: Parameters<typeof streamValue.submit>[0], options?: Parameters<typeof streamValue.submit>[1]) =>
      streamValue.submit(values, {
        ...options,
        metadata: {
          ...getThreadSearchMetadata(assistantId),
          ...(options?.metadata ?? {}),
        },
      }),
  };

  useEffect(() => {
    checkGraphStatus(apiUrl).then((ok) => {
      if (!ok) {
        toast.error("Failed to connect to gateway proxy", {
          description: () => (
            <p>
              Please ensure the backend is reachable through <code>{apiUrl}</code>.
            </p>
          ),
          duration: 10000,
          richColors: true,
          closeButton: true,
        });
      }
    });
  }, [apiUrl]);

  return (
    <StreamContext.Provider value={streamValueWithMetadata}>
      {children}
    </StreamContext.Provider>
  );
};

const DEFAULT_BACKEND_URL = "http://localhost:8123";
const DEFAULT_ASSISTANT_ID = "agent";

export const StreamProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const envAssistantId: string | undefined =
    process.env.NEXT_PUBLIC_ASSISTANT_ID;
  const apiProxyUrl = process.env.NEXT_PUBLIC_API_PROXY_URL || "/api";
  const resolvedApiProxyUrl = resolveApiUrl(apiProxyUrl);
  const [assistantId, setAssistantId] = useQueryState("assistantId", {
    defaultValue: envAssistantId || DEFAULT_ASSISTANT_ID,
  });
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [rememberedBackendUrl, setRememberedBackendUrl] = useState("");
  const [rememberedUsername, setRememberedUsername] = useState("");

  useEffect(() => {
    try {
      const remembered = window.localStorage.getItem(REMEMBERED_BACKEND_URL_KEY);
      if (remembered) setRememberedBackendUrl(remembered);
      const rememberedUser = window.localStorage.getItem(REMEMBERED_USERNAME_KEY);
      if (rememberedUser) setRememberedUsername(rememberedUser);
    } catch {
      // no-op
    }
  }, []);

  const refreshSession = async () => {
    setSessionLoading(true);
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const payload = (await response.json()) as SessionResponse;
      setSession(payload);
      setAuthenticated(Boolean(payload.authenticated));

      if (payload.backendUrl) {
        try {
          window.localStorage.setItem(REMEMBERED_BACKEND_URL_KEY, payload.backendUrl);
          setRememberedBackendUrl(payload.backendUrl);
        } catch {
          // no-op
        }
      }
    } catch {
      setAuthenticated(false);
      setSession(null);
    } finally {
      setSessionLoading(false);
    }
  };

  useEffect(() => {
    refreshSession().catch(console.error);
  }, []);

  const finalAssistantId = assistantId || envAssistantId || DEFAULT_ASSISTANT_ID;

  if (sessionLoading) {
    return <div className="flex min-h-screen items-center justify-center">Loading...</div>;
  }

  if (!authenticated) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center p-4">
        <div className="animate-in fade-in-0 zoom-in-95 bg-background flex w-full max-w-xl flex-col rounded-xl border shadow-lg">
          <div className="mt-8 flex flex-col gap-1 border-b p-6">
            <h1 className="text-2xl font-semibold tracking-tight">
              Agent Chat UI
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Sign in with your gateway account to continue chatting with your
              assistant.
            </p>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();

              const form = e.target as HTMLFormElement;
              const formData = new FormData(form);
              const backendUrl = String(formData.get("backendUrl") || "");
              const username = String(formData.get("username") || "");
              const password = String(formData.get("password") || "");
              const nextAssistantId = String(formData.get("assistantId") || "");

              const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  backendUrl,
                  username,
                  password,
                }),
              });
              const payload = (await response.json()) as { error?: string };

              if (!response.ok) {
                toast.error("Authentication failed", {
                  description: payload.error || "Login request failed.",
                });
                return;
              }

              try {
                window.localStorage.setItem(REMEMBERED_BACKEND_URL_KEY, backendUrl);
                setRememberedBackendUrl(backendUrl);
                window.localStorage.setItem(REMEMBERED_USERNAME_KEY, username);
                setRememberedUsername(username);
              } catch {
                // no-op
              }

              setAssistantId(nextAssistantId || DEFAULT_ASSISTANT_ID);
              await refreshSession();
            }}
            className="bg-muted/50 flex flex-col gap-6 p-6"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">
                Username<span className="text-rose-500">*</span>
              </Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                className="bg-background"
                defaultValue={rememberedUsername || session?.user?.username || ""}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">
                Password<span className="text-rose-500">*</span>
              </Label>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="current-password"
                className="bg-background"
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="backendUrl">
                Backend URL<span className="text-rose-500">*</span>
              </Label>
              <p className="text-muted-foreground text-sm">
                Gateway base URL, for example <code>http://localhost:8123</code>.
              </p>
              <Input
                id="backendUrl"
                name="backendUrl"
                className="bg-background"
                defaultValue={
                  rememberedBackendUrl ||
                  session?.backendUrl ||
                  DEFAULT_BACKEND_URL
                }
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="assistantId">
                Assistant / Graph ID<span className="text-rose-500">*</span>
              </Label>
              <Input
                id="assistantId"
                name="assistantId"
                className="bg-background"
                defaultValue={finalAssistantId}
                required
              />
            </div>

            <div className="mt-2 flex justify-end">
              <Button
                type="submit"
                size="lg"
              >
                Sign in
                <ArrowRight className="size-5" />
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <StreamSession
      apiUrl={resolvedApiProxyUrl}
      assistantId={finalAssistantId}
    >
      {children}
    </StreamSession>
  );
};

export const useStreamContext = (): StreamContextType => {
  const context = useContext(StreamContext);
  if (context === undefined) {
    throw new Error("useStreamContext must be used within a StreamProvider");
  }

  return context;
};

export default StreamContext;
