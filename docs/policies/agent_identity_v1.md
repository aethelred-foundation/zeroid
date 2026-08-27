# AI Agent Passport v1

ZeroID's agent identity control plane gives an operator-owned agent a DID, bounded capabilities, durable delegations, and attributable authorization records. It does not make agent eligibility proof issuance available.

## Identity and operation authorization

The current agent identity API supports operator-authenticated registration, listing, capability updates, delegation, suspension, approval handling, audit retrieval, and operation verification. The deployment must apply the reviewed Prisma migrations before enabling these routes.

An operation is authorized only against a short-lived, server-issued challenge bound to the agent, operator, audience, requested capabilities, action, resource, and operation digest. The agent signs the complete operation envelope. Challenge consumption, capability/delegation version checks, required approvals, authorization claim, and audit evidence must be committed transactionally; Redis is a cache, not the authority. Approval records are operation- and snapshot-bound and single use.

## Eligibility policy: `POLICY_AGENT_ELIGIBILITY_VIEW_V1`

The intended read-only scope vocabulary remains `eligibility.read`, `audit.read`, and `identity.read`. An eventual eligibility request must satisfy both the agent credential/delegation policy and the controller's current credential/policy state. It must never use a human bearer session, an active database row, or client-supplied controller metadata as proof that the agent authorized the operation.

## Current availability

Agent eligibility proof issuance and the Cruzible partner agent-scan path are intentionally unavailable. The reserved service fails closed with `AGENT_ELIGIBILITY_PROOF_UNAVAILABLE`; integrations must not synthesize a decision or `AgentAction` when it is returned.

Activation requires all of the following in one end-to-end design:

- a provider-signed credential witness;
- audited, digest-pinned Groth16 artifacts and a real prover/verifier;
- a durable one-time relying-party challenge and a durable one-time agent-operation challenge;
- an agent signature covering the full request context;
- atomic revalidation and persistence of both challenge consumptions, authorization, proof result, decision, and sealed evidence/audit records.

The agent identity lifecycle may be deployed independently after its migrations and normal release gates pass. Eligibility issuance remains disabled until the separate ZK and relying-party evidence gate is complete.
