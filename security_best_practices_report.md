# ZeroID Security Audit Report

## Executive Summary

ZeroID is not ready for production deployment in its current state.

The codebase presents itself as a privacy-preserving identity system with zk proofs, TEE attestations, threshold issuance, BBS+ credentials, and cross-chain portability, but several of the highest-trust components are implemented with placeholder or structurally weak verification logic. In multiple places, the code accepts attacker-controlled or operator-controlled data after only length checks, hash-format checks, or role checks where the architecture claims stronger cryptographic guarantees.

The most severe issues are:

1. Backend authentication can be fully bypassed with the built-in JWT fallback secret.
2. Session existence is not enforced during auth, so any correctly signed token for an existing identity is accepted.
3. TEE attestation verification does not validate the quote chain/signature and fails open when no trusted MRSIGNER values are configured.
4. Cross-chain light-client and revocation synchronization checks are placeholder hash checks, not cryptographic verification.
5. Several credential and proof systems use placeholder signatures or proofs while exposing production-like interfaces.

## Scope

Reviewed components:

- Solidity contracts under `contracts/`
- Backend API and services under `backend/src/`
- Next.js API proxy routes under `src/app/api/`
- Go SDK/server helpers under `sdk/go/`
- Rust TEE crate under `crates/zeroid-tee/`

## Methodology

- Manual code review of trust boundaries, authentication, authorization, proof verification, bridge logic, and TEE handling
- Review of project tests and security-critical implementation notes
- Local validation runs:
  - `forge test` -> passed (`382` total tests, `380` passed, `2` skipped)
  - `go test ./...` in `sdk/go` -> passed
  - `cargo test` in `crates/zeroid-tee` -> passed
  - `npm test -- src --runInBand` -> app tests were largely passing but emitted multiple React warnings
  - `npm test -- --runInBand` -> root Jest run is polluted by vendored `lib/openzeppelin-contracts` tests and is not currently scoped correctly

## Ratings

- Overall security readiness: `2/10`
- Smart contract security posture: `3/10`
- Backend auth/session security: `1/10`
- Cryptographic/zk/TEE soundness: `1/10`
- Test suite usefulness for security regression: `4/10`
- Production readiness: `Not ready`

## Critical Findings

### ZID-001: Default JWT signing secret enables full authentication bypass

- Severity: Critical
- Location: `backend/src/middleware/auth.ts:29-31`
- Evidence:
  - `process.env.JWT_SECRET ?? 'zeroid-dev-secret-replace-in-production-32bytes!'`
- Impact:
  - If `JWT_SECRET` is unset in any deployed environment, an attacker can mint arbitrary valid bearer tokens for any `sub`/`did` and authenticate as any identity.
- Fix:
  - Remove the fallback entirely.
  - Refuse startup unless a strong secret or asymmetric keypair is configured.
  - Prefer asymmetric signing (`RS256`/`EdDSA`) with key rotation support.
- Mitigation:
  - Add startup validation and deployment checks that fail closed when auth secrets are missing.

### ZID-002: Auth middleware does not require a live session record

- Severity: Critical
- Location: `backend/src/middleware/auth.ts:145-206`
- Evidence:
  - The middleware verifies the JWT, checks `revoked:${sessionId}` in Redis, then falls back to `prisma.identity.findUnique({ where: { id: jwtPayload.sub } })`.
  - It never proves the session identified by `jti` still exists in Redis or the `session` table.
- Impact:
  - Any correctly signed token referencing an existing identity is accepted even if no session was ever created for it.
  - After cache loss, partial Redis eviction, or manual DB changes, logout/revocation semantics are weaker than intended.
  - Combined with ZID-001 this becomes a full account takeover path.
- Fix:
  - Treat `jti` as mandatory.
  - Require an active session row and compare a stored token hash or session binding before authenticating.
  - Reject tokens when the session cache is missing and the backing session record cannot be found.
- Mitigation:
  - Shorten token TTLs and rotate signing keys until proper session enforcement is implemented.

### ZID-003: TEE attestation verification is structurally incomplete and fails open on trust anchors

- Severity: Critical
- Location: `backend/src/services/tee.ts:328-336`
- Location: `backend/src/services/tee.ts:368-379`
- Evidence:
  - `verifyCertificateChain()` only checks that collateral strings are present, then logs success.
  - `verifyMRSIGNERTrust()` returns success when `TRUSTED_MRSIGNERS` is empty.
- Impact:
  - A syntactically correct quote with matching `reportData` can be accepted without actual certificate-chain or quote-signature verification.
  - In the default/no-allowlist case, any enclave signer identity is accepted.
  - This lets attackers fraudulently mark identities as `teeAttested`.
