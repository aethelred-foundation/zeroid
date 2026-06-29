# OpenID4VP / OpenID4VCI — version & format pin

**Status:** Normative for the ZeroID implementation
**Date:** 2026-06-30
**Why this file exists:** version/format drift between the Wallet and ZeroID is
the #1 interop risk (the OpenID4VP / OpenID4VCI / SD-JWT VC drafts moved fast
through 2025–2026, and format identifiers changed across drafts — e.g.
`vc+sd-jwt` → `dc+sd-jwt`). This document is the single source of truth for the
exact wire constants ZeroID emits and accepts. **The Wallet must match these.**

> Any change here is a breaking interop change: bump the table, coordinate with
> the Wallet team, and update the constants in code (linked below) in lockstep.

---

## 1. Specifications pinned

| Spec | Target | Notes |
|------|--------|-------|
| **OpenID4VP** | 1.0 | Verifier requests `vp_token`; query via **DCQL** (primary). Presentation Exchange 2.x supported only if the Wallet cannot do DCQL. |
| **OpenID4VCI** | 1.0 | **Pre-Authorized-Code** flow is the pinned issuance path. |
| **SD-JWT VC** | IETF `draft-ietf-oauth-sd-jwt-vc` | Selective disclosure + holder key binding. |
| **SD-JWT (core)** | IETF `draft-ietf-oauth-selective-disclosure-jwt` | `_sd` digests, `_sd_alg=sha-256`. |
| **Token Status List** | IETF `draft-ietf-oauth-status-list` | Revocation, mapped onto on-chain `AccumulatorRevocation` (not yet wired). |
| **mdoc / mDL** | ISO/IEC 18013-5 | Secondary format — not implemented yet (phase 2). |
| **eIDAS 2.0 / EUDI ARF** | alignment target | Standards-aligned; not certified for the pilot. |

---

## 2. Format identifiers (exact strings on the wire)

| Purpose | Value | Source of truth (code) |
|---------|-------|------------------------|
| SD-JWT VC (DCQL `format`, issuer JWT `typ`) | `dc+sd-jwt` | `SD_JWT_VC_FORMAT` — [dcql.ts](../../backend/src/services/oid4vp/dcql.ts) |
| ZeroID ZK eligibility predicate (`typ` + DCQL `format`) | `zeroid-zk-eligibility+jwt` | `ZK_ELIGIBILITY_FORMAT` — [zk-predicate.ts](../../backend/src/services/oid4vp/zk-predicate.ts) |
| OpenID4VCI key-proof of possession (`typ`) | `openid4vci-proof+jwt` | [oid4vci/jose.ts](../../backend/src/services/oid4vci/jose.ts) |
| SD-JWT Key-Binding JWT (`typ`) | `kb+jwt` | [oid4vp/sd-jwt.ts](../../backend/src/services/oid4vp/sd-jwt.ts) |
| SD-JWT digest algorithm | `sha-256` (`_sd_alg`) | [sd-jwt-issuer.ts](../../backend/src/services/oid4vci/sd-jwt-issuer.ts) |
| Issuer JWT / proof signing alg | `ES256` | issuance + verification adapters |

---

## 3. OpenID4VP request parameters (verifier → Wallet)

| Parameter | Pinned value |
|-----------|--------------|
| `response_type` | `vp_token` |
| `response_mode` | `direct_post` (cross-device); `direct_post.jwt` (encrypted) is a planned upgrade |
| Query | `dcql_query` (DCQL). The policy compiles to a DCQL query with a `credential_sets` **alternative**: the Wallet may present EITHER the SD-JWT VC (`eligibility`) OR the ZK predicate (`eligibility_zk`). |
| `client_id` scheme | `x509_san_dns` or `verifier_attestation` until the Aethelred `did` method is registered — **Wallet team to confirm** |
| `nonce` | verifier-issued, single-use (consumed atomically on callback) |
| Endpoints | `request_uri` → `GET /api/v1/oid4vp/request/:state`; `response_uri` → `POST /api/v1/oid4vp/callback` |

## 4. OpenID4VCI issuance parameters (issuer ↔ Wallet)

| Item | Pinned value |
|------|--------------|
| Grant type | `urn:ietf:params:oauth:grant-type:pre-authorized_code` |
| Metadata | `GET /api/v1/oid4vci/.well-known/openid-credential-issuer` |
| Token / credential endpoints | `POST /api/v1/oid4vci/token`, `POST /api/v1/oid4vci/credential` |
| Proof | `proof.proof_type = jwt`, JWT `typ = openid4vci-proof+jwt`, holder key in header `jwk`, payload binds `aud` = issuer + `nonce` = `c_nonce` |
| `credential_configuration_id`s | `regulated-eligibility-v1`, `ai-agent-passport-v1` — [credential-config.ts](../../backend/src/services/oid4vci/credential-config.ts) |
| Error codes | OAuth/OID4VCI style: `invalid_grant`, `invalid_token`, `invalid_proof`, `unsupported_credential_type`, `unsupported_grant_type` |

---

## 5. Upgrade discipline

- Treat every value in §2–§4 as a wire contract. Changing one is a **major**
  interop bump.
- When the IETF/OpenID drafts advance (e.g. SD-JWT VC `typ`, a new DCQL claim
  shape, `direct_post.jwt` mandatory): update the constant in code, this table,
  and notify the Wallet/Cruzible teams in the same change.
- The ZeroID-owned **Wallet SDK** must read these constants from a shared module
  (not hard-code them) so a bump propagates by dependency upgrade, not by manual
  edits in two repos.

## 6. Open questions for the Wallet team (block the SDK)

1. Supported credential formats today: SD-JWT VC? mdoc? BBS+?
2. **DCQL** capable, or must we ship Presentation Exchange 2.x first?
3. `client_id` scheme: enterprise PKI (`x509_san_dns`) available, or
   `verifier_attestation` until the Aethelred `did` method is registered?
