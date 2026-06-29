/**
 * useAIAgents — AI Agent Passport v1 list + registration hooks.
 *
 * Focused v1 hooks (React Query) over the agent-passport client. Kept separate
 * from the richer `useAgentIdentity` to match the constrained v1 surface.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getAIAgents,
  createAIAgent,
  type AIAgentSummary,
  type CreateAIAgentRequest,
  type CreateAIAgentResponse,
} from "@/lib/api/agent-passport-client";

export const AI_AGENTS_QUERY_KEY = ["ai-agents"] as const;

/** List AI agents for the authenticated controller. */
export function useAIAgents(authToken?: string) {
  return useQuery<AIAgentSummary[]>({
    queryKey: AI_AGENTS_QUERY_KEY,
    queryFn: () => getAIAgents(authToken),
  });
}

/** Register a new AI agent passport; invalidates the agents list on success. */
export function useCreateAIAgent(authToken?: string) {
  const queryClient = useQueryClient();
  return useMutation<CreateAIAgentResponse, Error, CreateAIAgentRequest>({
    mutationFn: (body) => createAIAgent(body, authToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AI_AGENTS_QUERY_KEY });
    },
  });
}
