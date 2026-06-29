/**
 * ZeroID — OpenID4VP presentation policy descriptor + claim evaluator.
 *
 * A `PresentationPolicy` declares the credential type (vct) and the claims a
 * policy requires, with the rule each claim must satisfy. This single descriptor
 * drives BOTH:
 *   - the DCQL query a verifier sends (see `dcql.ts`), and
 *   - the evaluation of the disclosed claims after a presentation is verified.
 * Keeping one source of truth is what stops the SD-JWT-VC path and the ZK
 * eligibility path from diverging (see docs/integrations/openid4vp-vci-wallet-design.md).
 *
 * The rules below mirror `ZEROID_ELIGIBILITY_POLICY_V1` in routes/verification.ts
 * (the ZK path): minimum age 21, residency AE, nationality in a fixed set, risk
 * tier LOW|MEDIUM, sanctions clear.
 */
import { ServiceError } from '../errors';

export type ClaimPath = (string | number)[];

export type ClaimRule =
  | { kind: 'booleanTrue' }
  | { kind: 'equals'; value: string }
  | { kind: 'oneOf'; values: string[] }
  | { kind: 'intersects'; values: string[] }; // claim is an array; intersection with `values` must be non-empty

export interface ClaimRequirement {
  /** SD-JWT VC claim path in array form (per DCQL). */
  path: ClaimPath;
  /** Human label, used in deny reasons. */
  label: string;
  rule: ClaimRule;
}

export interface PresentationPolicy {
  policyId: string;
  /** SD-JWT VC type the presented credential must declare (`vct`). */
  vct: string;
  claims: ClaimRequirement[];
}

const REGULATED_ELIGIBILITY_V1: PresentationPolicy = {
  policyId: 'zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1',
  vct: 'https://credentials.zeroid/regulated-eligibility/v1',
  claims: [
    { path: ['age_equal_or_over', '21'], label: 'age 21+', rule: { kind: 'booleanTrue' } },
    { path: ['resident_country'], label: 'residency', rule: { kind: 'oneOf', values: ['AE'] } },
    {
      path: ['nationalities'],
      label: 'nationality',
      rule: { kind: 'intersects', values: ['AE', 'IN', 'US', 'GB', 'SG'] },
    },
    { path: ['sanctions_status'], label: 'sanctions', rule: { kind: 'equals', value: 'CLEAR' } },
    { path: ['risk_tier'], label: 'risk tier', rule: { kind: 'oneOf', values: ['LOW', 'MEDIUM'] } },
  ],
};

const CATALOG: Record<string, PresentationPolicy> = {
  [REGULATED_ELIGIBILITY_V1.policyId]: REGULATED_ELIGIBILITY_V1,
  // Convenience alias used by the AI Agent Passport / partner call sites + tests.
  POLICY_REGULATED_SERVICE_18PLUS_V1: REGULATED_ELIGIBILITY_V1,
};

/** Look up a presentation policy by id; throws a 404 ServiceError if unknown. */
export function getPresentationPolicy(policyId: string): PresentationPolicy {
  const policy = CATALOG[policyId];
  if (!policy) {
    throw new ServiceError(`unknown presentation policy: ${policyId}`, 'POLICY_NOT_FOUND', 404);
  }
  return policy;
}

export interface PolicyEvaluation {
  status: 'ALLOWED' | 'DENIED';
  /** label -> satisfied? */
  satisfied: Record<string, boolean>;
  /** labels that failed (empty when ALLOWED). */
  reasons: string[];
}

function getByPath(claims: Record<string, unknown>, path: ClaimPath): unknown {
  let cur: unknown = claims;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

function ruleHolds(rule: ClaimRule, value: unknown): boolean {
  switch (rule.kind) {
    case 'booleanTrue':
      return value === true;
    case 'equals':
      return typeof value === 'string' && value === rule.value;
    case 'oneOf':
      return typeof value === 'string' && rule.values.includes(value);
    case 'intersects':
      return (
        Array.isArray(value) &&
        value.some((v) => typeof v === 'string' && rule.values.includes(v))
      );
  }
}

/** Evaluate verified, disclosed claims against a policy. Pure. */
export function evaluatePresentationPolicy(
  policy: PresentationPolicy,
  claims: Record<string, unknown>,
): PolicyEvaluation {
  const satisfied: Record<string, boolean> = {};
  const reasons: string[] = [];
  for (const req of policy.claims) {
    const ok = ruleHolds(req.rule, getByPath(claims, req.path));
    satisfied[req.label] = ok;
    if (!ok) reasons.push(`${req.label} not satisfied`);
  }
  return { status: reasons.length === 0 ? 'ALLOWED' : 'DENIED', satisfied, reasons };
}
