# OpenID4VP / OpenID4VCI Integration Design — Wallet ↔ ZeroID

**Status:** Draft for review (consultant + Wallet team)
**Date:** 2026-06-29
**Owner:** ZeroID (ZeroID owns the SDK/clients that replicate this into Wallet & Cruzible)
**Relates to:** consultant guidance 2026-06-29 (§4 Wallet-first integration, §5 protocol standardization)

> Goal: let the Wallet (and any enterprise/government relying party) interface
> with ZeroID using the **standard** verifiable-credential exchange protocols —
> **OpenID4VCI** (issuance) and **OpenID4VP** (presentation) — instead of bespoke
> backend-to-backend calls, while preserving ZeroID's privacy moat (ZK eligibility
> predicates, warrant-bound conditional disclosure). Aligns with **eIDAS 2.0 / EUDI
> ARF** expectations (SD-JWT VC + mdoc, OpenID4VP/VCI) ahead of 2026 mandates.

---

## 1. Roles & topology

| Role | Who | Notes |
|------|-----|-------|
| **Credential Issuer** (OpenID4VCI) | ZeroID (and accredited issuers via the issuer-trust registry) | Issues KYC/eligibility credentials and the **AI Agent Passport** credential into the Wallet |
| **Holder / Wallet** | Aethelred Wallet | Custodies the user's (and delegated agents') credentials; presents them |
| **Verifier / Relying Party** (OpenID4VP) | ZeroID (on its own behalf and as a service for partners), Cruzible, external RPs | Requests a presentation, verifies it, runs policy, returns a decision/receipt |

ZeroID is **both** an Issuer and a Verifier. The Wallet is the Holder. This is the
standard EUDI triangle; ZeroID additionally provides a **verifier-as-a-service**
surface so partners (Wallet custody flows, Cruzible staking gates) don't each
re-implement verification.

---

## 2. Standards baseline (pin exact versions in implementation)

- **OpenID for Verifiable Presentations (OpenID4VP) 1.0** — verifier requests a `vp_token`; `response_type=vp_token`, `response_mode=direct_post` / `direct_post.jwt` (encrypted); same-device and cross-device (`request_uri` + QR).
- **OpenID for Verifiable Credential Issuance (OpenID4VCI) 1.0** — Credential Offer, Issuer Metadata, Token + Credential endpoints; Authorization-Code and **Pre-Authorized-Code** flows; key-bound proof of possession.
- **SD-JWT VC** (IETF) — **primary interop credential format** (selective disclosure, holder key binding). Widely adopted by EUDI.
- **ISO/IEC 18013-5 mdoc / mDL** — secondary format for mobile-document interop (optional, phase 2).
- **Query language:** DIF **Presentation Exchange 2.x** *and* OpenID4VP **DCQL** (Digital Credentials Query Language). Support DCQL as primary (it is the forward path), PEx for back-compat.
- **Revocation/status:** IETF **Token Status List** for SD-JWT VC, mapped onto ZeroID's existing on-chain **AccumulatorRevocation** + status registry.

> Action: pin the exact draft/final versions in code (`docs/integrations/openid4vp-version-pin.md`) — these specs moved fast through 2025–2026 and version drift between Wallet and ZeroID is the #1 interop risk.

---

## 3. Credential formats & the ZeroID privacy ladder

ZeroID supports a **privacy ladder** — pick per policy/relying-party trust level:

1. **SD-JWT VC (standard, selective disclosure)** — Wallet discloses only the claims the policy needs (e.g. `age_over_18=true`, `jurisdiction`). Interoperable default.
2. **BBS+ (existing `BBSPlusCredential` / `SelectiveDisclosure`)** — unlinkable selective disclosure for higher-privacy presentations.
3. **ZK eligibility predicate (ZeroID moat)** — the Wallet discloses **nothing**; it presents a **Groth16 proof** that the subject satisfies policy P (age/jurisdiction/sanctions/risk/non-revocation). Carried inside the standard `vp_token` envelope as a ZeroID-defined format (`zeroid-zk-eligibility+jwt`), verified via the conformance boundary (`src/lib/aethelred/verify.ts`).

Levels 1–2 are standard; level 3 is a **standard-compatible extension** — the
transport (OpenID4VP request/response) is unchanged, only the credential
*format* identifier and the verification routine differ. This keeps ZeroID
interoperable while strictly more private than incumbents.

---

## 4. Flow A — Issuance (OpenID4VCI): ZeroID → Wallet

Used to put a credential (KYC/eligibility attestation, or the **AI Agent Passport**
credential) into the Wallet. **Pre-Authorized-Code flow** is the default for the
ZeroID onboarding UX (ZeroID already authenticated the user).

