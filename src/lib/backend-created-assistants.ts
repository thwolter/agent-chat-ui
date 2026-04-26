import { createClient } from "@/providers/client";
import { SessionAgent, getAgentRouteId } from "@/lib/auth";
import {
  createAssistantAgent,
  loadCreatedAssistants,
  saveCreatedAssistants,
} from "@/lib/created-assistants";

export async function loadBackendCreatedAssistants(
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
