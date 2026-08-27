/**
 * ZeroID — SD-JWT VC processing for OpenID4VP presentations.
 *
 * Implements the SD-JWT spec mechanics for real (disclosure parsing, SHA-256
 * digesting, selective-disclosure reconstruction, key-binding checks). The raw
 * JWT signature verification is injected (`SdJwtVerifyDeps`) so this module is
 * unit-testable without keys; the production adapter (`sd-jwt-jose.ts`) plugs in
 * `jose`.
 *
 * Compact serialization: `<issuer-JWT>~<disclosure>~...~<disclosure>~<KB-JWT?>`.
 */
import { createHash } from 'node:crypto';
import { ServiceError } from '../errors';

export interface ParsedSdJwt {
  jwt: string;
  disclosures: string[];
  keyBindingJwt: string | null;
}

export interface SdJwtVerifyDeps {
  /** Verify the issuer-signed JWT (resolve issuer key + check signature). */
  verifyIssuerJwt(jwt: string): Promise<{ payload: Record<string, unknown> }>;
  /** Verify the holder Key-Binding JWT against the credential's `cnf` JWK. */
  verifyKeyBindingJwt(
    kbJwt: string,
    holderJwk: Record<string, unknown>,
  ): Promise<{ payload: Record<string, unknown> }>;
  /** Current time, epoch seconds. */
  now(): number;
}

export interface SdJwtVerifyParams {
  compact: string;
  expectedNonce: string;
  expectedAudience: string;
  expectedVct?: string;
  /** Require holder key binding (default true). */
  requireKeyBinding?: boolean;
  /** Max age of the KB-JWT `iat`, seconds (default 300). */
  maxKbAgeSeconds?: number;
}

export interface VerifiedSdJwt {
  vct: string;
  claims: Record<string, unknown>;
  cnf: Record<string, unknown> | null;
}

const invalid = (message: string, code = 'VP_TOKEN_INVALID', status = 401): never => {
  throw new ServiceError(message, code, status);
};

/** base64url(SHA-256(input)). */
function sha256b64u(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

/** Digest of a disclosure, per SD-JWT (hash of the base64url disclosure string). */
export function digestDisclosure(disclosure: string): string {
  return sha256b64u(disclosure);
}

interface DecodedDisclosure {
  salt: string;
  name?: string; // present for object-property disclosures ([salt, name, value])
  value: unknown;
}

/** Encode an object-property disclosure: base64url([salt, name, value]). */
export function encodeDisclosure(salt: string, name: string, value: unknown): string {
  return Buffer.from(JSON.stringify([salt, name, value])).toString('base64url');
}

export function decodeDisclosure(disclosure: string): DecodedDisclosure {
  let arr: unknown;
  try {
    arr = JSON.parse(Buffer.from(disclosure, 'base64url').toString('utf8'));
  } catch {
    return invalid('malformed disclosure encoding');
  }
  if (!Array.isArray(arr) || (arr.length !== 2 && arr.length !== 3)) {
    return invalid('disclosure must be a 2- or 3-element array');
  }
  return arr.length === 3
    ? { salt: String(arr[0]), name: String(arr[1]), value: arr[2] }
    : { salt: String(arr[0]), value: arr[1] };
}

export function parseSdJwt(compact: string): ParsedSdJwt {
  if (typeof compact !== 'string' || compact.length === 0) {
    return invalid('empty presentation', 'VP_TOKEN_INVALID', 400);
  }
  const parts = compact.split('~');
  const jwt = parts[0];
  if (!jwt) return invalid('missing issuer JWT', 'VP_TOKEN_INVALID', 400);
  if (parts.length === 1) return { jwt, disclosures: [], keyBindingJwt: null };
  const last = parts[parts.length - 1];
  const keyBindingJwt = last === '' ? null : last;
  const disclosures = parts.slice(1, parts.length - 1).filter((p) => p.length > 0);
  return { jwt, disclosures, keyBindingJwt };
}

/**
 * Reconstruct disclosed claims by replacing `_sd` digests (objects) and `{"...":
 * digest}` placeholders (arrays) with the matching disclosure values. Throws if
 * a provided disclosure is never referenced (a malformed presentation).
 */
export function reconstructClaims(
  payload: Record<string, unknown>,
  disclosures: string[],
): Record<string, unknown> {
  const byDigest = new Map<string, DecodedDisclosure>();
  for (const d of disclosures) byDigest.set(digestDisclosure(d), decodeDisclosure(d));
  const used = new Set<string>();

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      for (const el of node) {
        if (
          el &&
          typeof el === 'object' &&
          !Array.isArray(el) &&
          Object.keys(el as object).length === 1 &&
          '...' in (el as object)
        ) {
          const dig = String((el as Record<string, unknown>)['...']);
          const dis = byDigest.get(dig);
          if (dis) {
            used.add(dig);
            if (dis.name !== undefined) invalid('array-element disclosure must be 2 elements');
            out.push(walk(dis.value));
          }
          // undisclosed array element -> omitted
        } else {
          out.push(walk(el));
        }
      }
      return out;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === '_sd' || k === '_sd_alg') continue;
        out[k] = walk(v);
      }
      const sd = obj['_sd'];
      if (Array.isArray(sd)) {
        for (const dig of sd) {
          const dis = byDigest.get(String(dig));
          if (dis) {
            used.add(String(dig));
            if (dis.name === undefined) invalid('object _sd disclosure must be 3 elements');
            out[dis.name as string] = walk(dis.value);
          }
          // undisclosed object claim -> omitted
        }
      }
      return out;
    }
    return node;
  };

  const claims = walk(payload) as Record<string, unknown>;
  if (used.size !== byDigest.size) {
    return invalid('a provided disclosure is not referenced by any digest');
  }
  return claims;
}

