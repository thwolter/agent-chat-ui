import {
  CREATED_ASSISTANTS_KEY,
  SessionAgent,
  getAgentRouteId,
} from "@/lib/auth";
import type { Assistant } from "@langchain/langgraph-sdk";

export function getCreatedAssistantId(
  baseAgentId: string,
  assistantId: string,
): string {
  return `assistant:${baseAgentId}:${assistantId}`;
}

export function createAssistantAgent(
  baseAgent: SessionAgent,
  assistant: Assistant,
): SessionAgent {
  const routeAgentId = getAgentRouteId(baseAgent);
  return {
    id: getCreatedAssistantId(routeAgentId, assistant.assistant_id),
    key: assistant.assistant_id,
    name: assistant.name || `${baseAgent.name} Assistant`,
    description: assistant.description ?? null,
    url: baseAgent.url,
    assistant_id: assistant.assistant_id,
    graph_id: assistant.graph_id,
    route_agent_id: routeAgentId,
    is_created_assistant: true,
  };
}

function getStorageKey(userId?: string): string {
  return userId ? `${CREATED_ASSISTANTS_KEY}:${userId}` : CREATED_ASSISTANTS_KEY;
}

export function loadCreatedAssistants(userId?: string): SessionAgent[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(getStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SessionAgent => {
      return (
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.url === "string" &&
        typeof item.assistant_id === "string" &&
        typeof item.route_agent_id === "string"
      );
    });
  } catch {
    return [];
  }
}

export function saveCreatedAssistants(
  assistants: SessionAgent[],
  userId?: string,
) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      getStorageKey(userId),
      JSON.stringify(assistants),
    );
  } catch {
    // no-op
  }
}
