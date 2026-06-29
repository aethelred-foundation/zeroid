/**
 * ZeroID — cross-device OpenID4VP flow.
 *
 *   createPresentationRequest -> persist {state, one-time nonce, policyId, aud}; return request_uri + DCQL
 *   getRequestObject          -> the Authorization Request the Wallet fetches via request_uri
 *   handleCallback            -> direct_post: verify the vp_token (binding the stored nonce), store the decision
 *   getResult                 -> the initiating device polls for the decision
 *
 * The persisted request gives real replay protection: the nonce is consumed
 * atomically (PENDING -> CONSUMED) exactly once on callback. Store is injected
 * (in-memory for tests; Prisma in production — see request-store-prisma.ts).
 */
import { ServiceError } from '../errors';
import { compilePolicyToDcql, type DcqlQuery } from './dcql';
import { getPresentationPolicy, type PresentationPolicy } from './policy-presentation';
import {
  verifyPresentation,
  type PresentationVerifierDeps,
  type PresentationDecision,
} from './verifier';

export interface PresentationRequestRecord {
  state: string;
  nonce: string;
  policyId: string;
  audience: string;
  status: 'PENDING' | 'CONSUMED' | 'COMPLETED';
  decision?: PresentationDecision | null;
  expiresAt: number; // epoch seconds
}

export interface Oid4vpRequestStore {
  save(rec: Omit<PresentationRequestRecord, 'status' | 'decision'>): Promise<void>;
  getByState(state: string): Promise<PresentationRequestRecord | null>;
  /** Atomically PENDING -> CONSUMED for the nonce; resolves true exactly once. */
  consumeNonce(nonce: string): Promise<boolean>;
  saveDecision(state: string, decision: PresentationDecision): Promise<void>;
}

export interface CrossDeviceDeps {
  store: Oid4vpRequestStore;
  verifier: Pick<PresentationVerifierDeps, 'sdJwt'>;
  getPolicy?(policyId: string): PresentationPolicy;
  genId(): string;
  now(): number;
  baseUrl: string;
  ttlSeconds?: number;
}

export interface AuthorizeResult {
  state: string;
  nonce: string;
  request_uri: string;
  response_mode: 'direct_post';
  response_type: 'vp_token';
  dcql_query: DcqlQuery;
  expires_in: number;
}

export async function createPresentationRequest(
  deps: CrossDeviceDeps,
  input: { policyId: string; audience: string },
): Promise<AuthorizeResult> {
  const resolve = deps.getPolicy ?? getPresentationPolicy;
  const policy = resolve(input.policyId); // throws POLICY_NOT_FOUND
  const state = deps.genId();
  const nonce = deps.genId();
  const ttl = deps.ttlSeconds ?? 300;
  await deps.store.save({
    state,
    nonce,
    policyId: policy.policyId,
    audience: input.audience,
    expiresAt: deps.now() + ttl,
  });
  return {
    state,
    nonce,
    request_uri: `${deps.baseUrl}/api/v1/oid4vp/request/${state}`,
    response_mode: 'direct_post',
    response_type: 'vp_token',
    dcql_query: compilePolicyToDcql(policy),
    expires_in: ttl,
  };
}

export interface RequestObject {
  client_id: string;
  response_type: 'vp_token';
  response_mode: 'direct_post';
  response_uri: string;
  nonce: string;
  state: string;
  dcql_query: DcqlQuery;
  expires_in: number;
}

export async function getRequestObject(deps: CrossDeviceDeps, state: string): Promise<RequestObject> {
  const rec = await deps.store.getByState(state);
  if (!rec || rec.expiresAt < deps.now()) {
    throw new ServiceError('presentation request not found or expired', 'POLICY_NOT_FOUND', 404);
  }
  const resolve = deps.getPolicy ?? getPresentationPolicy;
  const policy = resolve(rec.policyId);
  return {
    client_id: deps.baseUrl,
    response_type: 'vp_token',
    response_mode: 'direct_post',
    response_uri: `${deps.baseUrl}/api/v1/oid4vp/callback`,
    nonce: rec.nonce,
    state: rec.state,
    dcql_query: compilePolicyToDcql(policy),
    expires_in: Math.max(0, rec.expiresAt - deps.now()),
  };
}

export async function handleCallback(
  deps: CrossDeviceDeps,
  input: { state: string; vpToken: string },
): Promise<PresentationDecision> {
  const rec = await deps.store.getByState(input.state);
  if (!rec || rec.expiresAt < deps.now()) {
    throw new ServiceError('presentation request not found or expired', 'VP_NONCE_INVALID', 401);
  }
  if (rec.status !== 'PENDING') {
    throw new ServiceError('presentation request already used', 'VP_NONCE_INVALID', 401);
  }
  const decision = await verifyPresentation(
    { sdJwt: deps.verifier.sdJwt, getPolicy: deps.getPolicy, consumeNonce: deps.store.consumeNonce },
    { policyId: rec.policyId, vpToken: input.vpToken, nonce: rec.nonce, audience: rec.audience },
  );
  await deps.store.saveDecision(input.state, decision);
  return decision;
}

export async function getResult(
  deps: CrossDeviceDeps,
  state: string,
): Promise<{ status: string; decision?: PresentationDecision | null }> {
  const rec = await deps.store.getByState(state);
  if (!rec) throw new ServiceError('presentation request not found', 'POLICY_NOT_FOUND', 404);
  return rec.status === 'COMPLETED'
    ? { status: 'COMPLETED', decision: rec.decision }
    : { status: rec.status };
}

export function createInMemoryOid4vpRequestStore(): Oid4vpRequestStore {
  const byState = new Map<string, PresentationRequestRecord>();
  return {
    async save(rec) {
      byState.set(rec.state, { ...rec, status: 'PENDING', decision: null });
    },
    async getByState(state) {
      return byState.get(state) ?? null;
    },
    async consumeNonce(nonce) {
      for (const rec of byState.values()) {
        if (rec.nonce === nonce && rec.status === 'PENDING') {
          rec.status = 'CONSUMED';
          return true;
        }
      }
      return false;
    },
    async saveDecision(state, decision) {
      const rec = byState.get(state);
      if (rec) {
        rec.status = 'COMPLETED';
        rec.decision = decision;
      }
    },
  };
}