```
ZeroID (Issuer)                         Wallet (Holder)
  | 1. Credential Offer (pre-auth code) ----> (QR / deep link)
  |    {credential_issuer, credential_configuration_ids, grants}
  | 2. GET /.well-known/openid-credential-issuer  <----
  |    (issuer metadata: formats, signing keys, endpoints)
  | 3. POST /token (pre-authorized_code [+ tx_code]) <----
  |    ----> access_token + c_nonce
  | 4. POST /credential (proof of possession: jwt over c_nonce) <----
  |    ----> SD-JWT VC (or zeroid-zk-eligibility format)
```

**New endpoints (ZeroID issuer surface):**
- `GET /.well-known/openid-credential-issuer` — issuer metadata (signing keys via the conformance boundary / `enterprise-key-signer`; PQC-hybrid keys advertised once W4c lands).
- `POST /oid4vci/credential-offer` (internal: mints offers), `POST /oid4vci/token`, `POST /oid4vci/credential`, optional `/oid4vci/deferred`, `/oid4vci/nonce`.

**Reuses:** `credential.ts` (issuance), `enterprise-key-signer.ts` / `regulatory-submission-signing.ts` (signing), `issuer-trust-service.ts` (accredited-issuer registry), DID/`identity.ts` (subject binding), anti-replay nonce store (for `c_nonce`).

---

## 5. Flow B — Presentation (OpenID4VP): Wallet → ZeroID (Verifier)

The core loop. The Wallet proves eligibility so ZeroID (or a partner) can gate an
action. Supports same-device (redirect) and cross-device (QR + `request_uri`).

```
ZeroID (Verifier)                                Wallet (Holder)
  | 1. Build Authorization Request from policyId:
  |    response_type=vp_token, response_mode=direct_post(.jwt),
  |    client_id (x509_san_dns | verifier_attestation | did),
  |    nonce, state, presentation_definition|dcql_query,
  |    client_metadata (vp_formats, response encryption jwk)
  | 2. Deliver via request_uri (signed Request Object)  ----> (QR/redirect)
  |                                                      <---- Wallet resolves, user consents
  | 3. POST {vp_token, presentation_submission, state}  <---- (direct_post)
  | 4. Verify vp_token:
  |      - signature + issuer trust (issuer-trust-service)
  |      - holder key binding (cnf) + audience + nonce (anti-replay)
  |      - status/revocation (Token Status List <-> AccumulatorRevocation)
  |      - SD-JWT disclosures  OR  ZK predicate proof (conformance boundary)
  | 5. Run the SAME policy engine (eligibilityProofHandler) on the
  |    verified claims/predicate  ----> decision + signed receipt (PolicyDecisionLedger)
```

**`policyId` → query mapping (key design point):** each ZeroID policy (e.g.
`POLICY_REGULATED_SERVICE_18PLUS_V1`) declares the credential types + claims it
needs. A `policyId` deterministically compiles to a **DCQL query** (or PEx
`presentation_definition`). This means the existing policy registry becomes the
single source of truth for *both* the on-chain/ZK eligibility path *and* the
OpenID4VP presentation request — no divergence.

**New endpoints (ZeroID verifier surface):**
- `POST /oid4vp/authorize` — create a presentation request from `{policyId, relyingAppId, …}`; returns `request_uri` + `state`.
- `GET /oid4vp/request/:id` — serves the signed Request Object (for `request_uri`).
- `POST /oid4vp/callback` — `direct_post` endpoint; verifies the `vp_token`, runs policy, returns/redirects with the decision.
- `GET /oid4vp/result/:state` — poll for the decision (cross-device).

`POST /oid4vp/verify` is intentionally unavailable (`503
OID4VP_VERIFIER_CHALLENGE_UNAVAILABLE`). It must not be integrated until the
server issues and atomically consumes a durable, authenticated-verifier-scoped
challenge and resolves the audience from a trusted relying-party registry.

**Reuses:** `verification.ts` (`eligibilityProofHandler` — the exact policy engine, unchanged), the conformance boundary (`verify.ts`, `vkeys.ts`, `encoding.ts`) for the ZK predicate format, anti-replay/nonce, `issuer-trust-service`, `AccumulatorRevocation`, `PolicyDecisionLedger` (receipt).

---

## 6. Mapping existing endpoints → OpenID4VP/VCI (reuse vs new)

| Today (bespoke) | Standard form | Disposition |
|---|---|---|
| `POST /partners/wallet/eligibility` `{ownerDid, credentialId, policyId}` | OpenID4VP presentation (Flow B) | **Wrap**: keep as a fast-path B2B API; add the OpenID4VP front for Wallet/RP interop. Both feed the same policy engine. |
| `eligibilityProofHandler` (ZK Groth16) | OpenID4VP `vp_token` with `zeroid-zk-eligibility` format | **Reuse** verbatim as the verification core behind `/oid4vp/callback`. |
| `POST /partners/wallet/disclosure` (warrant-bound) | OpenID4VP **verifier-initiated** flow + ConditionalDisclosure quorum | **Extend**: model warrant-bound reveal as a privileged presentation/disclosure request (see §7). |
| Credential issuance (`credential.ts`) | OpenID4VCI (Flow A) | **Wrap** with the issuer endpoints + metadata. |
| AI Agent Passport (`agent-eligibility`) | Agent presents a **delegated** OpenID4VP (holder = agent key, `cnf` bound to controller) | **Extend**: agent presentations carry the controller-binding + scope as VP claims. |