- Fix:
  - Implement full quote signature verification and Intel collateral chain validation.
  - Fail closed when trust anchors are not configured.
  - Treat empty `TRUSTED_MRSIGNERS` as a fatal misconfiguration, not a warning.
- Mitigation:
  - Disable TEE-based trust decisions until real attestation verification is in place.

### ZID-004: Credential issuance and verification use placeholder signatures rather than cryptographic proofs

- Severity: Critical
- Location: `backend/src/services/credential.ts:99-107`
- Location: `backend/src/services/credential.ts:381-387`
- Location: `backend/src/services/credential.ts:300-324`
- Evidence:
  - Issuance creates a `proof.signatureValue` via a deterministic SHA-256 placeholder.
  - Verification checks status, expiry, hashes, issuer activity, subject activity, and revocation, but never verifies the credential proof/signature.
- Impact:
  - The system can present credentials as cryptographically verifiable even though the verifier never validates issuer authenticity.
  - Any database write path or compromised issuer account can create unverifiable credentials that still pass `verifyCredential()`.
- Fix:
  - Replace placeholder `signClaims()` with real issuer signing.
  - Verify the proof/signature in `verifyCredential()`.
  - Fail issuance when signing material is unavailable.
- Mitigation:
  - Label credentials as non-production/demo artifacts and avoid using them for any security decision.

## High Findings

### ZID-005: Cross-chain light client accepts arbitrary state roots after only structural checks

- Severity: High
- Location: `contracts/CrossChainIdentityBridge.sol:742-763`
- Evidence:
  - `_verifyLightClientProof()` only checks `proof.length >= 96`, `blockNumber` monotonicity, and that two hashes are nonzero.
  - It does not validate committee signatures, consensus proofs, or source chain finality.
- Impact:
  - Any compromised or malicious `LIGHT_CLIENT_UPDATER_ROLE` holder can publish arbitrary state roots.
  - Once a fake root is accepted, fraudulent bridge messages can be finalized as if they came from the source chain.
- Fix:
  - Implement real light-client verification or explicitly redesign the bridge as a trusted relayer with corresponding risk disclosures and controls.
- Mitigation:
  - Disable cross-chain bridging until proof verification is real and independently reviewed.

### ZID-006: Revocation synchronization can be forged by any bridge operator

- Severity: High
- Location: `contracts/CrossChainIdentityBridge.sol:537-553`
- Evidence:
  - `syncRevocation()` accepts the update when `keccak256(sync.updateProof) == keccak256(previousRoot, accumulatorRoot, epoch, sourceChain)`.
  - An operator can compute that `updateProof` value locally; there is no external signature or proof verification.
- Impact:
  - A bridge operator can arbitrarily advance cross-chain revocation epochs and install attacker-chosen accumulator roots.
  - Downstream chains can be tricked into treating valid credentials as revoked or revoked credentials as valid.
- Fix:
  - Require signed/state-root-bound update proofs or verify the accumulator update against a source-chain commitment.
- Mitigation:
  - Do not consume `_crossChainAccumulatorRoots` for trust decisions until this path is hardened.

### ZID-007: DID references are globally mutable by any caller

- Severity: High
- Location: `contracts/CrossChainIdentityBridge.sol:589-602`
- Evidence:
  - `registerDID()` is `external whenNotPaused` with no ownership, role, or prior-state checks.
  - It overwrites `_didReferences[didHash]` unconditionally.
- Impact:
  - Any user can front-run or overwrite another DID’s document reference and home-chain metadata.
  - This breaks DID integrity and can redirect resolvers to attacker-controlled documents.
- Fix:
  - Bind DID updates to a controller key, verified signature, or governance/admin workflow.
  - Prevent unauthorized overwrites.
- Mitigation:
  - Treat on-chain DID references as untrusted until update authorization exists.

### ZID-008: AI agent operations are not authenticated to the agent owner

- Severity: High
- Location: `contracts/AIAgentRegistry.sol:490-555`
- Location: `contracts/AIAgentRegistry.sol:599-625`
- Evidence:
  - `delegateCapability()` does not verify `msg.sender` controls `fromAgentId`.
  - `invokeCapability()` does not verify `msg.sender` controls `agentId`.
- Impact:
  - Any external caller can delegate capabilities away from another agent or invoke capabilities on another agent’s behalf.
  - This breaks the core ownership and capability model.
- Fix:
  - Require `msg.sender == _agents[fromAgentId].owner` for delegation and `msg.sender == _agents[agentId].owner` for invocation, or a formally defined delegated actor model.
- Mitigation:
  - Do not use the AI agent registry for authorization until caller-agent binding is enforced.

### ZID-009: Threshold signature verification ignores signer-specific public keys

