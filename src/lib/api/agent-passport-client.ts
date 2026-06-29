/**
 * ZeroID — AI Agent Passport v1: frontend API client.
 *
 * Focused v1 client over the shared `apiClient` (kept separate from the large
 * client module). Mirrors the backend AI Agent Identity v1 spec.
 */

import { apiClient } from "./client";

export type AgentScope = "eligibility.read" | "audit.read" | "identity.read";
export type RiskTier = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AgentLifecycleStatus =
  | "ACTIVE"
  | "SUSPENDED"
  | "REVOKED"
  | "PENDING_APPROVAL";

/** v1 controlled scope vocabulary (read-only) — mirrors backend AGENT_SCOPES. */
export const AGENT_SCOPES: AgentScope[] = [
  "eligibility.read",
  "audit.read",
  "identity.read",
];

export interface AIAgentSummary {
  agentDid: string;
  displayName: string;
  status: AgentLifecycleStatus;
  scopes: AgentScope[];
  maxRiskTier: RiskTier;
  controllerDid?: string;
  expiresAt?: string;
}

export interface CreateAIAgentRequest {
  displayName: string;
  agentDid?: string;
  scopes: AgentScope[];
  maxRiskTier: RiskTier;
  expiresAt?: string;
}

export interface CreateAIAgentResponse {
  agentDid: string;
  controllerDid: string;
  credentialId: string;
  status: "ACTIVE";
  scopes: AgentScope[];
  maxRiskTier: RiskTier;
  expiresAt?: string;
}

/** List the AI agents registered for the authenticated controller. */
export async function getAIAgents(authToken?: string): Promise<AIAgentSummary[]> {
  return apiClient.get<AIAgentSummary[]>("/api/v1/ai/agents", undefined, authToken);
}

/** Register a new AI agent passport for the authenticated controller. */
export async function createAIAgent(
  body: CreateAIAgentRequest,
  authToken?: string,
): Promise<CreateAIAgentResponse> {
  return apiClient.post<CreateAIAgentResponse>("/api/v1/ai/agents", body, authToken);
}
