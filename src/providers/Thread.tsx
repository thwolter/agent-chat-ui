import { Thread } from "@langchain/langgraph-sdk";
import {
  createContext,
  useContext,
  ReactNode,
  useCallback,
  useState,
  Dispatch,
  SetStateAction,
} from "react";
import { createClient } from "./client";
import {
  AuthSession,
  SessionAgent,
  getAgentAssistantId,
  getAgentRouteId,
} from "@/lib/auth";
import { loadBackendCreatedAssistants } from "@/lib/backend-created-assistants";

interface ThreadContextType {
  getThreads: () => Promise<Thread[]>;
  threads: Thread[];
  setThreads: Dispatch<SetStateAction<Thread[]>>;
  threadsLoading: boolean;
  setThreadsLoading: Dispatch<SetStateAction<boolean>>;
}

const ThreadContext = createContext<ThreadContextType | undefined>(undefined);

function resolveThreadAgent(
  thread: Thread,
  fallbackAgent: SessionAgent,
  selectableAgents: SessionAgent[],
): SessionAgent {
  const metadataAgentId =
    typeof thread.metadata?.agent_id === "string"
      ? thread.metadata.agent_id
      : undefined;
  const metadataAssistantId =
    typeof thread.metadata?.assistant_id === "string"
      ? thread.metadata.assistant_id
      : undefined;

  return (
    selectableAgents.find((agent) => agent.id === metadataAgentId) ??
    selectableAgents.find(
      (agent) =>
        agent.assistant_id === metadataAssistantId ||
        getAgentAssistantId(agent) === metadataAssistantId,
    ) ??
    selectableAgents.find(
      (agent) => agent.id === getAgentRouteId(fallbackAgent),
    ) ??
    fallbackAgent
  );
}

export function ThreadProvider({ children }: { children: ReactNode }) {
  const apiProxyUrl = process.env.NEXT_PUBLIC_API_PROXY_URL || "/api";

  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);

  const getThreads = useCallback(async (): Promise<Thread[]> => {
    const sessionResponse = await fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "include",
    });
    const session = (await sessionResponse.json()) as AuthSession;
    if (!session.authenticated || session.agents.length === 0) return [];

    const createdAssistants = await loadBackendCreatedAssistants(
      apiProxyUrl,
      session.agents,
      session.user?.id,
    );
    const selectableAgents = [...session.agents, ...createdAssistants];

    const threadGroups = await Promise.all(
      session.agents.map(async (agent) => {
        const client = createClient(apiProxyUrl, undefined, undefined, {
          "x-agent-id": agent.id,
        });
        const agentThreads = await client.threads.search({
          limit: 100,
        });

        return agentThreads.map((thread) => {
          const threadAgent = resolveThreadAgent(
            thread,
            agent,
            selectableAgents,
          );

          return {
            ...thread,
            metadata: {
              ...(thread.metadata ?? {}),
              agent_id: threadAgent.id,
              agent_key: threadAgent.key,
              agent_name: threadAgent.name,
              route_agent_id: getAgentRouteId(threadAgent),
            },
          };
        });
      }),
    );

    return threadGroups
      .flat()
      .sort((a, b) => {
        const aUpdated = new Date(a.updated_at ?? 0).getTime();
        const bUpdated = new Date(b.updated_at ?? 0).getTime();
        return bUpdated - aUpdated;
      })
      .slice(0, 100);
  }, [apiProxyUrl]);

  const value = {
    getThreads,
    threads,
    setThreads,
    threadsLoading,
    setThreadsLoading,
  };

  return (
    <ThreadContext.Provider value={value}>{children}</ThreadContext.Provider>
  );
}

export function useThreads() {
  const context = useContext(ThreadContext);
  if (context === undefined) {
    throw new Error("useThreads must be used within a ThreadProvider");
  }
  return context;
}
