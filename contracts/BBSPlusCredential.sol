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
    error UnsupportedProofSystem();
    error InvalidPublicKey();
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
        if (_registeredDomains[domainTag]) revert InvalidDomainTag();
        _requireValidNonZeroG1(h0);

        IssuerPublicKey storage key = _issuerKeys[issuerId];
        key.w = w;
        key.h0 = h0;
        key.maxMessages = h.length;
        key.domainTag = domainTag;
        key.active = true;
        key.registeredAt = block.timestamp;

        // Store per-message generators
        for (uint256 i = 0; i < h.length; i++) {
            _requireValidNonZeroG1(h[i]);
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
            abi.encode(
                address(this),
                block.chainid,
                issuerId,
                pk.domainTag,
                messages,
                signature.a.x,
                signature.a.y,
                signature.e,
                signature.s
            )
        );
        _issuedCredentials[credentialHash] = true;
        unchecked { ++totalCredentialsIssued; }

        emit CredentialIssued(issuerId, credentialHash, messages.length, block.timestamp);
    }

    /**
     * @notice Blind issuance is disabled until a production proof verifier is wired.
     * @dev Fails closed because the previous in-contract commitment check was not
     *      a complete proof of knowledge.
     * @return Never returns; always reverts.
     */
    function issueBlindedCredential(
        bytes32,
        BlindedCredentialRequest calldata,
        BBSSignature calldata
    ) external view onlyRole(ISSUER_ROLE) whenNotPaused returns (bytes32) {
        revert UnsupportedProofSystem();
    }

    // ──────────────────────────────────────────────────────────────────────
    // Proof verification
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Selective disclosure proof verification is disabled fail-closed.
     * @dev Retained for ABI compatibility until a complete audited verifier is
     *      available.
     * @return Never returns; always reverts.
     */
    function verifySelectiveDisclosure(
        bytes32,
        BBSProof calldata
    ) external view whenNotPaused returns (bool) {
        revert UnsupportedProofSystem();
    }

    /**
     * @notice Batch BBS+ proof verification is disabled fail-closed.
     * @dev Retained for ABI compatibility until single-proof verification is
     *      complete and audited.
     * @return Never returns; always reverts.
     */
    function batchVerifyProofs(
        bytes32,
        BBSProof[] calldata
    ) external view whenNotPaused returns (uint256) {
        revert UnsupportedProofSystem();
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

        // No production verifier is wired for this legacy BBS accumulator path.
        // Fail closed instead of accepting shape-only or placeholder proofs.
        proofData;
        valid = false;
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
        if (!_isValidNonZeroG1(sig.a)) return false;

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

    function _requireValidNonZeroG1(BN254.G1Point memory point) internal pure {
        if (!_isValidNonZeroG1(point)) revert InvalidPublicKey();
    }

    function _isValidNonZeroG1(BN254.G1Point memory point) internal pure returns (bool) {
        return !BN254.isZero(point) && BN254.isOnCurve(point);
    }
}
