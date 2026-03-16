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
} from '@/types';
import { API_BASE_URL } from '@/config/constants';
import { withRetry, withTimeout } from '@/lib/utils';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;

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
    this.name = 'ZeroIDApiError';
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
function buildUrl(path: string, params?: Record<string, string | number>): string {
  const url = new URL(path, API_BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
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
    'Content-Type': 'application/json',
    'X-Request-ID': requestId,
    Accept: 'application/json',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
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

  let json: ApiResponse<T>;
  try {
    json = await response.json();
  } catch {
    throw new ZeroIDApiError(
      `Failed to parse API response (${response.status})`,
      'PARSE_ERROR',
      response.status,
      undefined,
      requestId,
    );
  }

  if (!response.ok || !json.success) {
    const error = json.error || { code: 'UNKNOWN', message: response.statusText };
    throw new ZeroIDApiError(
      error.message,
      error.code,
      response.status,
      error.details,
      json.requestId || requestId,
    );
  }

  return json;
}

/** GET with automatic retry */
async function get<T>(
  path: string,
  params?: Record<string, string | number>,
  authToken?: string,
): Promise<T> {
  const result = await withRetry(
    () => request<T>('GET', path, { params, authToken }),
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
  const result = await request<T>('POST', path, { body, authToken });
  return result.data as T;
}

// ============================================================================
// Public API Client
// ============================================================================

export const apiClient = {
  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------

  /** Check backend health status */
  async health(): Promise<HealthResponse> {
    return get<HealthResponse>('/api/v1/health');
  },

  // --------------------------------------------------------------------------
  // Identity
  // --------------------------------------------------------------------------

  /** Fetch an identity profile by DID hash */
  async getIdentity(didHash: Bytes32, authToken?: string): Promise<IdentityProfile> {
    return get<IdentityProfile>(`/api/v1/identity/${didHash}`, undefined, authToken);
  },

  /** Fetch an identity profile by controller address */
  async getIdentityByAddress(address: Address, authToken?: string): Promise<IdentityProfile | null> {
    return get<IdentityProfile | null>(`/api/v1/identity/address/${address}`, undefined, authToken);
  },

  /** Register a new identity */
  async registerIdentity(
    payload: { didUri: string; recoveryHash: Bytes32 },
    authToken?: string,
  ): Promise<{ didHash: Bytes32; txHash: string }> {
    return post('/api/v1/identity/register', payload, authToken);
  },

  // --------------------------------------------------------------------------
  // Credentials
  // --------------------------------------------------------------------------

  /** List credentials for a subject */
  async listCredentials(
    subjectDidHash: Bytes32,
    page = 1,
    pageSize = 12,
    authToken?: string,
  ): Promise<PaginatedResponse<Credential>> {
    return get<PaginatedResponse<Credential>>(
      `/api/v1/credentials`,
      { subject: subjectDidHash, page, pageSize },
      authToken,
    );
  },

  /** Get a single credential by hash */
  async getCredential(credentialHash: Bytes32, authToken?: string): Promise<Credential> {
    return get<Credential>(`/api/v1/credentials/${credentialHash}`, undefined, authToken);
  },

  /** List available credential schemas */
  async listSchemas(
    page = 1,
    pageSize = 20,
  ): Promise<PaginatedResponse<CredentialSchema>> {
    return get<PaginatedResponse<CredentialSchema>>(
      '/api/v1/schemas',
      { page, pageSize },
    );
  },

  /** Get a single schema by hash */
  async getSchema(schemaHash: Bytes32): Promise<CredentialSchema> {
    return get<CredentialSchema>(`/api/v1/schemas/${schemaHash}`);
  },

  // --------------------------------------------------------------------------
  // Proofs
  // --------------------------------------------------------------------------

  /** Submit a generated proof for backend verification and optional on-chain anchoring */
  async submitProof(
    proof: ZKProof,
    authToken: string,
  ): Promise<ProofVerification> {
    return post<ProofVerification>('/api/v1/proofs/submit', proof, authToken);
  },

  /** Fetch pending proof requests for the current user */
  async listProofRequests(
    subjectDidHash: Bytes32,
    authToken: string,
  ): Promise<ProofRequest[]> {
    return get<ProofRequest[]>(
      '/api/v1/proofs/requests',
      { subject: subjectDidHash },
      authToken,
    );
  },

  /** Get a verification result by request ID */
  async getVerificationResult(
    requestId: string,
    authToken?: string,
  ): Promise<VerificationResult> {
    return get<VerificationResult>(
      `/api/v1/proofs/verifications/${requestId}`,
      undefined,
      authToken,
    );
  },

  // --------------------------------------------------------------------------
  // TEE
  // --------------------------------------------------------------------------

  /** List available TEE nodes */
  async listTEENodes(): Promise<TEENode[]> {
    return get<TEENode[]>('/api/v1/tee/nodes');
  },

  /** Get attestation details for a specific enclave */
  async getAttestation(enclaveHash: Bytes32): Promise<TEEAttestation> {
    return get<TEEAttestation>(`/api/v1/tee/attestation/${enclaveHash}`);
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
    return post('/api/v1/tee/biometric/verify', payload, authToken);
  },

  // --------------------------------------------------------------------------
  // Verification Requests
  // --------------------------------------------------------------------------

  /** Create a new verification request */
  async createVerificationRequest(
    payload: Omit<VerificationRequest, 'id' | 'status' | 'createdAt' | 'userConsent'>,
    authToken: string,
  ): Promise<VerificationRequest> {
    return post<VerificationRequest>('/api/v1/verifications', payload, authToken);
  },

  /** Respond to a verification request (consent + proof) */
  async respondToVerification(
    requestId: string,
    payload: { consent: boolean; proof?: ZKProof },
    authToken: string,
  ): Promise<VerificationResult> {
    return post<VerificationResult>(
      `/api/v1/verifications/${requestId}/respond`,
      payload,
      authToken,
    );
  },

  // --------------------------------------------------------------------------
  // Governance
  // --------------------------------------------------------------------------

  /** List governance proposals */
  async listProposals(
    page = 1,
    pageSize = 10,
  ): Promise<PaginatedResponse<Proposal>> {
    return get<PaginatedResponse<Proposal>>(
      '/api/v1/governance/proposals',
      { page, pageSize },
    );
  },

  /** Get a single proposal by ID */
  async getProposal(proposalId: number): Promise<Proposal> {
    return get<Proposal>(`/api/v1/governance/proposals/${proposalId}`);
  },
} as const;