Net: **no rewrite** of the verification/policy core — OpenID4VP/VCI is an
interoperable *transport + format* layer in front of the existing engine, behind
the same idempotency + unified-error patterns we just standardized.

---

## 7. Conditional disclosure (warrant-bound) under OpenID4VP

Warrant-bound reveal is a **verifier-initiated, quorum-gated** special case:
the verifier (regulator/ZeroID compliance) presents a warrant; the on-chain
`ConditionalDisclosure` quorum authorizes; the Shamir key-split escrow is
reconstituted to decrypt the previously-sealed disclosure. In OpenID4VP terms
this is a presentation request with an elevated `client_id` scheme
(`verifier_attestation` carrying the warrant hash) and a response that is
gated off-band by the quorum rather than by holder consent. Document this as a
**ZeroID profile** of OpenID4VP, not vanilla OpenID4VP.

---

## 8. Security model (maps to existing controls)

- **Replay/nonce:** OpenID4VP `nonce` + OpenID4VCI `c_nonce` → ZeroID's existing anti-replay nonce store (single mechanism).
- **Holder binding:** `cnf` key in the credential; VP signed by holder key; for agents, `cnf` bound to controller DID + scope.
- **Verifier identity (`client_id` scheme):** start with `x509_san_dns` (PKI the enterprise already trusts) and `verifier_attestation`; `did` scheme once the Aethelred DID method is registered.
- **Response confidentiality:** `direct_post.jwt` (encrypted vp_token) for PII-bearing presentations.
- **Audience binding:** `aud` = the relying party; ties into the existing `relyingAppId` + audience checks in `eligibilityProofHandler`.
- **Revocation:** IETF Token Status List endpoint backed by `AccumulatorRevocation` / status registry.
- **PQC:** advertise hybrid ML-DSA-65 issuer/verifier keys in metadata once W4c is active (forward-compatible).

---

## 9. Data model (additive Prisma) — to be detailed at build time

- `PresentationRequest` (state, policyId, nonce, dcql, status, createdAt, expiresAt, result ref) — reuses the idempotency + receipt patterns.
- `CredentialOffer` (pre-auth code, configuration ids, tx_code, status).
- Credential format/config registry (issuer metadata source of truth).
- Reuse `PolicyDecisionLedger` for the verified-presentation receipt; reuse the nonce store.

All additive (the established migration pattern: tracked SQL in `docs/`).

---

## 10. Phased implementation plan (TDD, behind the existing patterns)

1. **Spec + version pin** (this doc → reviewed) + `presentation_definition`/DCQL compiler from `policyId` (pure, unit-tested). *No infra.*
2. **Verifier MVP (OpenID4VP, SD-JWT VC):** `/oid4vp/authorize` + `/oid4vp/callback`; verify SD-JWT VC; run `eligibilityProofHandler`; receipt. Cross-device is the only live flow until durable same-device verifier challenges are implemented.
3. **ZK predicate format** (`zeroid-zk-eligibility+jwt`) verified via the conformance boundary — the moat, standard-compatible. *Activates with W2c.*
4. **Issuer (OpenID4VCI):** metadata + pre-authorized-code + credential endpoint; issue the AI Agent Passport + eligibility credentials.
5. **Cross-device** (`request_uri` + QR) + `direct_post.jwt` encryption.
6. **mdoc** format + **warrant-bound profile** (§7) + **Wallet SDK** (ZeroID-owned client that wraps all of the above for the Wallet repo — consultant §4).

Steps 1–2 are buildable now without chain infra; 3 rides the W2c gate.

---

## 11. Open questions (for the Wallet team / consultant)

1. **Wallet capabilities:** which formats does the Aethelred Wallet support today — SD-JWT VC? mdoc? BBS+? This sets the interop floor.
2. **Query language:** can the Wallet do **DCQL**, or must we ship Presentation Exchange first?
3. **`client_id` scheme:** is there enterprise PKI (`x509_san_dns`) for ZeroID as verifier, or do we use `verifier_attestation` until the Aethelred `did` method is registered?
4. **Same-device vs cross-device** priority for the December pilot UX?
5. **Issuance trust:** is ZeroID the sole issuer for the pilot, or do accredited third-party issuers (via the issuer-trust registry) issue into the Wallet on day one?
6. **eIDAS/ARF target:** are we certifying against a specific ARF version / member-state profile, or standards-aligned-but-not-certified for the pilot?

---

*This is a design for review — no code has been written against it yet. On
approval, steps 1–2 (the `policyId`→DCQL compiler + the SD-JWT VP verifier MVP)
are the buildable-now starting point and become the Wallet-first integration's
backbone.*
