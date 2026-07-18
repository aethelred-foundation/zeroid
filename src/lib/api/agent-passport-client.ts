/**
 * Strict client for the authenticated AI Agent Identity routes.
 *
 * The backend response is treated as untrusted input. Missing or malformed
 * identity, lifecycle, key, time, capability, or statistics fields reject the
 * response instead of being replaced with plausible-looking UI defaults.
 */

import { apiClient } from "./client";

export const AGENT_PROTOCOLS = [
  "openai_functions",
  "anthropic_tool_use",
  "google_genai",
  "aethelred_native",
  "custom",
] as const;

export const AGENT_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

export type AgentProtocol = (typeof AGENT_PROTOCOLS)[number];
export type AgentRiskLevel = (typeof AGENT_RISK_LEVELS)[number];
export type AgentLifecycleStatus =
  | "pending"
  | "active"
  | "suspended"
  | "revoked";

export interface AIAgentCapability {
  name: string;
  description: string;
  resourceTypes: string[];
  actions: string[];
  riskLevel: AgentRiskLevel;
  requiresApproval: boolean;
  rateLimit?: {
    maxPerHour: number;
    maxPerDay: number;
  };
}

export interface AIAgentStats {
  totalActions: number;
  actionsToday: number;
  successRate: number;
  averageLatencyMs: number;
  anomalyCount: number;
  lastAnomalyAt?: string;
}

export interface AIAgentRecord {
  agentId: string;
  did: string;
  operatorId: string;
  agentName: string;
  agentDescription: string;
  agentProtocol: AgentProtocol;
  status: AgentLifecycleStatus;
  capabilities: AIAgentCapability[];
  publicKeyHash: string;
  maxDelegationDepth: number;
  teeAttested: boolean;
  teeAttestationId?: string;
  createdAt: string;
  updatedAt: string;
  lastActiveAt?: string;
  stats: AIAgentStats;
  metadata: Record<string, unknown>;
  suspension?: {
    suspendedAt: string;
    suspendedBy: string;
    reason: string;
  };
}

export interface RegisterAIAgentRequest {
  agentName: string;
  agentDescription: string;
  agentProtocol: AgentProtocol;
  capabilities: AIAgentCapability[];
  publicKey: string;
  maxDelegationDepth: number;
  /** TEE enrollment is not implemented by the current registration route. */
  teeRequired: false;
  metadata?: Record<string, unknown>;
}

export interface RegisterAIAgentResult {
  agentId: string;
  did: string;
  agentName: string;
  status: AgentLifecycleStatus;
  protocol: AgentProtocol;
  capabilities: Array<
    Pick<AIAgentCapability, "name" | "riskLevel" | "requiresApproval">
  >;
  maxDelegationDepth: number;
  createdAt: string;
}

export interface SuspendAIAgentResult {
  agentId: string;
  status: "suspended";
  suspendedAt: string;
  suspendedBy: string;
  reason: string;
}

export interface AgentApproval {
  id: string;
  requestId: string;
  agentId: string;
  operatorId: string;
  action: string;
  actionType: string;
  actionDescription: string;
  resourceType: string;
  resourceId: string;
  riskLevel: AgentRiskLevel;
  riskScore: number;
  context: Record<string, unknown>;
  status: "pending";
  requestedAt: string;
  createdAt: string;
  expiresAt: string;
}

export interface ResolveAgentApprovalResult {
  requestId: string;
  agentId: string;
  action: string;
  status: "approved" | "rejected";
  respondedAt: string;
  respondedBy: string;
}

const AGENT_API_BASE = "/api/v1/ai/agents";
const PUBLIC_KEY_HASH_PATTERN = /^[0-9a-f]{64}$/i;

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context}.${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context}.${key} must be a non-empty string when set.`);
  }
  return value;
}

function requiredIsoDate(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = requiredString(record, key, context);
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${context}.${key} must be an ISO date string.`);
  }
  return value;
}

