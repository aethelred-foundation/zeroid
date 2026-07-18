/**
 * Backwards-compatible names for the canonical Agent Identity hooks.
 *
 * The previous "passport v1" hook sent displayName/scopes/maxRiskTier to the
 * Agent Identity registration route. These aliases now use its real contract.
 */

export {
  agentIdentityKeys,
  useAgents as useAIAgents,
  useRegisterAgent as useCreateAIAgent,
} from "@/hooks/useAgentIdentity";

export type {
  AIAgentRecord,
  RegisterAIAgentRequest,
  RegisterAIAgentResult,
} from "@/lib/api/agent-passport-client";
