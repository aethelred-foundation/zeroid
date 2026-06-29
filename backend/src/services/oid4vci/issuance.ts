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

export interface IssuanceStores {
  saveOffer(code: string, grant: PreAuthGrant): Promise<void>;
  /** Consume (one-time) the grant for a pre-authorized code. */
  takeOffer(code: string): Promise<PreAuthGrant | null>;
  saveToken(token: string, session: TokenSession): Promise<void>;
  getToken(token: string): Promise<TokenSession | null>;
  deleteToken(token: string): Promise<void>;
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
  ttl?: { offerSeconds?: number; tokenSeconds?: number; credentialSeconds?: number };
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
  const grant = await deps.stores.takeOffer(input.preAuthorizedCode); // one-time
  if (!grant || grant.expiresAt < deps.now()) {
    throw new ServiceError('invalid or expired pre-authorized_code', 'invalid_grant', 400);
  }
  if (grant.txCode && grant.txCode !== input.txCode) {
    throw new ServiceError('invalid tx_code', 'invalid_grant', 400);
  }
  const access_token = deps.genId();
  const cNonce = deps.genId();
  const tokenSeconds = deps.ttl?.tokenSeconds ?? 600;
  await deps.stores.saveToken(access_token, {
    configId: grant.configId,
    subjectDid: grant.subjectDid,
    cNonce,
    expiresAt: deps.now() + tokenSeconds,
  });
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
  const session = await deps.stores.getToken(input.accessToken);
  if (!session || session.expiresAt < deps.now()) {
    throw new ServiceError('invalid or expired access token', 'invalid_token', 401);
  }
  const getConfig = deps.getConfig ?? getCredentialConfig;
  const config = getConfig(session.configId);
  if (!config) throw new ServiceError('unknown credential configuration', 'unsupported_credential_type', 400);

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

  // MVP: one credential per pre-authorized grant.
  await deps.stores.deleteToken(input.accessToken);
  return { credential, format: config.format };
}

export function createInMemoryIssuanceStores(): IssuanceStores {
  const offers = new Map<string, PreAuthGrant>();
  const tokens = new Map<string, TokenSession>();
  return {
    async saveOffer(code, grant) {
      offers.set(code, grant);
    },
    async takeOffer(code) {
      const g = offers.get(code) ?? null;
      if (g) offers.delete(code);
      return g;
    },
    async saveToken(token, session) {
      tokens.set(token, session);
    },
    async getToken(token) {
      return tokens.get(token) ?? null;
    },
    async deleteToken(token) {
      tokens.delete(token);
    },
  };
}