function optionalIsoDate(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string | undefined {
  const value = optionalString(record, key, context);
  if (value !== undefined && !Number.isFinite(Date.parse(value))) {
    throw new Error(`${context}.${key} must be an ISO date string when set.`);
  }
  return value;
}

function requiredBoolean(
  record: Record<string, unknown>,
  key: string,
  context: string,
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`${context}.${key} must be a boolean.`);
  }
  return value;
}

function requiredFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  context: string,
  minimum = 0,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${context}.${key} must be a finite number >= ${minimum}.`);
  }
  return value;
}

function requiredInteger(
  record: Record<string, unknown>,
  key: string,
  context: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const value = record[key];
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new Error(
      `${context}.${key} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value as number;
}

function requiredStringArray(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string[] {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    throw new Error(`${context}.${key} must be a non-empty string array.`);
  }
  return [...value] as string[];
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  context: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${context} has an unsupported value.`);
  }
  return value as T;
}

function normalizeMetadata(value: unknown, context: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  return { ...(value as Record<string, unknown>) };
}

export function normalizeAIAgentCapability(
  value: unknown,
  context = "agent.capability",
): AIAgentCapability {
  const record = asRecord(value, context);
  const rateLimitValue = record.rateLimit;
  let rateLimit: AIAgentCapability["rateLimit"];
  if (rateLimitValue !== undefined) {
    const rateLimitRecord = asRecord(rateLimitValue, `${context}.rateLimit`);
    rateLimit = {
      maxPerHour: requiredInteger(
        rateLimitRecord,
        "maxPerHour",
        `${context}.rateLimit`,
        1,
      ),
      maxPerDay: requiredInteger(
        rateLimitRecord,
        "maxPerDay",
        `${context}.rateLimit`,
        1,
      ),
    };
  }

  return {
    name: requiredString(record, "name", context),
    description: requiredString(record, "description", context),
    resourceTypes: requiredStringArray(record, "resourceTypes", context),
    actions: requiredStringArray(record, "actions", context),
    riskLevel: oneOf(
      record.riskLevel,
      AGENT_RISK_LEVELS,
      `${context}.riskLevel`,
    ),
    requiresApproval: requiredBoolean(record, "requiresApproval", context),
    ...(rateLimit ? { rateLimit } : {}),
  };
}

function normalizeStats(value: unknown): AIAgentStats {
  const record = asRecord(value, "agent.stats");
  const totalActions = requiredInteger(record, "totalActions", "agent.stats");
  const successRate = requiredFiniteNumber(
    record,
    "successRate",
    "agent.stats",
  );
  if (successRate > 1) {
    throw new Error("agent.stats.successRate must be between 0 and 1.");
  }
  return {
    totalActions,
    actionsToday: requiredInteger(record, "actionsToday", "agent.stats"),
    successRate,
    averageLatencyMs: requiredFiniteNumber(
      record,
      "averageLatencyMs",
      "agent.stats",
    ),
    anomalyCount: requiredInteger(record, "anomalyCount", "agent.stats"),
    lastAnomalyAt: optionalIsoDate(record, "lastAnomalyAt", "agent.stats"),
  };
}

export function normalizeAIAgent(value: unknown): AIAgentRecord {
  const record = asRecord(value, "agent");
  const capabilities = record.capabilities;
  if (!Array.isArray(capabilities)) {
    throw new Error("agent.capabilities must be an array.");
  }

  const publicKeyHash = requiredString(record, "publicKeyHash", "agent");
  if (!PUBLIC_KEY_HASH_PATTERN.test(publicKeyHash)) {
    throw new Error("agent.publicKeyHash must be a SHA-256 hex digest.");
  }

  const suspensionValue = record.suspension;
  let suspension: AIAgentRecord["suspension"];
  if (suspensionValue !== undefined) {
    const suspensionRecord = asRecord(suspensionValue, "agent.suspension");
    suspension = {
      suspendedAt: requiredIsoDate(
        suspensionRecord,
        "suspendedAt",
        "agent.suspension",
      ),
      suspendedBy: requiredString(
        suspensionRecord,
        "suspendedBy",
        "agent.suspension",
      ),
      reason: requiredString(suspensionRecord, "reason", "agent.suspension"),
    };
  }

  return {
    agentId: requiredString(record, "agentId", "agent"),
    did: requiredString(record, "did", "agent"),
    operatorId: requiredString(record, "operatorId", "agent"),
    agentName: requiredString(record, "agentName", "agent"),
    agentDescription: requiredString(record, "agentDescription", "agent"),
    agentProtocol: oneOf(
      record.agentProtocol,
      AGENT_PROTOCOLS,
      "agent.agentProtocol",
    ),
    status: oneOf(
      record.status,
      ["pending", "active", "suspended", "revoked"] as const,
      "agent.status",
    ),
    capabilities: capabilities.map((capability, index) =>
      normalizeAIAgentCapability(capability, `agent.capabilities[${index}]`),
    ),
    publicKeyHash,
    maxDelegationDepth: requiredInteger(
      record,
      "maxDelegationDepth",
      "agent",
      0,
      5,
    ),
    teeAttested: requiredBoolean(record, "teeAttested", "agent"),
    teeAttestationId: optionalString(record, "teeAttestationId", "agent"),
    createdAt: requiredIsoDate(record, "createdAt", "agent"),
    updatedAt: requiredIsoDate(record, "updatedAt", "agent"),
    lastActiveAt: optionalIsoDate(record, "lastActiveAt", "agent"),
    stats: normalizeStats(record.stats),
    metadata: normalizeMetadata(record.metadata, "agent.metadata"),
    ...(suspension ? { suspension } : {}),
  };
}

export function normalizeAIAgentList(value: unknown): AIAgentRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Agent list response must be an array.");
  }
  return value.map(normalizeAIAgent);
}

function normalizeRegistrationResult(value: unknown): RegisterAIAgentResult {
  const record = asRecord(value, "registration");
  const capabilities = record.capabilities;
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    throw new Error("registration.capabilities must be a non-empty array.");
  }
  return {
    agentId: requiredString(record, "agentId", "registration"),
    did: requiredString(record, "did", "registration"),
    agentName: requiredString(record, "agentName", "registration"),
    status: oneOf(
      record.status,
      ["pending", "active", "suspended", "revoked"] as const,
      "registration.status",
    ),
    protocol: oneOf(record.protocol, AGENT_PROTOCOLS, "registration.protocol"),
    capabilities: capabilities.map((value, index) => {
      const capability = asRecord(value, `registration.capabilities[${index}]`);
      return {
        name: requiredString(
          capability,
          "name",
          `registration.capabilities[${index}]`,
        ),
        riskLevel: oneOf(
          capability.riskLevel,
          AGENT_RISK_LEVELS,
          `registration.capabilities[${index}].riskLevel`,
        ),
        requiresApproval: requiredBoolean(
          capability,
          "requiresApproval",
          `registration.capabilities[${index}]`,
        ),
      };
    }),
    maxDelegationDepth: requiredInteger(
      record,
      "maxDelegationDepth",
      "registration",
      0,
      5,
    ),
    createdAt: requiredIsoDate(record, "createdAt", "registration"),
  };
}

function normalizeSuspensionResult(value: unknown): SuspendAIAgentResult {
  const record = asRecord(value, "suspension");
  const status = oneOf(
    record.status,
    ["suspended"] as const,
    "suspension.status",
  );
  return {
    agentId: requiredString(record, "agentId", "suspension"),
    status,
    suspendedAt: requiredIsoDate(record, "suspendedAt", "suspension"),
    suspendedBy: requiredString(record, "suspendedBy", "suspension"),
    reason: requiredString(record, "reason", "suspension"),
  };
}

function normalizeApproval(value: unknown): AgentApproval {
  const record = asRecord(value, "approval");
  return {
    id: requiredString(record, "id", "approval"),
    requestId: requiredString(record, "requestId", "approval"),
    agentId: requiredString(record, "agentId", "approval"),
    operatorId: requiredString(record, "operatorId", "approval"),
    action: requiredString(record, "action", "approval"),
    actionType: requiredString(record, "actionType", "approval"),
    actionDescription: requiredString(record, "actionDescription", "approval"),
    resourceType: requiredString(record, "resourceType", "approval"),
    resourceId: requiredString(record, "resourceId", "approval"),
    riskLevel: oneOf(record.riskLevel, AGENT_RISK_LEVELS, "approval.riskLevel"),
    riskScore: requiredFiniteNumber(record, "riskScore", "approval"),
    context: normalizeMetadata(record.context, "approval.context"),
    status: oneOf(record.status, ["pending"] as const, "approval.status"),
    requestedAt: requiredIsoDate(record, "requestedAt", "approval"),
    createdAt: requiredIsoDate(record, "createdAt", "approval"),
    expiresAt: requiredIsoDate(record, "expiresAt", "approval"),
  };
}

function normalizeApprovalList(value: unknown): AgentApproval[] {
  if (!Array.isArray(value)) {
    throw new Error("Approval queue response must be an array.");
  }
  return value.map(normalizeApproval);
}

function normalizeApprovalResult(value: unknown): ResolveAgentApprovalResult {
  const record = asRecord(value, "approvalResult");
  return {
    requestId: requiredString(record, "requestId", "approvalResult"),
    agentId: requiredString(record, "agentId", "approvalResult"),
    action: requiredString(record, "action", "approvalResult"),
    status: oneOf(
      record.status,
      ["approved", "rejected"] as const,
      "approvalResult.status",
    ),
    respondedAt: requiredIsoDate(record, "respondedAt", "approvalResult"),
    respondedBy: requiredString(record, "respondedBy", "approvalResult"),
  };
}

export async function getAIAgents(authToken: string): Promise<AIAgentRecord[]> {
  return normalizeAIAgentList(
    await apiClient.get<unknown>(AGENT_API_BASE, undefined, authToken),
  );
}

export async function getAIAgent(
  agentId: string,
  authToken: string,
): Promise<AIAgentRecord> {
  return normalizeAIAgent(
    await apiClient.get<unknown>(
      `${AGENT_API_BASE}/${encodeURIComponent(agentId)}`,
      undefined,
      authToken,
    ),
  );
}

export async function createAIAgent(
  body: RegisterAIAgentRequest,
  authToken: string,
): Promise<RegisterAIAgentResult> {
  return normalizeRegistrationResult(
    await apiClient.post<unknown>(AGENT_API_BASE, body, authToken),
  );
}

export async function suspendAIAgent(
  agentId: string,
  reason: string,
  authToken: string,
): Promise<SuspendAIAgentResult> {
  return normalizeSuspensionResult(
    await apiClient.post<unknown>(
      `${AGENT_API_BASE}/${encodeURIComponent(agentId)}/suspend`,
      { reason },
      authToken,
    ),
  );
}

export async function getAgentApprovals(
  authToken: string,
): Promise<AgentApproval[]> {
  return normalizeApprovalList(
    await apiClient.get<unknown>(
      `${AGENT_API_BASE}/approvals`,
      undefined,
      authToken,
    ),
  );
}

export async function respondToAgentApproval(
  requestId: string,
  approved: boolean,
  note: string,
  authToken: string,
): Promise<ResolveAgentApprovalResult> {
  return normalizeApprovalResult(
    await apiClient.post<unknown>(
      `${AGENT_API_BASE}/approvals/${encodeURIComponent(requestId)}`,
      { approved, note },
      authToken,
    ),
  );
}
