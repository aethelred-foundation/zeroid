# AI Agent Passport v1 — `POLICY_AGENT_ELIGIBILITY_VIEW_V1`

ZeroID as the **AI agent's passport**: each agent has a verifiable identity (DID),
a scoped credential, and policy bindings, so every action it takes is attributable,
governed, and audited. v1 ships a single, tightly-constrained flagship scenario —
an agent requesting an **eligibility proof on behalf of its controller**,
read-only and fully logged.

## Scope vocabulary (v1, read-only)

Controlled list (`src/services/ai/agent-passport.ts` → `AGENT_SCOPES`):
`eligibility.read` · `audit.read` · `identity.read`. Out-of-vocabulary scopes are
rejected at registration. State-changing scopes (`transactions.submit`, …) are
intentionally **not** in v1.

## Policy: `POLICY_AGENT_ELIGIBILITY_VIEW_V1`

An agent's powers are a **layered trust object** — bounded by BOTH its own
credential AND the controller's KYC/policy status. The agent may call eligibility
on behalf of its controller iff ALL hold:

| Condition | Deny code on failure |
|---|---|
| `agent.status == ACTIVE` | `AGENT_NOT_AUTHORIZED` |
| `agentCredential.status == ACTIVE` | `AGENT_NOT_AUTHORIZED` |
| `scopes` contains `eligibility.read` | `AGENT_NOT_AUTHORIZED` |
| `controller.status == ACTIVE` | `CONTROLLER_NOT_ELIGIBLE` |
| controller holds a valid KYC credential | `CONTROLLER_NOT_ELIGIBLE` |
| `agent.maxRiskTier >= controller.riskTier` | `POLICY_CONDITIONS_NOT_MET` |

On allow, the call delegates to the existing human eligibility machinery and the
decision is recorded as an `AgentAction` (`actionType = ELIGIBILITY_PROOF_REQUEST`).
This layers cleanly on top of the human eligibility policy
(`POLICY_REGULATED_SERVICE_18PLUS_V1` etc.) — the agent path is a governed wrapper,
never a bypass.

## API

`POST /api/v1/ai/agents/eligibility/proof` → `AgentEligibilityProofResponse`
(`status`, `decisionId`, `actor{agentDid,controllerDid,agentScopes}`, `proof`,
`evaluation`, `evidence{…, agentActionId}`). Errors: 400 `INVALID_INPUT`,
401 `UNAUTHENTICATED_AGENT`, 403 `AGENT_NOT_AUTHORIZED`/`CONTROLLER_MISMATCH`,
404 `AGENT_NOT_FOUND`/`CREDENTIAL_NOT_FOUND`, 422 `POLICY_CONDITIONS_NOT_MET`,
500 `INTERNAL_ERROR`.

## Implementation status

| Piece | Status |
|---|---|
| Scope vocabulary + policy (`agent-passport.ts`) | Implemented, unit-tested (no DB) |
| Agent→eligibility wrapper service (DI, `agent-eligibility.ts`) | Implemented, unit-tested |
| Route + HTTP contract / error mapping (`routes/ai/agent-eligibility.ts`) | Implemented, route-tested (service mocked) |
| Prisma additive fields (`scopes`, `maxRiskTier`, `controllerDid`, `policyId`, `decision`) | Added; `prisma generate` done; **`prisma migrate` is DB-gated** |
| Eligibility delegation (`runEligibility`) | **Integration seam** — human eligibility logic is currently inline in `routes/verification.ts`; extracting it into a callable service (without destabilising the human workflow) is the one task to go fully live |
| Frontend (agent-identity page wiring, audit agent filter) | Sprint 2 (not yet) |

## Rollout (per consultant)

Phase A schema + backend (here) → Phase B internal UI + internal "Compliance
Copilot" agent → Phase C pilot external agents. The production gate stays tied to
the human eligibility workflow; AI agents are an additive, separately-logged
vertical.
