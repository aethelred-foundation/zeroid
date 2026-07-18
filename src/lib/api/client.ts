/**
 * ZeroID — API Client
 *
 * HTTP client for communicating with the ZeroID backend service.
 * Provides typed methods for identity, credential, proof, TEE, and
 * governance endpoints. Includes automatic retry, error normalisation,
 * and request tracing.
 */

import type {
  ApiResponse,
  ApiError,
  PaginatedResponse,
  HealthResponse,
  IdentityProfile,
  ZKProof,
  ProofVerification,
  ProofRequest,
  TEEAttestation,
  TEENode,
  Proposal,
  VerificationRequest,
  VerificationResult,
  Bytes32,
  Address,
} from "@/types";
import { ProposalState, ProposalType, VerificationStatus } from "@/types";
import { API_BASE_URL } from "@/config/constants";
import { generateUUID, withRetry, withTimeout } from "@/lib/utils";
import {
  getIdentityAuthToken,
  type BackendIdentityRegistrationPayload,
  type BackendIdentityRegistrationResult,
} from "@/lib/identity/registration";
import { expireIdentitySession } from "@/lib/identity/session";
import {
  normalizeCredentialSummaries,
  normalizeCredentialSummary,
  type CredentialSummary,
} from "@/lib/credentials/summary";
import {
  normalizeSchemaRegistryPage,
  normalizeSchemaRegistryRecord,
  type SchemaGovernanceStatus,
  type SchemaRegistryRecord,
} from "@/lib/schemas/registry";
import type {
  EligibilityDisclosurePolicy,
  EligibilityProofRequest,
  EligibilityProofResponse,
} from "@/lib/eligibility/kycCredential";
import {
  fetchTEENodes,
  requestBiometricEnrollment as requestTEEClientBiometricEnrollment,
  requestBiometricVerification as requestTEEClientBiometricVerification,
  verifyAttestation as verifyTEEAttestation,
} from "@/lib/tee/attestation";

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_AUTH_PATH_PREFIXES = [
  "/api/v1/credentials",
  "/api/v1/verification",
  "/api/v1/governance",
  "/api/v1/audit",
  "/api/v1/enterprise",
  "/api/v1/ai",
  "/api/v1/identity/me",
  "/api/v1/identity/government",
];
const ELIGIBILITY_RECEIPT_ID_PATTERN = /^[A-Za-z0-9._:-]{3,128}$/;
const CREDENTIAL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BackendPagination = {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
};

type BackendResponseEnvelope<T> = Partial<ApiResponse<T>> & {
  data?: T;
  message?: string;
  code?: string;
  details?: Record<string, unknown>;
  pagination?: BackendPagination;
};

type BackendGroth16Proof = {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
};

type BackendVerificationHistoryEntry = {
  id: string;
  verificationType?: string;
  result?: string;
  requestedAt?: string | number | Date;
  completedAt?: string | number | Date | null;
  credentialId?: string;
  verifierId?: string;
  subjectId?: string;
};

type BackendZkVerificationResult = {
  valid?: boolean;
  proofId?: string;
  circuitName?: string;
  verifiedAt?: string | number | Date;
  error?: string;
};

type BackendVerificationRequestRecord = VerificationRequest;

type BackendSchemaGovernanceRecord = {
  id: string;
  name: string;
  version: string;
  description: string;
  schemaDefinition?: unknown;
  proposedBy?: string;
  status?: string;
  approvalVotes?: number;
  rejectionVotes?: number;
  voters?: string[];
  createdAt?: string | number | Date;
  updatedAt?: string | number | Date;
};

// ============================================================================
// Error Class
// ============================================================================

/**
 * Typed error thrown by the API client.
 * Wraps the structured `ApiError` from the backend response.
 */
export class ZeroIDApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly requestId?: string;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message);
    this.name = "ZeroIDApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.requestId = requestId;
  }
}

export interface UAEPassAuthorizationStart {
  authUrl: string;
  state: string;
  expiresInSeconds: number;
}

