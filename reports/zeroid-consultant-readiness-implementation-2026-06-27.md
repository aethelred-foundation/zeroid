# ZeroID Consultant Readiness Implementation Update — 2026-06-27

## What Changed

ZeroID now has an enforceable v1 readiness layer around the enterprise hero workflow: DID holder -> KYC credential -> eligibility proof -> durable evidence receipt.

Implemented in this pass:

- Added the eligibility policy circuit source at `circuits/eligibility/eligibility_context_proof.circom`.
- Added the pinned circuit manifest at `circuits/manifest/eligibility_v1.json`.
- Replaced hard-coded circuit validation with manifest-directory validation.
- Added manifest/source/policy-binding digests to frontend and backend eligibility receipts.
- Added backend fail-closed schema-drift checks so the registered ZK circuit cannot silently diverge from the policy manifest.
- Added readiness labels for product surfaces: Live, Configured, Preview, Unavailable.
- Added `npm run readiness:check` for pre-production readiness and `npm run readiness:production` for live release gating.
- Added CI readiness evidence checks and a production tag release gate.
- Added consultant-required docs for production gate, eligibility policy, key custody, threat model, incident response, DPIA, and enterprise integration.

## Verified

- Frontend focused tests: 84 passed.
- Frontend broader eligibility/API/client focused tests: 118 passed earlier in the pass.
- Backend eligibility route tests: 3 passed.
- Frontend type-check: passed.
- Backend type-check: passed.
- Circuit manifest/source validation: passed.
- Pre-production readiness gate: passed.

## Honest Production Status

ZeroID is now stronger and more professionally labelled as a configured pre-production platform. It is not yet Live production because the strict production gate fails on:

- `circuits:pinned-production-artifacts`

Required next step: compile and review the eligibility circuit artifacts, generate the final zkey and verification key, pin all SHA-256 digests in `ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON`, and pass `npm run readiness:production`.
