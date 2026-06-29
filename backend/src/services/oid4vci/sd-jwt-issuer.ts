/**
 * ZeroID — SD-JWT VC issuer (OpenID4VCI Flow A).
 *
 * Builds the inverse of the verifier: given subject claims, it creates the
 * selective-disclosure set, computes digests, and signs the issuer JWT with
 * `_sd` + holder `cnf`. Returns the issuer-signed credential (no Key-Binding
 * JWT — the holder appends KB at presentation time). The raw signing is
 * injected so this module is unit-testable; the production signer lives in
 * `oid4vci/jose.ts`.
 *
 * Reuses `encodeDisclosure` / `digestDisclosure` from the verifier's SD-JWT
 * module so issuance and verification share identical disclosure mechanics.
 */
import { encodeDisclosure, digestDisclosure } from '../oid4vp/sd-jwt';

export interface SdJwtIssueDeps {
  /** Sign the issuer JWT (resolve issuer key + sign). Returns compact JWS. */
  signIssuerJwt(
    payload: Record<string, unknown>,
    header: Record<string, unknown>,
  ): Promise<string>;
  /** Fresh, high-entropy disclosure salt (base64url). */
  genSalt(): string;
  /** Current time, epoch seconds. */
  now(): number;
}

export interface SdJwtIssueParams {
  vct: string;
  issuer: string;
  /** Holder public JWK to bind the credential to (becomes `cnf.jwk`). */
  holderJwk: Record<string, unknown>;
  /** Always-disclosed claims (carried in clear in the issuer JWT). */
  claims?: Record<string, unknown>;
  /** Selectively-disclosable claims (carried as `_sd` digests). */
  sdClaims?: Record<string, unknown>;
  /** Optional credential lifetime (sets `exp`). */
  ttlSeconds?: number;
  /** Issuer signing key id, surfaced in the JWS header. */
  kid?: string;
}

export interface IssuedSdJwtVc {
  /** Compact SD-JWT VC: `<issuer-JWT>~<disclosure>~...~` (no KB-JWT). */
  credential: string;
  disclosures: string[];
}

/** Issue an SD-JWT VC. Pure mechanics + injected signer. */
export async function issueSdJwtVc(
  deps: SdJwtIssueDeps,
  params: SdJwtIssueParams,
): Promise<IssuedSdJwtVc> {
  const disclosures = Object.entries(params.sdClaims ?? {}).map(([name, value]) =>
    encodeDisclosure(deps.genSalt(), name, value),
  );
  // Sorting the digests avoids leaking the claim order/positions.
  const digests = disclosures.map(digestDisclosure).sort();

  const iat = deps.now();
  const payload: Record<string, unknown> = {
    vct: params.vct,
    iss: params.issuer,
    iat,
    ...(params.ttlSeconds ? { exp: iat + params.ttlSeconds } : {}),
    cnf: { jwk: params.holderJwk },
    ...(params.claims ?? {}),
    _sd: digests,
    _sd_alg: 'sha-256',
  };

  const header: Record<string, unknown> = { alg: 'ES256', typ: 'dc+sd-jwt' };
  if (params.kid) header.kid = params.kid;

  const jwt = await deps.signIssuerJwt(payload, header);
  const credential = jwt + disclosures.map((d) => `~${d}`).join('') + '~';
  return { credential, disclosures };
}
