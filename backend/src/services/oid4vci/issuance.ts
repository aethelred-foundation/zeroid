/**
 * ZeroID — OpenID4VCI issuance service (Pre-Authorized-Code flow).
 *
 *   createCredentialOffer    -> mint a Credential Offer (pre-authorized_code)
 *   redeemPreAuthorizedCode  -> exchange the code for an access_token + c_nonce
 *   issueCredential          -> verify the holder key proof, issue an SD-JWT VC
 *   buildIssuerMetadata      -> /.well-known/openid-credential-issuer document
 *
 * Dependency-injected (stores, signer, key-proof verifier, claim sourcer, id +
 * clock) so it is unit-testable without keys or a DB. Errors use OAuth /
 * OpenID4VCI-style codes (`invalid_grant`, `invalid_token`, `invalid_proof`, …)
 * so the wire responses are standards-conformant.
 */
import { ServiceError } from '../errors';
import {
  getCredentialConfig,
  credentialConfigurationsSupported,
  type CredentialConfig,
} from './credential-config';
import { issueSdJwtVc, type SdJwtIssueDeps } from './sd-jwt-issuer';

export const PRE_AUTH_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:pre-authorized_code';

export interface PreAuthGrant {
  configId: string;
  subjectDid: string;
  txCode?: string;
  expiresAt: number;
}

export interface TokenSession {
  configId: string;
  subjectDid: string;
  cNonce: string;
  expiresAt: number;
}

export interface OfferRedemption {
  code: string;
  txCode?: string;
  now: number;
  accessToken: string;
  cNonce: string;
  tokenExpiresAt: number;
}

export interface TokenClaim {
  claimId: string;
  now: number;
  claimExpiresAt: number;
}

export interface ClaimedTokenSession extends TokenSession {
  claimId: string;
}

export interface IssuanceStores {
  saveOffer(code: string, grant: PreAuthGrant): Promise<void>;
  /** Validate and atomically exchange a one-time grant for a token session. */
  redeemOffer(redemption: OfferRedemption): Promise<PreAuthGrant | null>;
  /** Acquire a bounded, exclusive lease before doing credential issuance work. */
  claimToken(token: string, claim: TokenClaim): Promise<ClaimedTokenSession | null>;
  /** Consume a token only when the caller still owns its unexpired lease. */
  completeToken(token: string, claimId: string, now: number): Promise<boolean>;
  /** Release a failed attempt without disturbing a newer lease owner. */
  releaseToken(token: string, claimId: string): Promise<boolean>;
}

export interface IssuanceDeps {
  /** credential_issuer URL (also the key-proof audience). */
  issuer: string;
  stores: IssuanceStores;
  getConfig?(id: string): CredentialConfig | undefined;
  /** Resolve a subject's attributes for a credential configuration. */
  sourceClaims(config: CredentialConfig, subjectDid: string): Promise<Record<string, unknown>>;
  /** Issuer signing dependencies (jose adapter). */
  sign: SdJwtIssueDeps;
  /** Verify the holder's key-proof JWT (PoP) over the c_nonce. */
  verifyKeyProof(
    proofJwt: string,
    expected: { aud: string; nonce: string },
  ): Promise<{ holderJwk: Record<string, unknown> }>;
  /** Opaque high-entropy id generator (codes / tokens / nonces). */
  genId(): string;
  now(): number;
  ttl?: {
    offerSeconds?: number;
    tokenSeconds?: number;
    credentialSeconds?: number;
    issuanceLeaseSeconds?: number;
  };
  /**
   * Optional audit hook, invoked after a credential is issued. Fail-closed: if
   * it throws, issuance fails and the token lease is released (the holder can
   * retry) — never return an un-recorded credential.
   */
  recordIssuance?(record: IssuanceAuditRecord): Promise<void>;
}

export interface IssuanceAuditRecord {
  configId: string;
  vct: string;
  subjectDid: string;
  format: string;
  issuedAt: string;
}

