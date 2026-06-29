/**
 * ZeroID — OpenID4VCI signing + key-proof verification adapters (jose).
 *
 * Provides the real ES256 issuer signer for `issueSdJwtVc` and the holder
 * key-proof (proof of possession) verifier for `issueCredential`.
 */
import {
  SignJWT,
  jwtVerify,
  importJWK,
  decodeProtectedHeader,
  type JWK,
  type KeyLike,
  type JWTHeaderParameters,
} from 'jose';
import { randomBytes } from 'node:crypto';
import { ServiceError } from '../errors';
import type { SdJwtIssueDeps } from './sd-jwt-issuer';

export interface IssuerSigningKey {
  privateKey: KeyLike | Uint8Array;
  kid?: string;
  alg?: string;
}

/** Issuer signing dependencies for the SD-JWT VC issuer. */
export function createJoseIssuanceSignDeps(key: IssuerSigningKey): SdJwtIssueDeps {
  return {
    async signIssuerJwt(payload, header) {
      const protectedHeader = {
        ...header,
        alg: (header.alg as string) ?? key.alg ?? 'ES256',
        ...(key.kid ? { kid: key.kid } : {}),
      } as unknown as JWTHeaderParameters;
      return new SignJWT(payload).setProtectedHeader(protectedHeader).sign(key.privateKey);
    },
    genSalt: () => randomBytes(16).toString('base64url'),
    now: () => Math.floor(Date.now() / 1000),
  };
}

/** Verify the holder's `openid4vci-proof+jwt` and bind to its embedded JWK. */
export function createJoseKeyProofVerifier(): (
  proofJwt: string,
  expected: { aud: string; nonce: string },
) => Promise<{ holderJwk: Record<string, unknown> }> {
  return async (proofJwt, expected) => {
    let header: Record<string, unknown>;
    try {
      header = decodeProtectedHeader(proofJwt) as Record<string, unknown>;
    } catch {
      throw new ServiceError('malformed key proof', 'invalid_proof', 400);
    }
    const jwk = header.jwk as JWK | undefined;
    if (!jwk || typeof jwk !== 'object') {
      throw new ServiceError('key proof is missing the header jwk', 'invalid_proof', 400);
    }
    const key = await importJWK(jwk, (header.alg as string) ?? (jwk.alg as string) ?? 'ES256');

    let payload: Record<string, unknown>;
    try {
      const res = await jwtVerify(proofJwt, key, { typ: 'openid4vci-proof+jwt' });
      payload = res.payload as Record<string, unknown>;
    } catch {
      throw new ServiceError('key proof verification failed', 'invalid_proof', 400);
    }

    const aud = payload.aud;
    const audOk =
      aud === expected.aud || (Array.isArray(aud) && aud.includes(expected.aud));
    if (!audOk) throw new ServiceError('key proof audience mismatch', 'invalid_proof', 400);
    if (payload.nonce !== expected.nonce) {
      throw new ServiceError('key proof nonce mismatch', 'invalid_proof', 400);
    }

    return { holderJwk: jwk as unknown as Record<string, unknown> };
  };
}