- Severity: High
- Location: `contracts/ThresholdCredential.sol:726-736`
- Evidence:
  - `_signerG2Key()` returns `BN254.g2Generator()` for every signer instead of a signer-specific G2 share.
- Impact:
  - Partial signature verification is no longer tied to the registered signer’s key share.
  - The threshold issuance logic does not provide the intended assurance that each partial came from a distinct authorized signer.
- Fix:
  - Register and verify real signer-specific G2 key shares, or redesign the on-chain verification accordingly.
- Mitigation:
  - Treat threshold issuance as demonstrative only, not cryptographically sound.

### ZID-010: Selective disclosure proofs are not bound on-chain to the request context or credential statement

- Severity: High
- Location: `contracts/SelectiveDisclosure.sol:293-306`
- Location: `contracts/SelectiveDisclosure.sol:399-423`
- Evidence:
  - The contract verifies a Merkle path for `req.attributeHashes` against the credential root.
  - It separately accepts any `circuitId` and `publicInputs` that the external verifier approves.
  - The contract never checks that the zk proof’s public inputs commit to `requestId`, `credentialHash`, `subjectDid`, `attributeHashes`, or `cred.merkleRoot`.
- Impact:
  - A proof for an unrelated statement can be replayed alongside a valid Merkle path if the registered circuit does not itself enforce the same bindings.
  - This can let verifiers accept disclosure proofs that are not cryptographically tied to the specific request.
- Fix:
  - Enforce a canonical public-input schema on-chain and bind request context, credential root, subject, disclosed attributes, and nullifier domain into the verified statement.
- Mitigation:
  - Restrict accepted circuits to a single audited disclosure circuit with documented public-input semantics.

## Medium Findings

### ZID-011: Rate limiting trusts spoofable forwarding headers

- Severity: Medium
- Location: `backend/src/middleware/rateLimit.ts:154-159`
- Location: `sdk/go/server/middleware.go:74-90`
- Evidence:
  - Both implementations prefer `X-Forwarded-For`/`X-Real-IP` directly without verifying a trusted proxy chain.
- Impact:
  - Attackers can rotate spoofed IP headers to evade rate limits and brute-force protections.
- Fix:
  - Only trust forwarding headers when the app is behind a known proxy topology.
  - Otherwise use the socket peer address.
- Mitigation:
  - Enforce rate limiting at the ingress/load balancer layer as well.

### ZID-012: TEE attestation revocation can corrupt global counters through repeated revokes

- Severity: Medium
- Location: `contracts/TEEAttestationRegistry.sol:363-376`
- Evidence:
  - `revokeAttestation()` unconditionally sets `report.isValid = false` and performs `unchecked { totalActiveAttestations--; }`.
  - It does not check whether the attestation was already invalid.
- Impact:
  - An authorized revoker can call the function repeatedly and wrap `totalActiveAttestations`, corrupting accounting and any monitoring built on it.
- Fix:
  - Reject already-invalid attestations and use checked arithmetic.
- Mitigation:
  - Avoid using `totalActiveAttestations` as a safety invariant until the counter logic is fixed.

## Additional Observations

- The Foundry suites currently pass despite the issues above. This indicates the tests mostly encode intended/demo behavior, not adversarial or production-grade security invariants.
- Multiple crypto modules explicitly document themselves as placeholders or simplified implementations:
  - `contracts/AccumulatorRevocation.sol`
  - `contracts/BBSPlusCredential.sol`
  - `contracts/ThresholdCredential.sol`
  - `sdk/go/crypto/bbs.go`
  - `sdk/go/crypto/accumulator.go`
- The Rust TEE verifier (`crates/zeroid-tee/src/attestation/verifier.rs`) is policy-oriented and accepts any report when no trusted measurements are configured. That may be intentional for a library, but it is unsafe as a production default.

## Recommended Remediation Order

1. Remove the default JWT secret and enforce real session existence checks.
2. Disable or quarantine TEE-based trust decisions until certificate-chain and quote verification are fully implemented.
3. Disable cross-chain bridging and revocation sync until real proof verification exists.
4. Replace placeholder credential signatures/proofs with real cryptographic verification paths.
5. Add explicit caller-to-owner authorization checks in `AIAgentRegistry`.
6. Rework threshold/BBS+/accumulator modules so on-chain checks match the security claims in the docs.
7. Add adversarial tests for auth bypass, unauthorized state mutation, replay, forged bridge updates, and fake proofs.

## Final Verdict

ZeroID currently reads as a high-ambition prototype with strong product direction but prototype-grade trust assumptions. The branding and interfaces communicate top-tier cryptographic assurance, while several implementations still rely on placeholder checks. That mismatch is the main risk: integrators and users could make production trust decisions based on guarantees the code does not yet actually enforce.
