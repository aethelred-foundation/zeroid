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
  Credential,
  CredentialSchema,
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
import { API_BASE_URL } from "@/config/constants";
import { withRetry, withTimeout } from "@/lib/utils";

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;

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

// ============================================================================
// Internal Helpers
// ============================================================================

/** Generate a short random request ID for tracing */
function generateRequestId(): string {
  const segment = () => Math.random().toString(36).slice(2, 8);
  return `zid-${segment()}-${segment()}`;
}

/** Build full URL from a relative path */
function buildUrl(
  path: string,
  params?: Record<string, string | number>,
): string {
  const url = new URL(path, API_BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
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

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Request-ID": requestId,
    Accept: "application/json",
  };

  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const fetchPromise = fetch(buildUrl(path, params), {
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
                : payload.message ?? response.statusText,
            details: payload.details,
          };
    throw new ZeroIDApiError(
      error.message,
      error.code,
      response.status,
      error.details,
      payload.requestId || requestId,
    );
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
    DEFAULT_RETRIES,
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

/** DELETE helper */
async function del<T>(
  path: string,
  body?: unknown,
  authToken?: string,
): Promise<T> {
  const result = await request<T>("DELETE", path, { body, authToken });
  return result.data as T;
}

function unsupportedFeature(message: string, code: string): never {
  throw new ZeroIDApiError(message, code, 501);
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
    asStringArray((proof as unknown as Record<string, unknown>).publicSignals) ??
    proof.publicInputs;

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
    proofHash: (proof.proofHash ?? proof.hash ?? `0x${result.proofId ?? proof.id}`) as Bytes32,
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

// ============================================================================
// Public API Client
// ============================================================================

export const apiClient = {
  get,
  post,
  put,
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

  /** Fetch an identity profile by DID hash */
  async getIdentity(
    didHash: Bytes32,
    authToken?: string,
  ): Promise<IdentityProfile> {
    return get<IdentityProfile>(
      `/api/v1/identity/${didHash}`,
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
    payload: { didUri: string; recoveryHash: Bytes32 },
    authToken?: string,
  ): Promise<{ didHash: Bytes32; txHash: string }> {
    return post("/api/v1/identity/register", payload, authToken);
  },

  // --------------------------------------------------------------------------
  // Credentials
  // --------------------------------------------------------------------------

  /** List credentials for a subject */
  async listCredentials(
    _subjectDidHash: Bytes32,
    page = 1,
    pageSize = 12,
    authToken?: string,
  ): Promise<PaginatedResponse<Credential>> {
    const result = await withRetry(
      () =>
        request<Credential[]>("GET", "/api/v1/credentials", {
          params: { page, limit: pageSize, role: "subject" },
          authToken,
        }),
      DEFAULT_RETRIES,
    );
    const pagination = (result as ApiResponse<Credential[]> & {
      pagination?: BackendPagination;
    }).pagination;
    const items = result.data ?? [];
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

  /** Get a single credential by hash */
  async getCredential(
    credentialHash: Bytes32,
    authToken?: string,
  ): Promise<Credential> {
    return get<Credential>(
      `/api/v1/credentials/${credentialHash}`,
      undefined,
      authToken,
    );
  },

  /** List available credential schemas */
  async listSchemas(
    page = 1,
    pageSize = 20,
  ): Promise<PaginatedResponse<CredentialSchema>> {
    const result = await withRetry(
      () =>
        request<CredentialSchema[]>("GET", "/api/v1/governance/schemas", {
          params: { page, limit: pageSize },
        }),
      DEFAULT_RETRIES,
    );
    const pagination = (result as ApiResponse<CredentialSchema[]> & {
      pagination?: BackendPagination;
    }).pagination;
    const items = result.data ?? [];
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

  /** Get a single schema by ID */
  async getSchema(schemaId: string): Promise<CredentialSchema> {
    return get<CredentialSchema>(`/api/v1/governance/schemas/${schemaId}`);
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
    _authToken: string,
  ): Promise<ProofRequest[]> {
    unsupportedFeature(
      "Proof request inbox is not exposed by the backend API; use verification history for completed records.",
      "PROOF_REQUEST_INBOX_UNAVAILABLE",
    );
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

  // --------------------------------------------------------------------------
  // TEE
  // --------------------------------------------------------------------------

  /** List available TEE nodes */
  async listTEENodes(): Promise<TEENode[]> {
    unsupportedFeature(
      "TEE node discovery is not exposed by the backend API.",
      "TEE_NODE_DISCOVERY_UNAVAILABLE",
    );
  },

  /** Get attestation details for a specific enclave */
  async getAttestation(enclaveHash: Bytes32): Promise<TEEAttestation> {
    void enclaveHash;
    unsupportedFeature(
      "TEE attestation lookup by enclave hash is not exposed by the backend API.",
      "TEE_ATTESTATION_LOOKUP_UNAVAILABLE",
    );
  },

  /** Request biometric verification via a TEE node */
  async requestBiometricVerification(
    payload: {
      subjectDidHash: Bytes32;
      enclaveHash: Bytes32;
      biometricData: string; // base64-encoded, encrypted for the enclave
    },
    authToken: string,
  ): Promise<{ verificationId: string; status: string }> {
    void payload;
    void authToken;
    unsupportedFeature(
      "Biometric verification is not exposed by the backend API.",
      "BIOMETRIC_VERIFICATION_UNAVAILABLE",
    );
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
    void payload;
    void authToken;
    unsupportedFeature(
      "Verifier-created proof requests are not exposed by the backend API.",
      "VERIFICATION_REQUEST_CREATE_UNAVAILABLE",
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
    void page;
    void pageSize;
    unsupportedFeature(
      "Governance proposal metadata is not exposed by the backend API.",
      "GOVERNANCE_PROPOSALS_UNAVAILABLE",
    );
  },

  /** Get a single proposal by ID */
  async getProposal(proposalId: number): Promise<Proposal> {
    void proposalId;
    unsupportedFeature(
      "Governance proposal metadata is not exposed by the backend API.",
      "GOVERNANCE_PROPOSAL_DETAIL_UNAVAILABLE",
    );
  },
} as const;
