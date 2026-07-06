/**
 * ZeroID — OpenID4VCI issuer signing-key resolution (fail-closed).
 *
 * Resolves the issuer's SD-JWT signing dependencies from the environment:
 *   - `OID4VCI_ISSUER_JWK` set   -> import the private JWK (kid surfaced in JWS headers).
 *   - unset, NON-production      -> ephemeral dev key, with a warning.
 *   - unset (or unusable), PRODUCTION -> throw 503 `OID4VCI_ISSUER_KEY_REQUIRED`.
 *
 * The production branch is the F1 audit fix: an identity issuer must never
 * silently sign credentials with a throwaway key — issued credentials would be
 * unverifiable after every restart and would not match published metadata.
 * `production-safety.ts` also blocks boot on the same condition; this is the
 * defense-in-depth request-path guard.
 */
import { importJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import { ServiceError } from '../errors';
import { isProductionRuntime } from '../production-safety';
import { createJoseIssuanceSignDeps } from './jose';
import type { SdJwtIssueDeps } from './sd-jwt-issuer';

interface WarnLogger {
  warn(message: string): void;
}

export async function createIssuerSignDepsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  logger?: WarnLogger,
): Promise<SdJwtIssueDeps> {
  const raw = env.OID4VCI_ISSUER_JWK?.trim();

  if (raw) {
    let jwk: (JWK & { kid?: string }) | null = null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const hasPrivateComponent =
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof parsed.kty === 'string' &&
        (typeof parsed.d === 'string' || typeof parsed.k === 'string');
      if (hasPrivateComponent) jwk = parsed as unknown as JWK & { kid?: string };
    } catch {
      jwk = null;
    }
    if (jwk) {
      try {
        const key = (await importJWK(jwk, jwk.alg ?? 'ES256')) as KeyLike;
        return createJoseIssuanceSignDeps({ privateKey: key, kid: jwk.kid, alg: jwk.alg });
      } catch {
        // fall through to the fail-closed error below
      }
    }
    throw new ServiceError(
      'OID4VCI_ISSUER_JWK is not a usable private JWK',
      'OID4VCI_ISSUER_KEY_REQUIRED',
      503,
    );
  }

  if (isProductionRuntime(env)) {
    throw new ServiceError(
      'OpenID4VCI issuer signing key is required in production — set OID4VCI_ISSUER_JWK (never issue with an ephemeral key)',
      'OID4VCI_ISSUER_KEY_REQUIRED',
      503,
    );
  }

  const { privateKey } = await generateKeyPair('ES256');
  logger?.warn('oid4vci: using ephemeral issuer key — set OID4VCI_ISSUER_JWK in production');
  return createJoseIssuanceSignDeps({ privateKey });
}
