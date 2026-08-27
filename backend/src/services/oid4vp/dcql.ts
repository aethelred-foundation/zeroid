/**
 * ZeroID — Step 1: compile a presentation policy into an OpenID4VP DCQL query.
 *
 * DCQL (Digital Credentials Query Language) is the forward query format in
 * OpenID4VP. A verifier puts `dcql_query` in its Authorization Request to tell
 * the Wallet which credential + claims to present. Because the query is derived
 * from the policy descriptor, the policy registry stays the single source of
 * truth for both the presentation request and the post-verification evaluation.
 */
import type { PresentationPolicy } from './policy-presentation';
import { ZK_ELIGIBILITY_FORMAT } from './zk-predicate';

/**
 * SD-JWT VC format identifier in DCQL. Pin this exactly to the OpenID4VP /
 * SD-JWT VC versions you target — format ids changed across drafts
 * (`vc+sd-jwt` -> `dc+sd-jwt`). See docs/integrations/openid4vp-version-pin.md.
 */
export const SD_JWT_VC_FORMAT = 'dc+sd-jwt';

export interface DcqlClaimQuery {
  path: (string | number)[];
}

export interface DcqlCredentialQuery {
  id: string;
  format: string;
  meta: { vct_values?: string[]; [key: string]: unknown };
  claims?: DcqlClaimQuery[];
}

export interface DcqlQuery {
  credentials: DcqlCredentialQuery[];
  /** DCQL alternatives — the Wallet may satisfy any one option set. */
  credential_sets?: { options: string[][] }[];
}

/** Compile a presentation policy into a DCQL query. Pure. */
export function compilePolicyToDcql(policy: PresentationPolicy): DcqlQuery {
  const sdJwt: DcqlCredentialQuery = {
    id: 'eligibility',
    format: SD_JWT_VC_FORMAT,
    meta: { vct_values: [policy.vct] },
    claims: policy.claims.map((c) => ({ path: c.path })),
  };

  // No ZK binding -> a single SD-JWT VC query.
  if (!policy.zk) return { credentials: [sdJwt] };

  // ZK binding -> offer the zero-disclosure proof as an alternative the Wallet
  // may present *instead of* disclosing claims (privacy ladder).
  const zk: DcqlCredentialQuery = {
    id: 'eligibility_zk',
    format: ZK_ELIGIBILITY_FORMAT,
    meta: { circuit_id: policy.zk.circuitId, vkey_id: policy.zk.vkeyId },
  };
  return {
    credentials: [sdJwt, zk],
    credential_sets: [{ options: [[sdJwt.id], [zk.id]] }],
  };
}