/** Verify an SD-JWT VC presentation (issuer sig + disclosures + holder binding). */
export async function verifySdJwtVc(
  deps: SdJwtVerifyDeps,
  params: SdJwtVerifyParams,
): Promise<VerifiedSdJwt> {
  const requireKb = params.requireKeyBinding !== false;
  const { jwt, disclosures, keyBindingJwt } = parseSdJwt(params.compact);

  const { payload } = await deps.verifyIssuerJwt(jwt);

  const vct = typeof payload.vct === 'string' ? payload.vct : '';
  if (params.expectedVct && vct !== params.expectedVct) {
    invalid(`unexpected credential type "${vct}"`, 'VP_VCT_MISMATCH', 400);
  }

  const claims = reconstructClaims(payload, disclosures);
  const cnf =
    payload.cnf && typeof payload.cnf === 'object'
      ? (payload.cnf as Record<string, unknown>)
      : null;

  if (requireKb) {
    if (!keyBindingJwt) invalid('missing key-binding JWT');
    const holderJwk = cnf?.jwk as Record<string, unknown> | undefined;
    if (!holderJwk) invalid('credential has no holder cnf.jwk');

    const { payload: kb } = await deps.verifyKeyBindingJwt(
      keyBindingJwt as string,
      holderJwk as Record<string, unknown>,
    );

    if (kb.nonce !== params.expectedNonce) invalid('key-binding nonce mismatch', 'VP_NONCE_INVALID');

    const aud = kb.aud;
    const audOk =
      aud === params.expectedAudience ||
      (Array.isArray(aud) && aud.includes(params.expectedAudience));
    if (!audOk) invalid('key-binding audience mismatch');

    const iat = typeof kb.iat === 'number' ? kb.iat : NaN;
    const maxAge = params.maxKbAgeSeconds ?? 300;
    const skew = 60;
    if (!Number.isFinite(iat) || deps.now() - iat > maxAge || iat - deps.now() > skew) {
      invalid('stale or future-dated key-binding JWT');
    }

    // sd_hash covers the presentation up to and including the final '~' before
    // the KB-JWT: "JWT~D1~...~Dn~" (and "JWT~" when there are no disclosures).
    const presentedPrefix = jwt + disclosures.map((d) => `~${d}`).join('') + '~';
    const expectedSdHash = sha256b64u(presentedPrefix);
    if (kb.sd_hash !== expectedSdHash) invalid('key-binding sd_hash does not match presentation');
  }

  return { vct, claims, cnf };
}
