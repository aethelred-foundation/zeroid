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
  meta: { vct_values: string[] };
  claims: DcqlClaimQuery[];
}

export interface DcqlQuery {
  credentials: DcqlCredentialQuery[];
}

/** Compile a presentation policy into a DCQL query. Pure. */
export function compilePolicyToDcql(policy: PresentationPolicy): DcqlQuery {
  return {
    credentials: [
      {
        id: 'eligibility',
        format: SD_JWT_VC_FORMAT,
        meta: { vct_values: [policy.vct] },
        claims: policy.claims.map((c) => ({ path: c.path })),
      },
    ],
  };
}
