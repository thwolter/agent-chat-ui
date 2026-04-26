import React, {
  createContext,
  useContext,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { createClient, resolveApiUrl } from "./client";
import { toast } from "sonner";
import {
  AuthSession,
  getAgentAssistantId,
  getAgentRouteId,
  REMEMBERED_EMAIL_KEY,
  REMEMBERED_USERNAME_KEY,
  SELECTED_AGENT_ID_KEY,
  SessionAgent,
} from "@/lib/auth";
import { getThreadSearchMetadata } from "@/lib/thread-search-metadata";
import {
  installAuthFetchInterceptor,
  logout,
  refreshAccessToken,
} from "@/lib/auth-client";
import {
  createAssistantAgent,
  loadCreatedAssistants,
  saveCreatedAssistants,
} from "@/lib/created-assistants";

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

type AgentContextType = {
  agents: SessionAgent[];
  baseAgents: SessionAgent[];
  createdAssistants: SessionAgent[];
  selectedAgent: SessionAgent;
  selectedAgentId: string;
  setSelectedAgentId: (agentId: string) => void;
  addCreatedAssistant: (assistant: SessionAgent) => void;
  updateCreatedAssistant: (assistant: SessionAgent) => void;
  removeCreatedAssistant: (assistantId: string) => void;
};
const AgentContext = createContext<AgentContextType | undefined>(undefined);

async function sleep(ms = 4000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkGraphStatus(
  apiUrl: string,
  agentId: string,
): Promise<boolean> {
  const init = { headers: { "x-agent-id": agentId } };
  try {
    const infoResponse = await fetch(`${apiUrl}/info`, init);
    if (infoResponse.ok) return true;

    const healthResponse = await fetch(`${apiUrl}/healthz`, init);
    return healthResponse.ok;
  } catch (e) {
    console.error(e);
    return false;
  }
}

async function loadBackendCreatedAssistants(
  apiProxyUrl: string,
  baseAgents: SessionAgent[],
  userId?: string,
): Promise<SessionAgent[]> {
  const cachedAssistants = loadCreatedAssistants(userId);
  if (!baseAgents.length) return [];

  const assistantGroups = await Promise.allSettled(
    baseAgents.map(async (baseAgent) => {
      const client = createClient(apiProxyUrl, undefined, undefined, {
        "x-agent-id": baseAgent.id,
      });
      const assistants = await client.assistants.search({
        metadata: {
          created_from_chat_ui: true,
          base_agent_id: baseAgent.id,
        },
        limit: 100,
      });

      return assistants.map((assistant) =>
        createAssistantAgent(baseAgent, assistant),
      );
    }),
  );

  const loadedAssistants = assistantGroups.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  if (!loadedAssistants.length && cachedAssistants.length) {
    return cachedAssistants.filter((assistant) =>
      baseAgents.some((agent) => agent.id === getAgentRouteId(assistant)),
    );
  }

  const seen = new Set<string>();
  const dedupedAssistants = loadedAssistants.filter((assistant) => {
    if (seen.has(assistant.id)) return false;
    seen.add(assistant.id);
    return true;
  });

  saveCreatedAssistants(dedupedAssistants, userId);
  return dedupedAssistants;
}

const StreamSession = ({
  children,
  apiUrl,
  selectedAgent,
}: {
  children: ReactNode;
  apiUrl: string;
  selectedAgent: SessionAgent;
}) => {
  const [threadId, setThreadId] = useQueryState("threadId");
  const { getThreads, setThreads } = useThreads();
  const assistantId = getAgentAssistantId(selectedAgent);
  const routeAgentId = getAgentRouteId(selectedAgent);
  const initialThreadResetDone = useRef(false);

  useEffect(() => {
    if (initialThreadResetDone.current) return;
    initialThreadResetDone.current = true;
    setThreadId(null);
  }, [setThreadId]);

  const streamValue = useTypedStream({
    apiUrl,
    assistantId,
    defaultHeaders: {
      "x-agent-id": routeAgentId,
    },
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

  const streamValueWithMetadata = useMemo(
    () =>
      new Proxy(streamValue, {
        get(target, prop, receiver) {
          if (prop === "submit") {
            return (
              values: Parameters<typeof target.submit>[0],
              options?: Parameters<typeof target.submit>[1],
            ) =>
              target.submit(values, {
                ...options,
                metadata: {
                  ...getThreadSearchMetadata(assistantId),
                  agent_id: selectedAgent.id,
                  agent_key: selectedAgent.key,
                  agent_name: selectedAgent.name,
                  route_agent_id: routeAgentId,
                  ...(options?.metadata ?? {}),
                },
              });
          }

          return Reflect.get(target, prop, receiver);
        },
      }),
    [assistantId, routeAgentId, selectedAgent, streamValue],
  );

  useEffect(() => {
    checkGraphStatus(apiUrl, routeAgentId).then((ok) => {
      if (!ok) {
        toast.error("Failed to connect to gateway proxy", {
          description: () => (
            <p>
              Please ensure the backend is reachable through{" "}
              <code>{apiUrl}</code>.
            </p>
          ),
          duration: 10000,
          richColors: true,
          closeButton: true,
        });
      }
    });
  }, [apiUrl, routeAgentId]);

  return (
    <StreamContext.Provider value={streamValueWithMetadata}>
      {children}
    </StreamContext.Provider>
  );
};

export const StreamProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const apiProxyUrl = process.env.NEXT_PUBLIC_API_PROXY_URL || "/api";
  const resolvedApiProxyUrl = resolveApiUrl(apiProxyUrl);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [createdAssistants, setCreatedAssistants] = useState<SessionAgent[]>(
    [],
  );
  const [rememberedEmail, setRememberedEmail] = useState("");
  const [selectedAgentId, setSelectedAgentIdState] = useState("");
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const rememberedEmail =
        window.localStorage.getItem(REMEMBERED_EMAIL_KEY) ||
        window.localStorage.getItem(REMEMBERED_USERNAME_KEY);
      if (rememberedEmail) setRememberedEmail(rememberedEmail);
      const rememberedAgentId = window.localStorage.getItem(
        SELECTED_AGENT_ID_KEY,
      );
      if (rememberedAgentId) setSelectedAgentIdState(rememberedAgentId);
    } catch {
      // no-op
    }
  }, []);

  const setSelectedAgentId = (agentId: string) => {
    setSelectedAgentIdState(agentId);
    try {
      window.localStorage.setItem(SELECTED_AGENT_ID_KEY, agentId);
    } catch {
      // no-op
    }
  };

  const clearFrontendAuthState = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    setAuthenticated(false);
    setSession(null);
  }, []);

  const refreshSession = useCallback(async () => {
    setSessionLoading(true);
    try {
      const response = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "include",
      });
      const payload = (await response.json()) as AuthSession;
      setSession(payload);
      setAuthenticated(Boolean(payload.authenticated));
      const nextCreatedAssistants = payload.authenticated
        ? await loadBackendCreatedAssistants(
            apiProxyUrl,
            payload.agents,
            payload.user?.id,
          )
        : [];
      setCreatedAssistants(nextCreatedAssistants);

      const selectableAgents = [
        ...payload.agents,
        ...nextCreatedAssistants.filter((assistant) =>
          payload.agents.some(
            (agent) => agent.id === getAgentRouteId(assistant),
          ),
        ),
      ];

      if (selectableAgents.length) {
        setSelectedAgentIdState((current) => {
          if (selectableAgents.some((agent) => agent.id === current)) {
            return current;
          }
          let rememberedAgentId: string | null = null;
          try {
            rememberedAgentId = window.localStorage.getItem(
              SELECTED_AGENT_ID_KEY,
            );
          } catch {
            // no-op
          }
          if (
            rememberedAgentId &&
            selectableAgents.some((agent) => agent.id === rememberedAgentId)
          ) {
            return rememberedAgentId;
          }
          return selectableAgents[0].id;
        });
      }
    } catch {
      clearFrontendAuthState();
    } finally {
      setSessionLoading(false);
    }
  }, [apiProxyUrl, clearFrontendAuthState]);

  useEffect(() => {
    refreshSession().catch(console.error);
  }, [refreshSession]);

  useEffect(() => {
    installAuthFetchInterceptor();
    window.addEventListener("auth:required", clearFrontendAuthState);
    return () => {
      window.removeEventListener("auth:required", clearFrontendAuthState);
    };
  }, [clearFrontendAuthState]);

  useEffect(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (!authenticated || !session?.expiresAt) return;

    const refreshDelay = Math.max(session.expiresAt - Date.now() - 60000, 0);
    refreshTimerRef.current = setTimeout(() => {
      refreshAccessToken()
        .then(() => refreshSession())
        .catch(() => clearFrontendAuthState());
    }, refreshDelay);

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [
    authenticated,
    clearFrontendAuthState,
    refreshSession,
    session?.expiresAt,
  ]);

  const baseAgents = useMemo(() => session?.agents ?? [], [session?.agents]);
  const agents = useMemo(() => {
    const allowedRouteIds = new Set(baseAgents.map((agent) => agent.id));
    const filteredCreatedAssistants = createdAssistants.filter((assistant) =>
      allowedRouteIds.has(getAgentRouteId(assistant)),
    );
    const seen = new Set<string>();
    return [...baseAgents, ...filteredCreatedAssistants].filter((agent) => {
      if (seen.has(agent.id)) return false;
      seen.add(agent.id);
      return true;
    });
  }, [baseAgents, createdAssistants]);

  const addCreatedAssistant = useCallback(
    (assistant: SessionAgent) => {
      setCreatedAssistants((current) => {
        const next = [
          assistant,
          ...current.filter((item) => item.id !== assistant.id),
        ];
        saveCreatedAssistants(next, session?.user?.id);
        return next;
      });
      setSelectedAgentId(assistant.id);
    },
    [session?.user?.id],
  );

  const updateCreatedAssistant = useCallback(
    (assistant: SessionAgent) => {
      setCreatedAssistants((current) => {
        const next = current.map((item) =>
          item.id === assistant.id ? assistant : item,
        );
        saveCreatedAssistants(next, session?.user?.id);
        return next;
      });
    },
    [session?.user?.id],
  );

  const removeCreatedAssistant = useCallback(
    (assistantId: string) => {
      setCreatedAssistants((current) => {
        const next = current.filter((item) => item.id !== assistantId);
        saveCreatedAssistants(next, session?.user?.id);
        return next;
      });
      setSelectedAgentIdState((currentSelectedAgentId) => {
        if (currentSelectedAgentId !== assistantId)
          return currentSelectedAgentId;
        const fallbackAgentId = baseAgents[0]?.id ?? "";
        try {
          if (fallbackAgentId) {
            window.localStorage.setItem(SELECTED_AGENT_ID_KEY, fallbackAgentId);
          } else {
            window.localStorage.removeItem(SELECTED_AGENT_ID_KEY);
          }
        } catch {
          // no-op
        }
        return fallbackAgentId;
      });
    },
    [baseAgents, session?.user?.id],
  );

  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];

  if (sessionLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        Loading...
      </div>
    );
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
              const email = String(formData.get("email") || "");
              const password = String(formData.get("password") || "");

              const response = await fetch("/api/auth/login", {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  email,
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
                window.localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
                window.localStorage.removeItem(REMEMBERED_USERNAME_KEY);
                setRememberedEmail(email);
              } catch {
                // no-op
              }

              await refreshSession();
            }}
            className="bg-muted/50 flex flex-col gap-6 p-6"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">
                Email<span className="text-rose-500">*</span>
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                className="bg-background"
                defaultValue={rememberedEmail || session?.user?.email || ""}
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

  if (!selectedAgent) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center p-4">
        <div className="bg-background flex w-full max-w-lg flex-col gap-3 rounded-xl border p-6 shadow-lg">
          <h1 className="text-xl font-semibold tracking-tight">
            No agents available
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Your account is authenticated, but the gateway did not return any
            agents for this user.
          </p>
          <Button
            variant="outline"
            onClick={async () => {
              await logout();
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <AgentContext.Provider
      value={{
        agents,
        baseAgents,
        createdAssistants,
        selectedAgent,
        selectedAgentId: selectedAgent.id,
        setSelectedAgentId,
        addCreatedAssistant,
        updateCreatedAssistant,
        removeCreatedAssistant,
      }}
    >
      <StreamSession
        apiUrl={resolvedApiProxyUrl}
        selectedAgent={selectedAgent}
      >
        {children}
      </StreamSession>
    </AgentContext.Provider>
  );
};

export const useStreamContext = (): StreamContextType => {
  const context = useContext(StreamContext);
  if (context === undefined) {
    throw new Error("useStreamContext must be used within a StreamProvider");
  }

  return context;
};

export const useAgentContext = (): AgentContextType => {
  const context = useContext(AgentContext);
  if (context === undefined) {
    throw new Error("useAgentContext must be used within a StreamProvider");
  }

  return context;
};

export default StreamContext;
