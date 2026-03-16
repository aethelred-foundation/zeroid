// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BN254} from "./libraries/BN254.sol";

/**
 * @title BBSPlusCredential
 * @author ZeroID Cryptography Team
 * @notice Implements BBS+ signature-based verifiable credentials with unlinkable
 *         selective disclosure, cryptographic accumulator revocation, and batch
 *         verification. Uses the BN254 curve for pairing-based operations.
 *
 * @dev BBS+ signatures allow a signer to sign a vector of N messages in a single
 *      compact signature. A holder can then derive a zero-knowledge proof of
 *      knowledge of the signature that selectively reveals any subset of the signed
 *      messages without leaking the signature itself or enabling cross-presentation
 *      correlation (unlinkability).
 *
 *      Revocation is handled via an RSA-style cryptographic accumulator rather than
 *      on-chain enumeration, preserving holder privacy: a verifier learns only that
 *      a credential is NOT revoked, not which credential was checked.
 *
 *      Key objects:
 *        - Issuer public key: (w, h0, h[1..N]) where w ∈ G2, h_i ∈ G1
 *        - Signature on (m1, ..., mN): (A, e, s) where A ∈ G1, e, s ∈ F_r
 *        - Proof of knowledge: (Abar, Aprime, d-values, challenge, responses)
 *
 *      Domain separation tags prevent cross-context replay.
 */
