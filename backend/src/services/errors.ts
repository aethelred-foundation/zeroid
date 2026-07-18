/**
 * ZeroID — unified service error taxonomy.
 *
 * One base class (`ServiceError`) and one HTTP mapper (`sendServiceError`) for
 * every domain service (AI Agent Passport, partner integrations, eligibility).
 * Goals:
 *   1. A single error hierarchy so call sites and tests share one shape.
 *   2. A documented vocabulary of canonical codes (`ServiceErrorCode`) for the
 *      errors ZeroID itself raises — with IDE autocomplete — while still
 *      letting codes owned elsewhere (the human eligibility handler's
 *      `PROOF_*` / `ZK_*` / `CRED_*` family) propagate through unchanged.
 *   3. One error→HTTP mapping with a stable `{ error, message }` envelope.
 *
 * The mapper is intentionally *duck-typed* (`isServiceErrorLike`), not
 * `instanceof`-based: errors can cross module/realm boundaries (and are mocked
 * as plain classes in tests), so structural matching on `{ code, statusCode }`
 * is the robust contract.
 */

/** Canonical error codes ZeroID's own services raise. */
export type ServiceErrorCode =
  // 404 — not found
  | 'AGENT_NOT_FOUND'
  | 'CREDENTIAL_NOT_FOUND'
  | 'IDENTITY_NOT_FOUND'
  | 'CONTROLLER_NOT_FOUND'
  | 'OWNER_NOT_FOUND'
  | 'STAKER_NOT_FOUND'
  | 'EVIDENCE_NOT_FOUND'
  // 403 — authorization / policy
  | 'CONTROLLER_MISMATCH'
  | 'CONTROLLER_NOT_ELIGIBLE'
  | 'AGENT_NOT_AUTHORIZED'
  | 'PARTNER_PRINCIPAL_MISMATCH'
  // 422 — semantically valid but policy conditions unmet
  | 'POLICY_CONDITIONS_NOT_MET'
  // 400 — bad request
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'VALIDATION_FAILED'
  // OpenID4VP presentation
  | 'POLICY_NOT_FOUND'
  | 'VP_TOKEN_INVALID'
  | 'VP_VCT_MISMATCH'
  | 'VP_NONCE_INVALID'
  // 5xx / upstream
  | 'ELIGIBILITY_FAILED'
  | 'DISCLOSURE_FAILED'
  | 'DISCLOSURE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/**
 * Any code accepted by a `ServiceError`: a canonical code (autocompleted) or a
 * passthrough string owned by another layer. `(string & {})` preserves literal
 * suggestions while still accepting arbitrary strings.
 */
export type AnyServiceErrorCode = ServiceErrorCode | (string & {});

/** The list form of {@link ServiceErrorCode}, for documentation/tests. */
export const KNOWN_ERROR_CODES: readonly ServiceErrorCode[] = [
  'AGENT_NOT_FOUND',
  'CREDENTIAL_NOT_FOUND',
  'IDENTITY_NOT_FOUND',
  'CONTROLLER_NOT_FOUND',
  'OWNER_NOT_FOUND',
  'STAKER_NOT_FOUND',
  'EVIDENCE_NOT_FOUND',
  'CONTROLLER_MISMATCH',
  'CONTROLLER_NOT_ELIGIBLE',
  'AGENT_NOT_AUTHORIZED',
  'PARTNER_PRINCIPAL_MISMATCH',
  'POLICY_CONDITIONS_NOT_MET',
  'INVALID_IDEMPOTENCY_KEY',
  'VALIDATION_FAILED',
  'POLICY_NOT_FOUND',
  'VP_TOKEN_INVALID',
  'VP_VCT_MISMATCH',
  'VP_NONCE_INVALID',
  'ELIGIBILITY_FAILED',
  'DISCLOSURE_FAILED',
  'DISCLOSURE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

/** Base class for every recoverable, client-mappable service error. */
export class ServiceError extends Error {
  readonly code: AnyServiceErrorCode;
  readonly statusCode: number;

  constructor(message: string, code: AnyServiceErrorCode, statusCode: number) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** Stable wire envelope for an error response. */
export interface ErrorEnvelope {
  error: string;
  message: string;
}

interface ServiceErrorLike {
  code: string;
  statusCode: number;
  message?: string;
}

/**
 * Structural guard: anything carrying a string `code` and a numeric
 * `statusCode`. Deliberately tolerant of cross-realm / mocked errors. A bare
 * `Error` or a Prisma error (which has `code` but no `statusCode`) is *not*
 * service-like and falls through to a generic 500.
 */
export function isServiceErrorLike(e: unknown): e is ServiceErrorLike {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as Record<string, unknown>;
  return typeof o.code === 'string' && typeof o.statusCode === 'number';
}

/** Minimal responder shape — satisfied by Express's `res`. */
interface ErrorResponder {
  status(code: number): { json(body: ErrorEnvelope): unknown };
}

interface ErrorLogger {
  error(message: string, meta?: unknown): void;
}

/**
 * Map any thrown value to an HTTP response with the stable `{ error, message }`
 * envelope. Service-like errors map to their own `statusCode`/`code`; anything
 * else is logged and returned as an opaque 500 (no internal details leak).
 */
export function sendServiceError(
  res: ErrorResponder,
  error: unknown,
  logger?: ErrorLogger,
): void {
  if (isServiceErrorLike(error)) {
    res
      .status(error.statusCode)
      .json({ error: error.code, message: error.message ?? error.code });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  logger?.error('unhandled_service_error', { message });
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal error' });
}
