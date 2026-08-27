/**
 * ZeroID — production SD-JWT VC signature adapter (jose).
 *
 * Plugs real ES256/EdDSA verification into the injected `SdJwtVerifyDeps` seam.
 * Issuer key resolution is delegated to a caller-supplied resolver (the
 * integration point for the issuer-trust registry / JWKS), keeping this adapter
 * free of trust-store concerns.
 */
import { jwtVerify, importJWK, decodeProtectedHeader, type JWK } from 'jose';
import { ServiceError } from '../errors';
import type { SdJwtVerifyDeps } from './sd-jwt';

/** Resolve the issuer's verification key from the issuer JWT's protected header. */
export type IssuerKeyResolver = (
  header: Record<string, unknown>,
  jwt: string,
) => Promise<JWK>;

export function createJoseSdJwtDeps(resolveIssuerKey: IssuerKeyResolver): SdJwtVerifyDeps {
  return {
    async verifyIssuerJwt(jwt) {
      const header = decodeProtectedHeader(jwt) as Record<string, unknown>;
      const jwk = await resolveIssuerKey(header, jwt);
      const alg = (header.alg as string) ?? (jwk.alg as string) ?? 'ES256';
      const key = await importJWK(jwk, alg);
      try {
        const { payload } = await jwtVerify(jwt, key);
        return { payload: payload as Record<string, unknown> };
      } catch {
        throw new ServiceError('issuer JWT verification failed', 'VP_TOKEN_INVALID', 401);
      }
    },

    async verifyKeyBindingJwt(kbJwt, holderJwk) {
      const alg = (holderJwk.alg as string) ?? 'ES256';
      const key = await importJWK(holderJwk as unknown as JWK, alg);
      try {
        const { payload } = await jwtVerify(kbJwt, key, { typ: 'kb+jwt' });
        return { payload: payload as Record<string, unknown> };
      } catch {
        throw new ServiceError('key-binding JWT verification failed', 'VP_TOKEN_INVALID', 401);
      }
    },

    now: () => Math.floor(Date.now() / 1000),
  };
}