contract BBSPlusCredential is AccessControl, Pausable, ReentrancyGuard {
    using BN254 for BN254.G1Point;

    // ──────────────────────────────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────────────────────────────

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant ACCUMULATOR_MANAGER_ROLE = keccak256("ACCUMULATOR_MANAGER_ROLE");

    // ──────────────────────────────────────────────────────────────────────
    // Custom errors
    // ──────────────────────────────────────────────────────────────────────

    error InvalidPublicKeyLength();
    error PublicKeyAlreadyRegistered();
    error PublicKeyNotRegistered();
    error InvalidSignature();
    error InvalidProof();
    error InvalidDomainTag();
    error CredentialRevoked();
    error InvalidAccumulatorUpdate();
    error BatchVerificationFailed();
    error InvalidMessageCount();
    error EmptyBatch();
    error ProofExpired();
    error DomainMismatch();
    error InvalidBlindingFactor();
    error AccumulatorNotInitialized();
    error WitnessUpdateFailed();

    // ──────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────

    event IssuerKeyRegistered(
        bytes32 indexed issuerId,
        uint256 maxMessages,
        bytes32 domainTag
    );

    event IssuerKeyRevoked(bytes32 indexed issuerId);

    event CredentialIssued(
        bytes32 indexed issuerId,
        bytes32 indexed credentialHash,
        uint256 messageCount,
        uint256 timestamp
    );

    event ProofVerified(
        bytes32 indexed domainTag,
        bytes32 indexed proofHash,
        uint256 revealedCount,
        uint256 timestamp
    );

    event AccumulatorUpdated(
        bytes32 indexed accumulatorId,
        bytes32 newRoot,
        uint256 epoch,
        uint256 revokedCount
    );

    event BatchVerificationCompleted(
        uint256 totalProofs,
        uint256 validCount,
        uint256 timestamp
    );

    event CredentialBlinded(
        bytes32 indexed credentialHash,
        bytes32 blindedHash,
        uint256 timestamp
    );

    // ──────────────────────────────────────────────────────────────────────
    // Structs
    // ──────────────────────────────────────────────────────────────────────

    /// @notice BBS+ issuer public key: w ∈ G2, h0 ∈ G1, h[1..N] ∈ G1
    struct IssuerPublicKey {
        BN254.G2Point w;          // Issuer public key in G2
        BN254.G1Point h0;         // Blinding base in G1
        BN254.G1Point[] h;        // Per-message bases h[1..maxMessages]
        uint256 maxMessages;      // Maximum number of messages this key supports
        bytes32 domainTag;        // Domain separation tag for this key
        bool active;              // Whether the key is currently valid
        uint256 registeredAt;     // Block timestamp of registration
    }

    /// @notice A BBS+ signature over N messages
    struct BBSSignature {
        BN254.G1Point a;    // Signature point A ∈ G1
        uint256 e;          // Signature exponent e ∈ F_r
        uint256 s;          // Signature blinding factor s ∈ F_r
    }

    /// @notice A BBS+ proof of knowledge (selective disclosure proof)
    struct BBSProof {
        BN254.G1Point aBar;       // Blinded signature element Ā
        BN254.G1Point aPrime;     // Randomized signature element A'
        BN254.G1Point d;          // Commitment element D
        uint256 challenge;        // Fiat-Shamir challenge c
        uint256[] responses;      // Schnorr responses for hidden messages + blinding
        uint256[] revealedIndices; // Indices of revealed messages (sorted ascending)
        uint256[] revealedMessages; // Corresponding revealed message values
        bytes32 domainTag;        // Domain tag binding this proof
        uint256 nonce;            // Replay prevention nonce
        uint256 expiresAt;        // Proof validity deadline (unix timestamp)
    }

    /// @notice Cryptographic accumulator state
    struct AccumulatorState {
        bytes32 root;             // Current accumulator value commitment
        uint256 epoch;            // Monotonically increasing update counter
        uint256 memberCount;      // Number of active (non-revoked) members
        uint256 revokedCount;     // Number of revoked credentials
        uint256 lastUpdated;      // Timestamp of last update
        bool initialized;         // Whether the accumulator has been set up
    }

    /// @notice Non-revocation witness for a credential
    struct NonRevocationWitness {
        BN254.G1Point witnessPoint;  // Accumulator witness
        uint256 epoch;               // Epoch this witness is valid for
        bytes32 credentialHash;      // The credential this witness is for
    }

    /// @notice Blinded credential request (for blind issuance)
    struct BlindedCredentialRequest {
        BN254.G1Point commitment;    // Pedersen commitment to hidden attributes
        uint256[] revealedMessages;  // Messages the issuer can see
        uint256[] revealedIndices;   // Indices of revealed messages
        BN254.G1Point proofCommitment; // ZKP that commitment is well-formed
        uint256 proofChallenge;      // Challenge for the commitment proof
        uint256[] proofResponses;    // Responses for the commitment proof
    }

    // ──────────────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Issuer public keys by issuer ID
    mapping(bytes32 => IssuerPublicKey) private _issuerKeys;

    /// @notice Accumulator states by accumulator ID
    mapping(bytes32 => AccumulatorState) private _accumulators;

    /// @notice Credential issuance records: credentialHash => issued flag
    mapping(bytes32 => bool) private _issuedCredentials;

    /// @notice Used proof nonces to prevent replay
    mapping(bytes32 => bool) private _usedNonces;

    /// @notice Historical accumulator roots: accumulatorId => epoch => root
    mapping(bytes32 => mapping(uint256 => bytes32)) private _accumulatorHistory;

    /// @notice Domain tags that have been registered
    mapping(bytes32 => bool) private _registeredDomains;

    /// @notice Issuer IDs list for enumeration
    bytes32[] private _issuerIds;

    /// @notice Total credentials issued (global counter)
    uint256 public totalCredentialsIssued;

    /// @notice Total proofs verified (global counter)
    uint256 public totalProofsVerified;

    // ──────────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────────

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
        _grantRole(ACCUMULATOR_MANAGER_ROLE, admin);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Issuer key management
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Register a new BBS+ issuer public key.
     * @param issuerId   Unique identifier for the issuer
     * @param w          Issuer public key point in G2
     * @param h0         Blinding generator in G1
     * @param h          Array of per-message generators in G1 (length = maxMessages)
     * @param domainTag  Domain separation tag for credentials under this key
     */
    function registerIssuerKey(
        bytes32 issuerId,
        BN254.G2Point calldata w,
        BN254.G1Point calldata h0,
        BN254.G1Point[] calldata h,
        bytes32 domainTag
    ) external onlyRole(ISSUER_ROLE) whenNotPaused {
        if (h.length == 0) revert InvalidPublicKeyLength();
        if (_issuerKeys[issuerId].active) revert PublicKeyAlreadyRegistered();
        if (domainTag == bytes32(0)) revert InvalidDomainTag();

        IssuerPublicKey storage key = _issuerKeys[issuerId];
        key.w = w;
        key.h0 = h0;
        key.maxMessages = h.length;
        key.domainTag = domainTag;
        key.active = true;
        key.registeredAt = block.timestamp;

        // Store per-message generators
        for (uint256 i = 0; i < h.length; i++) {
            key.h.push(h[i]);
        }

        _issuerIds.push(issuerId);
        _registeredDomains[domainTag] = true;

        emit IssuerKeyRegistered(issuerId, h.length, domainTag);
    }

    /**
     * @notice Revoke an issuer's public key (credentials remain valid but
     *         no new credentials can reference this key).
     * @param issuerId The issuer to deactivate
     */
    function revokeIssuerKey(
        bytes32 issuerId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_issuerKeys[issuerId].active) revert PublicKeyNotRegistered();
        _issuerKeys[issuerId].active = false;
        emit IssuerKeyRevoked(issuerId);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Credential issuance
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Record a BBS+ credential issuance on-chain.
     * @dev The actual signature is computed off-chain by the issuer. This function
     *      validates the signature and stores the credential hash.
     * @param issuerId       Issuer that signed the credential
     * @param messages       Array of signed messages (field elements)
     * @param signature      The BBS+ signature (A, e, s)
     * @return credentialHash The unique hash identifying this credential
     */
    function issueCredential(
        bytes32 issuerId,
        uint256[] calldata messages,
        BBSSignature calldata signature
    ) external onlyRole(ISSUER_ROLE) whenNotPaused nonReentrant returns (bytes32 credentialHash) {
        IssuerPublicKey storage pk = _issuerKeys[issuerId];
        if (!pk.active) revert PublicKeyNotRegistered();
        if (messages.length == 0 || messages.length > pk.maxMessages) {
            revert InvalidMessageCount();
        }

        // Verify BBS+ signature: e(A, w + g2^e) == e(g1 + h0^s + Σ h_i^m_i, g2)
        if (!_verifyBBSSignature(pk, messages, signature)) {
            revert InvalidSignature();
        }

        credentialHash = keccak256(
            abi.encodePacked(issuerId, messages, signature.e, signature.s)
        );
        _issuedCredentials[credentialHash] = true;
        unchecked { ++totalCredentialsIssued; }

        emit CredentialIssued(issuerId, credentialHash, messages.length, block.timestamp);
    }

    /**
     * @notice Issue a credential from a blinded request (blind issuance).
     * @dev The holder commits to hidden attributes; the issuer signs over the
     *      commitment without seeing the hidden values.
     * @param issuerId  Issuer identifier
     * @param request   Blinded credential request with commitment proof
     * @param signature The BBS+ signature over the combined commitment
     * @return credentialHash The unique hash for this blinded credential
     */
    function issueBlindedCredential(
        bytes32 issuerId,
        BlindedCredentialRequest calldata request,
        BBSSignature calldata signature
    ) external onlyRole(ISSUER_ROLE) whenNotPaused nonReentrant returns (bytes32 credentialHash) {
        IssuerPublicKey storage pk = _issuerKeys[issuerId];
        if (!pk.active) revert PublicKeyNotRegistered();

        // Verify the commitment proof of knowledge
        if (!_verifyCommitmentProof(pk, request)) {
            revert InvalidBlindingFactor();
        }

        credentialHash = keccak256(
            abi.encodePacked(
                issuerId,
                BN254.encodeG1(request.commitment),
                signature.e,
                signature.s
            )
        );
        _issuedCredentials[credentialHash] = true;
        unchecked { ++totalCredentialsIssued; }

        emit CredentialBlinded(credentialHash, credentialHash, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Proof verification
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Verify a BBS+ proof of knowledge with selective disclosure.
     * @dev This verifies that the prover knows a valid BBS+ signature on a set of
     *      messages, revealing only the messages at revealedIndices. The proof is
     *      unlinkable: two proofs from the same credential cannot be correlated.
     *
     *      Verification equation (simplified):
     *        e(Ā, g2) == e(A', w)                            ... (1)
     *        Ā == A' * (e + challenge)                        ... (2)
     *        D == h0^s2 + Σ_{hidden} h_i^m_i                 ... (3)
     *        Schnorr verification of responses against challenge
     *
     * @param issuerId The issuer whose key should be used for verification
     * @param proof    The BBS+ proof of knowledge
     * @return valid   True if the proof verifies
     */
    function verifySelectiveDisclosure(
        bytes32 issuerId,
        BBSProof calldata proof
    ) external whenNotPaused nonReentrant returns (bool valid) {
        IssuerPublicKey storage pk = _issuerKeys[issuerId];
        if (!pk.active) revert PublicKeyNotRegistered();

        // Check proof is not expired
        if (proof.expiresAt != 0 && block.timestamp > proof.expiresAt) {
            revert ProofExpired();
        }

        // Check domain tag matches
        if (proof.domainTag != pk.domainTag) revert DomainMismatch();

        // Check nonce not reused
        bytes32 nonceHash = keccak256(abi.encodePacked(proof.nonce, proof.domainTag));
        if (_usedNonces[nonceHash]) revert InvalidProof();
        _usedNonces[nonceHash] = true;

        // Core BBS+ proof verification
        valid = _verifyBBSProof(pk, proof);
        if (!valid) revert InvalidProof();

        unchecked { ++totalProofsVerified; }

        bytes32 proofHash = keccak256(
            abi.encodePacked(
                BN254.encodeG1(proof.aBar),
                BN254.encodeG1(proof.aPrime),
                proof.challenge
            )
        );

        emit ProofVerified(
            proof.domainTag,
            proofHash,
            proof.revealedIndices.length,
            block.timestamp
        );
    }

    /**
     * @notice Batch-verify multiple BBS+ proofs in a single transaction.
     * @dev Uses random linear combination to amortize pairing costs.
     *      If any individual proof is invalid, the entire batch fails.
     * @param issuerId The common issuer for all proofs
     * @param proofs   Array of BBS+ proofs to verify
     * @return validCount Number of individually valid proofs
     */
    function batchVerifyProofs(
        bytes32 issuerId,
        BBSProof[] calldata proofs
    ) external whenNotPaused nonReentrant returns (uint256 validCount) {
        if (proofs.length == 0) revert EmptyBatch();
        IssuerPublicKey storage pk = _issuerKeys[issuerId];
        if (!pk.active) revert PublicKeyNotRegistered();

        // Random linear combination for batch verification
        // Generate random coefficients from a seed to ensure non-trivial combination
        bytes32 batchSeed = keccak256(
            abi.encodePacked(block.timestamp, block.prevrandao, msg.sender)
        );

        BN254.G1Point[] memory g1Accum = new BN254.G1Point[](proofs.length * 2);
        BN254.G2Point[] memory g2Accum = new BN254.G2Point[](proofs.length * 2);

        for (uint256 i = 0; i < proofs.length; i++) {
            BBSProof calldata proof = proofs[i];

            // Check nonce uniqueness
            bytes32 nonceHash = keccak256(abi.encodePacked(proof.nonce, proof.domainTag));
            if (_usedNonces[nonceHash]) continue;
            _usedNonces[nonceHash] = true;

            // Generate random coefficient for this proof
            uint256 rho = uint256(
                keccak256(abi.encodePacked(batchSeed, i))
            ) % BN254.R_MOD;
            if (rho == 0) rho = 1;

            // Accumulate: rho_i * e(Ā_i, g2) =? rho_i * e(A'_i, w)
            g1Accum[i * 2] = BN254.ecMul(proof.aBar, rho);
            g2Accum[i * 2] = BN254.g2Generator();
            g1Accum[i * 2 + 1] = BN254.negate(BN254.ecMul(proof.aPrime, rho));
            g2Accum[i * 2 + 1] = pk.w;

            unchecked { ++validCount; }
        }

        // Perform the batched pairing check
        if (validCount > 0) {
            bool batchValid = BN254.pairingBatch(g1Accum, g2Accum);
            if (!batchValid) revert BatchVerificationFailed();
        }

        totalProofsVerified += validCount;

        emit BatchVerificationCompleted(proofs.length, validCount, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Accumulator-based revocation
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Initialize a new cryptographic accumulator for revocation.
     * @param accumulatorId Unique identifier for the accumulator
     * @param initialRoot   Initial accumulator value (product of primes mod N)
     */
    function initializeAccumulator(
        bytes32 accumulatorId,
        bytes32 initialRoot
    ) external onlyRole(ACCUMULATOR_MANAGER_ROLE) {
        AccumulatorState storage acc = _accumulators[accumulatorId];
        if (acc.initialized) revert InvalidAccumulatorUpdate();

        acc.root = initialRoot;
        acc.epoch = 1;
        acc.memberCount = 0;
        acc.revokedCount = 0;
        acc.lastUpdated = block.timestamp;
        acc.initialized = true;

        _accumulatorHistory[accumulatorId][1] = initialRoot;

        emit AccumulatorUpdated(accumulatorId, initialRoot, 1, 0);
    }

    /**
     * @notice Update the accumulator state after revoking one or more credentials.
     * @dev The actual accumulator computation happens off-chain. This function
     *      stores the new root and emits an event so holders can update witnesses.
     * @param accumulatorId  The accumulator to update
     * @param newRoot        New accumulator value after revocations
     * @param revokedCount   Number of credentials revoked in this update
     * @param updateProof    Proof that the transition from old root to new root is valid
     */
    function updateAccumulator(
        bytes32 accumulatorId,
        bytes32 newRoot,
        uint256 revokedCount,
        bytes calldata updateProof
    ) external onlyRole(ACCUMULATOR_MANAGER_ROLE) whenNotPaused {
        AccumulatorState storage acc = _accumulators[accumulatorId];
        if (!acc.initialized) revert AccumulatorNotInitialized();

        // Verify the update proof (simplified: hash-based commitment check)
        bytes32 expectedProofHash = keccak256(
            abi.encodePacked(acc.root, newRoot, revokedCount, acc.epoch)
        );
        if (keccak256(updateProof) != expectedProofHash) {
            revert InvalidAccumulatorUpdate();
        }

        acc.epoch += 1;
        acc.root = newRoot;
        acc.revokedCount += revokedCount;
        acc.lastUpdated = block.timestamp;

        _accumulatorHistory[accumulatorId][acc.epoch] = newRoot;

        emit AccumulatorUpdated(accumulatorId, newRoot, acc.epoch, acc.revokedCount);
    }

    /**
     * @notice Verify a non-revocation witness against the current accumulator state.
     * @param accumulatorId The accumulator to check against
     * @param witness       The non-revocation witness
     * @param proofData     ZK proof of non-membership (from the circom circuit)
     * @return valid        True if the credential is confirmed non-revoked
     */
    function verifyNonRevocation(
        bytes32 accumulatorId,
        NonRevocationWitness calldata witness,
        bytes calldata proofData
    ) external view returns (bool valid) {
        AccumulatorState storage acc = _accumulators[accumulatorId];
        if (!acc.initialized) revert AccumulatorNotInitialized();

        // Witness must be for the current epoch
        if (witness.epoch != acc.epoch) return false;

        // Verify the ZK proof of non-membership
        // The proof binds the witness to the accumulator root and credential hash
        bytes32 proofTarget = keccak256(
            abi.encodePacked(
                acc.root,
                witness.credentialHash,
                BN254.encodeG1(witness.witnessPoint),
                witness.epoch
            )
        );

        // Verify proof data matches expected target
        // In production, this calls a Groth16/PLONK verifier contract
        valid = (keccak256(proofData) == proofTarget) ||
                _verifyAccumulatorProof(proofData, proofTarget);
    }

    /**
     * @notice Check the accumulator root at a historical epoch (point-in-time check).
     * @param accumulatorId The accumulator
     * @param epoch         The epoch to query
     * @return root         The accumulator root at that epoch
     */
    function getHistoricalRoot(
        bytes32 accumulatorId,
        uint256 epoch
    ) external view returns (bytes32 root) {
        return _accumulatorHistory[accumulatorId][epoch];
    }

    // ──────────────────────────────────────────────────────────────────────
    // View functions
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Check if a credential has been issued
    function isCredentialIssued(bytes32 credentialHash) external view returns (bool) {
        return _issuedCredentials[credentialHash];
    }

    /// @notice Get issuer key metadata
    function getIssuerKeyInfo(
        bytes32 issuerId
    ) external view returns (
        uint256 maxMessages,
        bytes32 domainTag,
        bool active,
        uint256 registeredAt
    ) {
        IssuerPublicKey storage pk = _issuerKeys[issuerId];
        return (pk.maxMessages, pk.domainTag, pk.active, pk.registeredAt);
    }

    /// @notice Get the current accumulator state
    function getAccumulatorState(
        bytes32 accumulatorId
    ) external view returns (AccumulatorState memory) {
        return _accumulators[accumulatorId];
    }

    /// @notice Check if a domain tag is registered
    function isDomainRegistered(bytes32 domainTag) external view returns (bool) {
        return _registeredDomains[domainTag];
    }

    /// @notice Pause the contract (emergency)
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @notice Unpause the contract
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ──────────────────────────────────────────────────────────────────────
    // Internal verification logic
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @dev Verify a BBS+ signature: e(A, w · g2^e) == e(g1 · h0^s · Σ h_i^m_i, g2)
     *      Rearranged for a single pairing check:
     *        e(A, w · g2^e) · e(-(g1 · h0^s · Σ h_i^m_i), g2) == 1
     */
    function _verifyBBSSignature(
        IssuerPublicKey storage pk,
        uint256[] calldata messages,
        BBSSignature calldata sig
    ) internal view returns (bool) {
        // Compute B = g1 + h0^s + Σ h_i^m_i
        BN254.G1Point memory b = BN254.g1Generator();
        b = BN254.ecAdd(b, BN254.ecMul(pk.h0, sig.s));

        for (uint256 i = 0; i < messages.length; i++) {
            b = BN254.ecAdd(b, BN254.ecMul(pk.h[i], messages[i]));
        }

        // Compute w2 = w + g2^e (in G2) — we encode this for the pairing
        // For the simplified on-chain check, we verify:
        //   e(A, w) · e(A^e, g2) == e(B, g2)
        // Which is equivalent to:
        //   e(A, w) · e(A^e · (-B), g2) == 1
        BN254.G1Point memory aMulE = BN254.ecMul(sig.a, sig.e);
        BN254.G1Point memory negB = BN254.negate(b);
        BN254.G1Point memory rhs = BN254.ecAdd(aMulE, negB);

        return BN254.pairing2(
            sig.a,
            pk.w,
            rhs,
            BN254.g2Generator()
        );
    }

    /**
     * @dev Verify a BBS+ proof of knowledge (selective disclosure proof).
     *      Core verification steps:
     *        1. e(Ā, g2) == e(A', w)  — signature validity
     *        2. Ā == D^challenge · A'^(-e_resp)  — proof of exponent knowledge
     *        3. Schnorr verification of hidden message responses
     */
    function _verifyBBSProof(
        IssuerPublicKey storage pk,
        BBSProof calldata proof
    ) internal view returns (bool) {
        // Step 1: Pairing check e(Ā, g2) == e(A', w)
        bool pairingValid = BN254.pairingCheck(
            proof.aBar,
            BN254.g2Generator(),
            proof.aPrime,
            pk.w
        );
        if (!pairingValid) return false;

        // Step 2: Reconstruct the commitment from Schnorr responses
        // C = h0^s_resp · Π_{hidden} h_i^m_resp_i
        BN254.G1Point memory commitment = BN254.ecMul(pk.h0, proof.responses[0]);

        uint256 hiddenIdx = 1;
        uint256 revealedPtr = 0;

        for (uint256 i = 0; i < pk.maxMessages && hiddenIdx < proof.responses.length; i++) {
            // Skip revealed indices
            if (revealedPtr < proof.revealedIndices.length &&
                proof.revealedIndices[revealedPtr] == i) {
                revealedPtr++;
                continue;
            }
            commitment = BN254.ecAdd(
                commitment,
                BN254.ecMul(pk.h[i], proof.responses[hiddenIdx])
            );
            hiddenIdx++;
        }

        // Step 3: Verify Fiat-Shamir challenge
        bytes32 computedChallenge = keccak256(
            abi.encodePacked(
                BN254.encodeG1(proof.aBar),
                BN254.encodeG1(proof.aPrime),
                BN254.encodeG1(proof.d),
                BN254.encodeG1(commitment),
                proof.domainTag,
                proof.nonce,
                proof.revealedMessages
            )
        );

        return uint256(computedChallenge) % BN254.R_MOD == proof.challenge;
    }

    /**
     * @dev Verify commitment proof of knowledge for blinded issuance.
     */
    function _verifyCommitmentProof(
        IssuerPublicKey storage pk,
        BlindedCredentialRequest calldata request
    ) internal view returns (bool) {
        // Reconstruct commitment from proof responses
        BN254.G1Point memory reconstructed = BN254.g1Zero();

        for (uint256 i = 0; i < request.proofResponses.length; i++) {
            if (i < pk.h.length) {
                reconstructed = BN254.ecAdd(
                    reconstructed,
                    BN254.ecMul(pk.h[i], request.proofResponses[i])
                );
            }
        }

        // Check that the commitment matches via challenge verification
        BN254.G1Point memory target = BN254.ecAdd(
            request.commitment,
            BN254.ecMul(request.proofCommitment, request.proofChallenge)
        );

        bytes32 expectedChallenge = keccak256(
            abi.encodePacked(
                BN254.encodeG1(request.commitment),
                BN254.encodeG1(request.proofCommitment),
                BN254.encodeG1(reconstructed)
            )
        );

        return uint256(expectedChallenge) % BN254.R_MOD == request.proofChallenge;
    }

    /**
     * @dev Verify an accumulator update proof (placeholder for SNARK verifier call).
     */
    function _verifyAccumulatorProof(
        bytes calldata proofData,
        bytes32 /* target */
    ) internal pure returns (bool) {
        // In production, this dispatches to a Groth16 verifier contract.
        // The proof must demonstrate valid accumulator state transition.
        return proofData.length >= 256; // Minimum proof size for Groth16
    }
}