export function buildIssuerMetadata(issuer: string) {
  return {
    credential_issuer: issuer,
    credential_endpoint: `${issuer}/credential`,
    token_endpoint: `${issuer}/token`,
    nonce_endpoint: `${issuer}/nonce`,
    credential_configurations_supported: credentialConfigurationsSupported(),
  };
}

export interface CredentialOffer {
  credential_issuer: string;
  credential_configuration_ids: string[];
  grants: Record<
    string,
    { 'pre-authorized_code': string; tx_code?: { input_mode: 'numeric'; length: number } }
  >;
}

export async function createCredentialOffer(
  deps: IssuanceDeps,
  input: { configId: string; subjectDid: string; txCode?: string },
): Promise<{ offer: CredentialOffer; preAuthorizedCode: string }> {
  const getConfig = deps.getConfig ?? getCredentialConfig;
  if (!getConfig(input.configId)) {
    throw new ServiceError(`unknown credential configuration: ${input.configId}`, 'unsupported_credential_type', 400);
  }
  const preAuthorizedCode = deps.genId();
  await deps.stores.saveOffer(preAuthorizedCode, {
    configId: input.configId,
    subjectDid: input.subjectDid,
    txCode: input.txCode,
    expiresAt: deps.now() + (deps.ttl?.offerSeconds ?? 600),
  });
  const grant: CredentialOffer['grants'][string] = {
    'pre-authorized_code': preAuthorizedCode,
    ...(input.txCode ? { tx_code: { input_mode: 'numeric' as const, length: input.txCode.length } } : {}),
  };
  return {
    offer: {
      credential_issuer: deps.issuer,
      credential_configuration_ids: [input.configId],
      grants: { [PRE_AUTH_GRANT_TYPE]: grant },
    },
    preAuthorizedCode,
  };
}

export interface TokenResponse {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  c_nonce: string;
  c_nonce_expires_in: number;
}

export async function redeemPreAuthorizedCode(
  deps: IssuanceDeps,
  input: { grantType: string; preAuthorizedCode: string; txCode?: string },
): Promise<TokenResponse> {
  if (input.grantType !== PRE_AUTH_GRANT_TYPE) {
    throw new ServiceError('unsupported grant_type', 'unsupported_grant_type', 400);
  }
  const access_token = deps.genId();
  const cNonce = deps.genId();
  const tokenSeconds = deps.ttl?.tokenSeconds ?? 600;
  const now = deps.now();
  const grant = await deps.stores.redeemOffer({
    code: input.preAuthorizedCode,
    txCode: input.txCode,
    now,
    accessToken: access_token,
    cNonce,
    tokenExpiresAt: now + tokenSeconds,
  });
  if (!grant) {
    // Deliberately use one response for unknown, expired, already-consumed, and
    // wrong tx_code grants. The store validates tx_code before its atomic
    // delete, so a typo cannot burn an otherwise valid grant.
    throw new ServiceError('invalid or expired pre-authorized_code', 'invalid_grant', 400);
  }
  return {
    access_token,
    token_type: 'bearer',
    expires_in: tokenSeconds,
    c_nonce: cNonce,
    c_nonce_expires_in: tokenSeconds,
  };
}

export interface CredentialResponse {
  credential: string;
  format: string;
}

