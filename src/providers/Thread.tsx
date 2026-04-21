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
import { AuthSession } from "@/lib/auth";

interface ThreadContextType {
  getThreads: () => Promise<Thread[]>;
  threads: Thread[];
  setThreads: Dispatch<SetStateAction<Thread[]>>;
  threadsLoading: boolean;
  setThreadsLoading: Dispatch<SetStateAction<boolean>>;
}

const ThreadContext = createContext<ThreadContextType | undefined>(undefined);

export function ThreadProvider({ children }: { children: ReactNode }) {
  const apiProxyUrl = process.env.NEXT_PUBLIC_API_PROXY_URL || "/api";

  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);

  const getThreads = useCallback(async (): Promise<Thread[]> => {
    const sessionResponse = await fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "include",
    });
    const session = (await sessionResponse.json()) as AuthSession;
    if (!session.authenticated || session.agents.length === 0) return [];

    const threadGroups = await Promise.all(
      session.agents.map(async (agent) => {
        const client = createClient(apiProxyUrl, undefined, undefined, {
          "x-agent-id": agent.id,
        });
        const agentThreads = await client.threads.search({
          limit: 100,
        });

        return agentThreads.map((thread) => ({
          ...thread,
          metadata: {
            ...(thread.metadata ?? {}),
            agent_id:
              typeof thread.metadata?.agent_id === "string"
                ? thread.metadata.agent_id
                : agent.id,
            agent_key:
              typeof thread.metadata?.agent_key === "string"
                ? thread.metadata.agent_key
                : agent.key,
            agent_name:
              typeof thread.metadata?.agent_name === "string"
                ? thread.metadata.agent_name
                : agent.name,
          },
        }));
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