export interface GovernmentVerificationResult {
  verified: boolean;
  provider: string;
  referenceId: string;
  verifiedFields: string[];
  verifiedAt: string;
  expiresAt: string;
}

export interface IdentityAuthChallenge {
  challengeId: string;
  message: string;
  expiresAt: string;
}

export interface IdentitySessionPrincipal {
  id: string;
  did: string;
  status: string;
}

export interface IdentityAuthSession {
  identity: IdentitySessionPrincipal;
  token: string;
  sessionId: string;
}

export interface EligibilityProofReceipt {
  verificationId: string;
  status: "ALLOWED" | "DENIED" | string;
  decisionId: string;
  policyId: string;
  policyVersion: string;
  credentialId?: string;
  verifierId: string;
  subjectId: string;
  relyingAppId: string;
  proof: {
    proofId: string;
    circuitId: string;
    circuitName: string;
    verificationKeyId: string;
    manifestDigest: `0x${string}` | string;
    sourceDigest?: `0x${string}` | string;
    policyBindingDigest: `0x${string}` | string;
    contextHash: `0x${string}` | string;
    publicSignals: Record<string, unknown>;
    privateInputsRedacted: string[];
    disclosurePolicy: Partial<EligibilityDisclosurePolicy>;
  };
  evidence: {
    receiptHash: `0x${string}` | string;
    receiptHashAlgorithm: "sha256-canonical-json-v1" | string;
    auditLogId?: string;
    auditHash?: `0x${string}` | string;
    auditTimestamp?: string;
    auditDetails?: Record<string, unknown>;
    manifestPath?: string;
    manifestDigest: `0x${string}` | string;
    sourceDigest?: `0x${string}` | string;
    policyBindingDigest: `0x${string}` | string;
    artifactStatus:
      | "SOURCE_VALIDATED_ARTIFACTS_PENDING"
      | "PINNED_PRODUCTION_ARTIFACTS"
      | string;
    teeAttestation?: Record<string, unknown>;
    disclosureBudget?: Record<string, unknown>;
  };
  evaluation: Record<string, unknown>;
  deniedReasons: string[];
  requestedAt: string;
  completedAt?: string;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/** Generate a short random request ID for tracing */
function generateRequestId(): string {
  // generateUUID (not crypto.randomUUID): the latter is missing on plain-HTTP
  // origins, which would crash every API request from a testnet box.
  return `zid-${generateUUID()}`;
}

/** Build a backend URL without allowing absolute/protocol-relative path escape. */
export function buildApiUrl(
  path: string,
  params?: Record<string, string | number>,
): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new ZeroIDApiError(
      "API path must be a same-backend relative path.",
      "API_PATH_INVALID",
      0,
    );
  }

  const baseUrl = new URL(API_BASE_URL);
  const url = new URL(path, API_BASE_URL);
  if (url.origin !== baseUrl.origin) {
    throw new ZeroIDApiError(
      "API path resolved outside the configured backend origin.",
      "API_PATH_INVALID",
      0,
    );
  }

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function shouldAttachStoredAuthToken(path: string): boolean {
  return DEFAULT_AUTH_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function resolveAuthToken(
  path: string,
  explicitToken?: string,
): string | undefined {
  if (explicitToken !== undefined) return explicitToken;
  if (!shouldAttachStoredAuthToken(path)) return undefined;
  return getIdentityAuthToken();
}

/**
 * Core fetch wrapper. Adds auth headers, content-type, request ID,
 * and normalises errors into `ZeroIDApiError` instances.
 */
async function request<T>(
  method: string,
  path: string,
  options: {
    body?: unknown;
    params?: Record<string, string | number>;
    authToken?: string;
    timeoutMs?: number;
  },
): Promise<ApiResponse<T>> {
  const { body, params, authToken, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const requestId = generateRequestId();
  const resolvedAuthToken = resolveAuthToken(path, authToken);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Request-ID": requestId,
    Accept: "application/json",
  };

  if (resolvedAuthToken) {
    headers["Authorization"] = `Bearer ${resolvedAuthToken}`;
  }

  const fetchPromise = fetch(buildApiUrl(path, params), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const response = await withTimeout(
    fetchPromise,
    timeoutMs,
    `ZeroID API request timed out after ${timeoutMs}ms (${method} ${path})`,
  );

  let json: BackendResponseEnvelope<T> | T;
  try {
    json = await response.json();
  } catch {
    throw new ZeroIDApiError(
      `Failed to parse API response (${response.status})`,
      "PARSE_ERROR",
      response.status,
      undefined,
      requestId,
    );
  }

  const payload = json as BackendResponseEnvelope<T>;
  const explicitFailure = payload.success === false;

  if (!response.ok || explicitFailure) {
    const errorPayload = payload.error;
    const error =
      typeof errorPayload === "object" && errorPayload !== null
        ? errorPayload
        : {
            code: payload.code ?? "UNKNOWN",
            message:
              typeof errorPayload === "string"
                ? errorPayload
                : (payload.message ?? response.statusText),
            details: payload.details,
          };
    const normalizedError = new ZeroIDApiError(
      error.message,
      error.code,
      response.status,
      error.details,
      payload.requestId || requestId,
    );

    if (
      response.status === 401 &&
      resolvedAuthToken &&
      getIdentityAuthToken() === resolvedAuthToken &&
      shouldAttachStoredAuthToken(path)
    ) {
      // A protected endpoint rejected the session. Clear it before React (or
      // any other caller) handles the error so no subsequent request can reuse
      // the rejected bearer token.
      expireIdentitySession();
    }

    throw normalizedError;
  }

  const hasDataEnvelope =
    payload &&
    typeof payload === "object" &&
    Object.prototype.hasOwnProperty.call(payload, "data");

  return {
    ...(payload && typeof payload === "object" ? payload : {}),
    success: true,
    data: hasDataEnvelope ? payload.data : (json as T),
    timestamp: payload.timestamp ?? new Date().toISOString(),
    requestId: payload.requestId ?? requestId,
  } as ApiResponse<T>;
}

/** GET with automatic retry */
async function get<T>(
  path: string,
  params?: Record<string, string | number>,
  authToken?: string,
): Promise<T> {
  const result = await withRetry(
    () => request<T>("GET", path, { params, authToken }),
    shouldAttachStoredAuthToken(path) ? 0 : DEFAULT_RETRIES,
  );
  return result.data as T;
}

/** POST (no retry by default — mutations should not be retried blindly) */
async function post<T>(
  path: string,
  body: unknown,
  authToken?: string,
): Promise<T> {
  const result = await request<T>("POST", path, { body, authToken });
  return result.data as T;
}

/** PUT mutation helper */
async function put<T>(
  path: string,
  body: unknown,
  authToken?: string,
): Promise<T> {
  const result = await request<T>("PUT", path, { body, authToken });
  return result.data as T;
}

/** PATCH mutation helper */
async function patch<T>(
  path: string,
  body: unknown,
  authToken?: string,
): Promise<T> {
  const result = await request<T>("PATCH", path, { body, authToken });
  return result.data as T;
}

/** DELETE helper */
async function del<T>(
  path: string,
  body?: unknown,
  authToken?: string,
): Promise<T> {
  const result = await request<T>("DELETE", path, { body, authToken });
  return result.data as T;
}

function toUnixTimestamp(value: unknown): number {
  if (typeof value === "number") {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
  }
  if (typeof value === "string" || value instanceof Date) {
    const time = new Date(value).getTime();
    if (!Number.isNaN(time)) return Math.floor(time / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function toBackendGroth16Proof(proof: ZKProof): BackendGroth16Proof {
  const raw = proof.proof as unknown as Record<string, unknown>;
  const piA = asStringArray(raw.pi_a);
  const piB = Array.isArray(raw.pi_b)
    ? raw.pi_b.filter(Array.isArray).map((row) => row.map(String))
    : undefined;
  const piC = asStringArray(raw.pi_c);
  if (piA && piB && piC) {
    return {
      pi_a: piA,
      pi_b: piB,
      pi_c: piC,
      protocol: String(raw.protocol ?? proof.protocol ?? proof.proofSystem),
      curve: String(raw.curve ?? proof.curve ?? "bn128"),
    };
  }

  if (Array.isArray(raw.a) && Array.isArray(raw.b) && Array.isArray(raw.c)) {
    return {
      pi_a: raw.a.map(String),
      pi_b: raw.b.filter(Array.isArray).map((row) => row.map(String)),
      pi_c: raw.c.map(String),
      protocol: proof.protocol ?? proof.proofSystem,
      curve: proof.curve ?? "bn128",
    };
  }

  throw new ZeroIDApiError(
    "Proof payload is not a supported Groth16 proof shape.",
    "PROOF_SHAPE_UNSUPPORTED",
    400,
  );
}

function getProofContextField(
  proof: ZKProof,
  field: "nonce" | "audience" | "contextCommitment" | "issuedAt",
): string | number | undefined {
  const record = proof as unknown as Record<string, unknown>;
  const value = record[field];
  if (typeof value === "string" || typeof value === "number") return value;
  return undefined;
}

function buildZkVerifyPayload(proof: ZKProof) {
  const nonce = getProofContextField(proof, "nonce");
  const audience = getProofContextField(proof, "audience");
  const contextCommitment = getProofContextField(proof, "contextCommitment");
  const issuedAt = getProofContextField(proof, "issuedAt");
  const publicSignals =
    asStringArray(
      (proof as unknown as Record<string, unknown>).publicSignals,
    ) ?? proof.publicInputs;

  if (
    typeof nonce !== "string" ||
    typeof audience !== "string" ||
    typeof contextCommitment !== "string" ||
    typeof issuedAt !== "number"
  ) {
    throw new ZeroIDApiError(
      "Proof submission requires nonce, audience, issuedAt, and contextCommitment from /api/v1/verification/zk-proof.",
      "PROOF_CONTEXT_REQUIRED",
      400,
    );
  }

  return {
    proof: toBackendGroth16Proof(proof),
    publicSignals,
    circuitName: proof.circuitName,
    nonce,
    audience,
    contextCommitment,
    issuedAt,
  };
}

async function submitZkProof(
  proof: ZKProof,
  authToken: string,
): Promise<ProofVerification> {
  const result = await post<BackendZkVerificationResult>(
    "/api/v1/verification/zk-verify",
    buildZkVerifyPayload(proof),
    authToken,
  );

  return {
    valid: result.valid === true,
    proofHash: (proof.proofHash ??
      proof.hash ??
      `0x${result.proofId ?? proof.id}`) as Bytes32,
    circuitId: proof.circuitId,
    verifiedAt: toUnixTimestamp(result.verifiedAt),
    error: result.error,
  };
}

function historyEntryToVerificationResult(
  entry: BackendVerificationHistoryEntry,
): VerificationResult {
  const verified = entry.result === "VERIFIED";
  return {
    requestId: entry.id,
    verified,
    attributeResults: [],
    verifiedAt: toUnixTimestamp(entry.completedAt ?? entry.requestedAt),
    error: verified ? undefined : entry.result,
  };
}

function didToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "uri" in value) {
    const uri = (value as { uri?: unknown }).uri;
    if (typeof uri === "string") return uri;
  }
  return "";
}

function normalizeVerificationRequestPayload(
  payload: Omit<
    VerificationRequest,
    "id" | "status" | "createdAt" | "userConsent"
  >,
) {
  return {
    ...payload,
    verifierDid: didToString(payload.verifierDid),
    subjectDid: didToString(payload.subjectDid),
  };
}

function verificationRequestToProofRequest(
  requestRecord: VerificationRequest,
): ProofRequest {
  return {
    id: requestRecord.id,
    circuitId: requestRecord.circuitId,
    circuitName: requestRecord.circuitId,
    publicInputs: {
      credentialHash: requestRecord.credentialHash,
      requestedAttributes: requestRecord.requestedAttributes.join(","),
    },
    verifierDid: didToString(
      requestRecord.verifierDid,
    ) as unknown as ProofRequest["verifierDid"],
    purpose: requestRecord.purpose,
    expiresAt: requestRecord.expiresAt,
    fulfilled: requestRecord.status !== VerificationStatus.Pending,
    createdAt: requestRecord.createdAt,
  };
}

function bytes32FromStableString(value: string): Bytes32 {
  const hex = Array.from(value)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 64)
    .padEnd(64, "0");
  return `0x${hex}` as Bytes32;
}

function addressOrZero(value: unknown): Address {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? (value as Address)
    : "0x0000000000000000000000000000000000000000";
}

function schemaStatusToProposalState(
  status: string | undefined,
): ProposalState {
  if (status === "APPROVED") return ProposalState.Succeeded;
  if (status === "DEPRECATED" || status === "REVOKED") {
    return ProposalState.Defeated;
  }
  return ProposalState.Active;
}

function schemaStatusToLegacyStatus(
  status: string | undefined,
): Proposal["status"] {
  if (status === "APPROVED") return "passed";
  if (status === "DEPRECATED" || status === "REVOKED") return "rejected";
  return "active";
}

function schemaGovernanceToProposal(
  schema: BackendSchemaGovernanceRecord,
): Proposal {
  const approvalVotes = schema.approvalVotes ?? 0;
  const rejectionVotes = schema.rejectionVotes ?? 0;
  const createdAt = toUnixTimestamp(schema.createdAt);
  return {
    id: schema.id,
    type: ProposalType.SchemaApproval,
    state: schemaStatusToProposalState(schema.status),
    proposer: addressOrZero(schema.proposedBy),
    targetHash: bytes32FromStableString(`${schema.name}:${schema.version}`),
    title: `${schema.name} ${schema.version}`,
    description: schema.description,
    forVotes: BigInt(approvalVotes),
    againstVotes: BigInt(rejectionVotes),
    abstainVotes: 0n,
    startBlock: 0,
    endBlock: 0,
    createdAt,
    executedAt:
      schema.status === "APPROVED" ? toUnixTimestamp(schema.updatedAt) : 0,
    status: schemaStatusToLegacyStatus(schema.status),
    votesFor: approvalVotes,
    votesAgainst: rejectionVotes,
    votesAbstain: 0,
    quorum: 3,
    endTime: createdAt + 7 * 24 * 60 * 60,
  };
}

// ============================================================================
// Public API Client
// ============================================================================

export const apiClient = {
  get,
  post,
  put,
  patch,
  del,
  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------

  /** Check backend health status */
  async health(): Promise<HealthResponse> {
    return get<HealthResponse>("/api/v1/health");
  },

  // --------------------------------------------------------------------------
  // Identity
  // --------------------------------------------------------------------------

  /** Resolve an identity profile by DID URI */
  async getIdentity(did: string, authToken?: string): Promise<IdentityProfile> {
    return get<IdentityProfile>(
      `/api/v1/identity/resolve/${encodeURIComponent(did)}`,
      undefined,
      authToken,
    );
  },

  /** Fetch an identity profile by controller address */
  async getIdentityByAddress(
    address: Address,
    authToken?: string,
  ): Promise<IdentityProfile | null> {
    return get<IdentityProfile | null>(
      `/api/v1/identity/address/${address}`,
      undefined,
      authToken,
    );
  },

  /** Register a new identity */
  async registerIdentity(
    payload: BackendIdentityRegistrationPayload,
    authToken?: string,
  ): Promise<BackendIdentityRegistrationResult> {
    return post("/api/v1/identity/register", payload, authToken);
  },

  /** Create a short-lived, one-time wallet sign-in challenge. */
  async createIdentityAuthChallenge(
    address: Address,
  ): Promise<IdentityAuthChallenge> {
    return post<IdentityAuthChallenge>("/api/v1/identity/auth/challenge", {
      address,
    });
  },

  /** Exchange a signed one-time challenge for an identity session. */
  async loginWithWallet(payload: {
    challengeId: string;
    signature: `0x${string}`;
  }): Promise<IdentityAuthSession> {
    return post<IdentityAuthSession>("/api/v1/identity/auth/login", payload);
  },

  /** Resolve and validate the principal represented by a bearer session. */
  async getCurrentIdentity(
    authToken?: string,
  ): Promise<IdentitySessionPrincipal> {
    return get<IdentitySessionPrincipal>(
      "/api/v1/identity/me",
      undefined,
      authToken,
    );
  },

  /** Start a UAE Pass OAuth verification session for the current identity */
  async startUAEPassVerification(
    redirectUri: string,
    authToken?: string,
  ): Promise<UAEPassAuthorizationStart> {
    return post<UAEPassAuthorizationStart>(
      "/api/v1/identity/government/uae-pass/start",
      { redirectUri },
      authToken,
    );
  },

  /** Complete a UAE Pass OAuth verification session for the current identity */
  async completeUAEPassVerification(
    payload: { authorizationCode?: string; code?: string; state: string },
    authToken?: string,
  ): Promise<GovernmentVerificationResult> {
    return post<GovernmentVerificationResult>(
      "/api/v1/identity/government/uae-pass/callback",
      payload,
      authToken,
    );
  },

  /** Fetch current government verification status for the authenticated identity */
  async getGovernmentVerificationStatus(
    authToken?: string,
  ): Promise<GovernmentVerificationResult | null> {
    return get<GovernmentVerificationResult | null>(
      "/api/v1/identity/government/status",
      undefined,
      authToken,
    );
  },

  // --------------------------------------------------------------------------
  // Credentials
  // --------------------------------------------------------------------------

  /** List credentials held by the authenticated subject. */
  async listCredentials(
    page = 1,
    pageSize = 12,
    authToken?: string,
  ): Promise<PaginatedResponse<CredentialSummary>> {
    const result = await withRetry(
      () =>
        request<unknown>("GET", "/api/v1/credentials", {
          params: { page, limit: pageSize, role: "subject" },
          authToken,
        }),
      0,
    );
    const pagination = (
      result as ApiResponse<unknown> & {
        pagination?: BackendPagination;
      }
    ).pagination;
    const items = normalizeCredentialSummaries(result.data);
    const resolvedPage = pagination?.page ?? page;
    const resolvedPageSize = pagination?.limit ?? pageSize;
    const total = pagination?.total ?? items.length;

    return {
      items,
      total,
      page: resolvedPage,
      pageSize: resolvedPageSize,
      hasMore: resolvedPage * resolvedPageSize < total,
    };
  },

  /** Get a single credential by its backend UUID. */
  async getCredential(
    credentialId: string,
    authToken?: string,
  ): Promise<CredentialSummary> {
    const normalizedCredentialId = credentialId.trim();
    if (!CREDENTIAL_ID_PATTERN.test(normalizedCredentialId)) {
      throw new ZeroIDApiError(
        "Credential id must be a UUID.",
        "CREDENTIAL_ID_INVALID",
        400,
      );
    }

    return normalizeCredentialSummary(
      await get<unknown>(
        `/api/v1/credentials/${encodeURIComponent(normalizedCredentialId)}`,
        undefined,
        authToken,
      ),
    );
  },

  /** List credential schemas exactly as returned by schema governance. */
  async listSchemas(
    page = 1,
    pageSize = 20,
    filters: { status?: SchemaGovernanceStatus; name?: string } = {},
  ): Promise<PaginatedResponse<SchemaRegistryRecord>> {
    const params: Record<string, string | number> = {
      page,
      limit: pageSize,
    };
    if (filters.status) params.status = filters.status;
    const nameFilter = filters.name?.trim();
    if (nameFilter && nameFilter.length > 100) {
      throw new ZeroIDApiError(
        "Schema name filter cannot exceed 100 characters.",
        "SCHEMA_NAME_FILTER_INVALID",
        400,
      );
    }
    if (nameFilter) params.name = nameFilter;

    // Governance routes are authenticated. Do not retry with a bearer token:
    // a rejected session must fail once and transition the wallet back to the
    // explicit sign-in state.
    const result = await request<unknown[]>(
      "GET",
      "/api/v1/governance/schemas",
      { params },
    );
    const pagination = (
      result as ApiResponse<unknown[]> & { pagination?: unknown }
    ).pagination;

    return normalizeSchemaRegistryPage(result.data, pagination, filters.status);
  },

  /** Get a single schema-governance record by backend UUID. */
  async getSchema(schemaId: string): Promise<SchemaRegistryRecord> {
    return normalizeSchemaRegistryRecord(
      await get<unknown>(
        `/api/v1/governance/schemas/${encodeURIComponent(schemaId)}`,
      ),
    );
  },

  // --------------------------------------------------------------------------
  // Proofs
  // --------------------------------------------------------------------------

  /** Submit a generated proof for backend verification and optional on-chain anchoring */
  async submitProof(
    proof: ZKProof,
    authToken: string,
  ): Promise<ProofVerification> {
    return submitZkProof(proof, authToken);
  },

  /** Fetch pending proof requests for the current user */
  async listProofRequests(
    _subjectDidHash: Bytes32,
    authToken: string,
  ): Promise<ProofRequest[]> {
    const requests = await get<BackendVerificationRequestRecord[]>(
      "/api/v1/verification/requests",
      { role: "subject", result: "PENDING", limit: 100 },
      authToken,
    );
    return requests.map(verificationRequestToProofRequest);
  },

  /** Get a verification result by request ID */
  async getVerificationResult(
    requestId: string,
    authToken?: string,
  ): Promise<VerificationResult> {
    const history = await get<BackendVerificationHistoryEntry[]>(
      "/api/v1/verification/history",
      { limit: 100 },
      authToken,
    );
    const entry = history.find((item) => item.id === requestId);
    if (!entry) {
      throw new ZeroIDApiError(
        "Verification result was not found in recent history.",
        "VERIFICATION_RESULT_NOT_FOUND",
        404,
      );
    }
    return historyEntryToVerificationResult(entry);
  },

  /** Generate the v1 age + jurisdiction eligibility proof decision receipt */
  async generateEligibilityProof(
    payload: EligibilityProofRequest,
    authToken?: string,
  ): Promise<EligibilityProofResponse> {
    return post<EligibilityProofResponse>(
      "/api/v1/verification/eligibility-proof",
      payload,
      authToken,
    );
  },

  /** Retrieve a durable v1 eligibility proof evidence receipt by decision/proof id */
  async getEligibilityProofReceipt(
    receiptId: string,
    authToken?: string,
  ): Promise<EligibilityProofReceipt> {
    const normalizedReceiptId = receiptId.trim();
    if (!ELIGIBILITY_RECEIPT_ID_PATTERN.test(normalizedReceiptId)) {
      throw new ZeroIDApiError(
        "Eligibility receipt id is invalid.",
        "ELIGIBILITY_RECEIPT_ID_INVALID",
        400,
      );
    }

    return get<EligibilityProofReceipt>(
      `/api/v1/verification/eligibility-proof/${encodeURIComponent(
        normalizedReceiptId,
      )}`,
      undefined,
      authToken,
    );
  },

  // --------------------------------------------------------------------------
  // TEE
  // --------------------------------------------------------------------------

  /** List available TEE nodes */
  async listTEENodes(): Promise<TEENode[]> {
    return fetchTEENodes();
  },

  /** Get attestation details for a specific enclave */
  async getAttestation(enclaveHash: Bytes32): Promise<TEEAttestation> {
    return verifyTEEAttestation(enclaveHash);
  },

  /** Request biometric verification via a TEE node */
  async requestBiometricVerification(
    payload: {
      subjectDidHash: Bytes32;
      enclaveHash: Bytes32;
      biometricData: string; // base64-encoded, encrypted for the enclave
      biometricType?: string;
    },
    authToken: string,
  ): Promise<{
    success: boolean;
    verificationId: string;
    status: "verified" | "failed";
    biometricHash?: Bytes32;
    enclaveHash: Bytes32;
    error?: string;
  }> {
    const result = await requestTEEClientBiometricVerification(
      {
        subjectDidHash: payload.subjectDidHash,
        enclaveHash: payload.enclaveHash,
        encryptedBiometricData: payload.biometricData,
        biometricType: payload.biometricType ?? "face",
      },
      authToken,
    );
    return {
      success: result.success,
      verificationId: result.verificationId,
      status: result.success ? "verified" : "failed",
      biometricHash: result.biometricHash,
      enclaveHash: result.enclaveHash,
      error: result.error,
    };
  },

  /** Enroll a biometric template via a TEE node */
  async enrollBiometric(
    payload: {
      subjectDidHash: Bytes32;
      enclaveHash: Bytes32;
      biometricData: string; // base64-encoded, encrypted for the enclave
      biometricType?: string;
    },
    authToken: string,
  ): Promise<{
    success: boolean;
    verificationId: string;
    status: "verified" | "failed";
    biometricHash?: Bytes32;
    enclaveHash: Bytes32;
    error?: string;
  }> {
    const result = await requestTEEClientBiometricEnrollment(
      {
        subjectDidHash: payload.subjectDidHash,
        enclaveHash: payload.enclaveHash,
        encryptedBiometricData: payload.biometricData,
        biometricType: payload.biometricType ?? "face",
      },
      authToken,
    );
    return {
      success: result.success,
      verificationId: result.verificationId,
      status: result.success ? "verified" : "failed",
      biometricHash: result.biometricHash,
      enclaveHash: result.enclaveHash,
      error: result.error,
    };
  },

  // --------------------------------------------------------------------------
  // Verification Requests
  // --------------------------------------------------------------------------

  /** Create a new verification request */
  async createVerificationRequest(
    payload: Omit<
      VerificationRequest,
      "id" | "status" | "createdAt" | "userConsent"
    >,
    authToken: string,
  ): Promise<VerificationRequest> {
    return post<VerificationRequest>(
      "/api/v1/verification/requests",
      normalizeVerificationRequestPayload(payload),
      authToken,
    );
  },

  /** Respond to a verification request (consent + proof) */
  async respondToVerification(
    requestId: string,
    payload: { consent: boolean; proof?: ZKProof },
    authToken: string,
  ): Promise<VerificationResult> {
    if (!payload.consent) {
      return {
        requestId,
        verified: false,
        attributeResults: [],
        verifiedAt: Math.floor(Date.now() / 1000),
        reason: "User declined verification",
      };
    }
    if (!payload.proof) {
      throw new ZeroIDApiError(
        "Verification response requires a proof when consent is granted.",
        "VERIFICATION_PROOF_REQUIRED",
        400,
      );
    }

    const proofResult = await submitZkProof(payload.proof, authToken);
    return {
      requestId,
      verified: proofResult.valid,
      proof: payload.proof,
      attributeResults: [],
      verifiedAt: proofResult.verifiedAt,
      txHash: proofResult.txHash,
      error: proofResult.error,
    };
  },

  // --------------------------------------------------------------------------
  // Governance
  // --------------------------------------------------------------------------

  /** List governance proposals */
  async listProposals(
    page = 1,
    pageSize = 10,
  ): Promise<PaginatedResponse<Proposal>> {
    const result = await withRetry(
      () =>
        request<BackendSchemaGovernanceRecord[]>(
          "GET",
          "/api/v1/governance/schemas",
          {
            params: { page, limit: pageSize },
          },
        ),
      DEFAULT_RETRIES,
    );
    const items = (result.data ?? []).map(schemaGovernanceToProposal);
    const pagination = (
      result as ApiResponse<BackendSchemaGovernanceRecord[]> & {
        pagination?: BackendPagination;
      }
    ).pagination;
    const resolvedPage = pagination?.page ?? page;
    const resolvedPageSize = pagination?.limit ?? pageSize;
    const total = pagination?.total ?? items.length;
    return {
      items,
      total,
      page: resolvedPage,
      pageSize: resolvedPageSize,
      hasMore: resolvedPage * resolvedPageSize < total,
    };
  },

  /** Get a single proposal by ID */
  async getProposal(proposalId: number | string): Promise<Proposal> {
    const schema = await get<BackendSchemaGovernanceRecord>(
      `/api/v1/governance/schemas/${encodeURIComponent(String(proposalId))}`,
    );
    return schemaGovernanceToProposal(schema);
  },
} as const;