export async function issueCredential(
  deps: IssuanceDeps,
  input: { accessToken: string; proofJwt: string },
): Promise<CredentialResponse> {
  const now = deps.now();
  const configuredLease = deps.ttl?.issuanceLeaseSeconds ?? 120;
  // A bounded lease makes a crashed worker recoverable while preventing two
  // live workers from returning credentials for the same bearer token.
  const leaseSeconds = Number.isFinite(configuredLease)
    ? Math.min(300, Math.max(5, Math.floor(configuredLease)))
    : 120;
  const claimId = deps.genId();
  const session = await deps.stores.claimToken(input.accessToken, {
    claimId,
    now,
    claimExpiresAt: now + leaseSeconds,
  });
  if (!session) {
    throw new ServiceError('invalid or expired access token', 'invalid_token', 401);
  }

  let completed = false;
  try {
    const getConfig = deps.getConfig ?? getCredentialConfig;
    const config = getConfig(session.configId);
    if (!config) {
      throw new ServiceError('unknown credential configuration', 'unsupported_credential_type', 400);
    }

    const { holderJwk } = await deps.verifyKeyProof(input.proofJwt, {
      aud: deps.issuer,
      nonce: session.cNonce,
    });

    const attributes = await deps.sourceClaims(config, session.subjectDid);
    const sdClaims: Record<string, unknown> = {};
    const plainClaims: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(attributes)) {
      if (config.sdClaimNames.includes(k)) sdClaims[k] = v;
      else plainClaims[k] = v;
    }

    const { credential } = await issueSdJwtVc(deps.sign, {
      vct: config.vct,
      issuer: deps.issuer,
      holderJwk,
      claims: plainClaims,
      sdClaims,
      ttlSeconds: deps.ttl?.credentialSeconds,
    });

    // Fail-closed audit BEFORE consuming the token, so a failed write is
    // retryable. The credential is never returned unless the claim-owner CAS
    // below succeeds.
    if (deps.recordIssuance) {
      await deps.recordIssuance({
        configId: session.configId,
        vct: config.vct,
        subjectDid: session.subjectDid,
        format: config.format,
        issuedAt: new Date(deps.now() * 1000).toISOString(),
      });
    }

    completed = await deps.stores.completeToken(
      input.accessToken,
      session.claimId,
      deps.now(),
    );
    if (!completed) {
      throw new ServiceError('access token issuance lease expired', 'invalid_token', 401);
    }
    return { credential, format: config.format };
  } catch (error) {
    if (!completed) {
      // Owner-matched release cannot clear a lease that another worker acquired
      // after this one expired. A datastore failure is recoverable when the
      // bounded lease expires, and must not hide the original issuance error.
      await deps.stores.releaseToken(input.accessToken, session.claimId).catch(() => false);
    }
    throw error;
  }
}

export function createInMemoryIssuanceStores(): IssuanceStores {
  const offers = new Map<string, PreAuthGrant>();
  const tokens = new Map<
    string,
    TokenSession & { claimId?: string; claimExpiresAt?: number }
  >();
  return {
    async saveOffer(code, grant) {
      offers.set(code, grant);
    },
    async redeemOffer(redemption) {
      const grant = offers.get(redemption.code);
      if (!grant) return null;
      if (grant.expiresAt < redemption.now) {
        offers.delete(redemption.code);
        return null;
      }
      if (grant.txCode && grant.txCode !== redemption.txCode) return null;

      offers.delete(redemption.code);
      tokens.set(redemption.accessToken, {
        configId: grant.configId,
        subjectDid: grant.subjectDid,
        cNonce: redemption.cNonce,
        expiresAt: redemption.tokenExpiresAt,
      });
      return grant;
    },
    async claimToken(token, claim) {
      const session = tokens.get(token);
      if (!session || session.expiresAt < claim.now) return null;
      if (
        session.claimId &&
        session.claimExpiresAt !== undefined &&
        session.claimExpiresAt > claim.now
      ) {
        return null;
      }
      session.claimId = claim.claimId;
      session.claimExpiresAt = Math.min(claim.claimExpiresAt, session.expiresAt);
      return {
        configId: session.configId,
        subjectDid: session.subjectDid,
        cNonce: session.cNonce,
        expiresAt: session.expiresAt,
        claimId: claim.claimId,
      };
    },
    async completeToken(token, claimId, now) {
      const session = tokens.get(token);
      if (
        !session ||
        session.claimId !== claimId ||
        session.claimExpiresAt === undefined ||
        session.claimExpiresAt <= now
      ) {
        return false;
      }
      tokens.delete(token);
      return true;
    },
    async releaseToken(token, claimId) {
      const session = tokens.get(token);
      if (!session || session.claimId !== claimId) return false;
      delete session.claimId;
      delete session.claimExpiresAt;
      return true;
    },
  };
}
