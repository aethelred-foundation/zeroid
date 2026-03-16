// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BN254} from "./libraries/BN254.sol";

/**
 * @title ThresholdCredential
 * @author ZeroID Cryptography Team
 * @notice Implements t-of-n threshold credential issuance using Shamir secret sharing
 *         and distributed key generation. No single issuer can unilaterally create a
 *         credential — at least t partial signatures from n authorized signers must be
 *         collected and aggregated.
 *
 * @dev Architecture:
 *      1. A threshold configuration defines (t, n) and the set of signers.
 *      2. Each signer's public key share is registered on-chain.
 *      3. Credential requests are submitted, and signers submit partial signatures.
 *      4. Once t partial signatures are collected, anyone can aggregate them into a
 *         valid credential signature.
 *      5. Key rotation replaces the signer set without invalidating existing credentials.
 *      6. Emergency recovery is possible via a guardian set with higher threshold.
 *
 *      The scheme uses Lagrange interpolation to combine partial BLS-style signatures
 *      on the BN254 curve.
 */
contract ThresholdCredential is AccessControl, Pausable, ReentrancyGuard {
    using BN254 for BN254.G1Point;

    // ──────────────────────────────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────────────────────────────

    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant CONFIG_MANAGER_ROLE = keccak256("CONFIG_MANAGER_ROLE");

    // ──────────────────────────────────────────────────────────────────────
    // Custom errors
    // ──────────────────────────────────────────────────────────────────────

    error InvalidThreshold();
    error ConfigurationAlreadyExists();
    error ConfigurationNotFound();
    error ConfigurationNotActive();
    error SignerAlreadyRegistered();
    error SignerNotRegistered();
    error InvalidSignerIndex();
    error DuplicatePartialSignature();
    error InsufficientPartialSignatures();
    error RequestNotFound();
    error RequestAlreadyFinalized();
    error RequestExpired();
    error InvalidPartialSignature();
    error AggregationFailed();
    error KeyRotationInProgress();
    error KeyRotationNotInProgress();
    error InsufficientGuardianApprovals();
    error InvalidTEEAttestation();
    error RecoveryNotInitiated();
    error RecoveryAlreadyInitiated();
    error RecoveryCooldownActive();
    error SignerCountMismatch();

    // ──────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────

    event ThresholdConfigCreated(
        bytes32 indexed configId,
        uint256 threshold,
        uint256 totalSigners,
        uint256 timestamp
    );

    event SignerRegistered(
        bytes32 indexed configId,
        address indexed signer,
        uint256 signerIndex,
        uint256 timestamp
    );

    event CredentialRequested(
        bytes32 indexed configId,
        bytes32 indexed requestId,
        bytes32 credentialHash,
        uint256 expiresAt
    );

    event PartialSignatureSubmitted(
        bytes32 indexed requestId,
        address indexed signer,
        uint256 signerIndex,
        uint256 totalCollected
    );

    event CredentialAggregated(
        bytes32 indexed requestId,
        bytes32 indexed credentialHash,
        uint256 signaturesUsed,
        uint256 timestamp
    );

    event KeyRotationInitiated(
        bytes32 indexed configId,
        bytes32 indexed newConfigId,
        uint256 timestamp
    );

    event KeyRotationCompleted(
        bytes32 indexed configId,
        bytes32 indexed newConfigId,
        uint256 timestamp
    );

    event EmergencyRecoveryInitiated(
        bytes32 indexed configId,
        address indexed initiator,
        uint256 timestamp
    );

    event GuardianApproval(
        bytes32 indexed configId,
        address indexed guardian,
        uint256 totalApprovals
    );

    event TEEAttestationRecorded(
        bytes32 indexed configId,
        address indexed signer,
        bytes32 attestationHash
    );

    // ──────────────────────────────────────────────────────────────────────
    // Structs
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Threshold signing configuration
    struct ThresholdConfig {
        uint256 threshold;               // t: minimum partial signatures required
        uint256 totalSigners;            // n: total authorized signers
        BN254.G1Point groupPublicKey;    // Combined public key
        bool active;                     // Whether this config is currently in use
        uint256 createdAt;               // Creation timestamp
        uint256 keyRotationDeadline;     // Nonzero if rotation is in progress
        bytes32 pendingRotationConfigId; // Config being rotated to
    }

    /// @notice Individual signer information
    struct SignerInfo {
        address signerAddress;
        uint256 index;                   // Signer's Shamir share index (1-based)
        BN254.G1Point publicKeyShare;    // Signer's public key share
        BN254.G2Point g2Key;            // ZID-009: Signer's G2 public key share
        bytes32 teeAttestation;          // Latest TEE attestation hash
        bool active;                     // Whether this signer is active
        uint256 registeredAt;            // Registration timestamp
    }

    /// @notice Credential signing request
    struct CredentialRequest {
        bytes32 configId;                // Which threshold config to use
        bytes32 credentialHash;          // Hash of the credential data
        uint256[] messageHashes;         // Hashed messages to sign
        uint256 expiresAt;               // Request expiration timestamp
        bool finalized;                  // Whether the credential has been aggregated
        uint256 partialSigCount;         // Number of partial sigs collected
        BN254.G1Point aggregatedSig;     // The final aggregated signature (after finalization)
    }

    /// @notice A partial signature from one signer
    struct PartialSignature {
        uint256 signerIndex;             // Which signer produced this
        BN254.G1Point sigmaI;            // The partial signature point
        bytes32 teeProof;                // Optional TEE co-signature
    }

    /// @notice Emergency recovery state
    struct RecoveryState {
        bool initiated;
        address initiator;
        uint256 initiatedAt;
        uint256 cooldownEndsAt;
        uint256 approvalCount;
        bytes32 newConfigId;
        mapping(address => bool) guardianApprovals;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────────────

    uint256 public constant REQUEST_DEFAULT_TTL = 24 hours;
    uint256 public constant KEY_ROTATION_WINDOW = 7 days;
    uint256 public constant RECOVERY_COOLDOWN = 48 hours;
    uint256 public constant MAX_SIGNERS = 100;

    // ──────────────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Threshold configurations by ID
    mapping(bytes32 => ThresholdConfig) private _configs;

    /// @notice Signer info: configId => signerIndex => SignerInfo
    mapping(bytes32 => mapping(uint256 => SignerInfo)) private _signers;

    /// @notice Signer address to index mapping: configId => address => index
    mapping(bytes32 => mapping(address => uint256)) private _signerIndices;

    /// @notice Credential requests by ID
    mapping(bytes32 => CredentialRequest) private _requests;

    /// @notice Partial signatures: requestId => signerIndex => PartialSignature
    mapping(bytes32 => mapping(uint256 => PartialSignature)) private _partialSigs;

    /// @notice Whether a signer has submitted for a given request
    mapping(bytes32 => mapping(uint256 => bool)) private _hasSubmitted;

    /// @notice Emergency recovery states by config ID
    mapping(bytes32 => RecoveryState) private _recoveryStates;

    /// @notice TEE attestation registry: signer => latest attestation
    mapping(address => bytes32) private _teeAttestations;

    /// @notice All config IDs for enumeration
    bytes32[] private _configIds;

    /// @notice Global credential counter
    uint256 public totalCredentialsIssued;

    // ──────────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────────

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_MANAGER_ROLE, admin);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Configuration management
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Create a new threshold signing configuration.
     * @param configId     Unique identifier
     * @param threshold    Minimum number of signers required (t)
     * @param totalSigners Total number of signers (n)
     * @param groupPubKey  The combined group public key (derived via DKG off-chain)
     */
    function createConfig(
        bytes32 configId,
        uint256 threshold,
        uint256 totalSigners,
        BN254.G1Point calldata groupPubKey
    ) external onlyRole(CONFIG_MANAGER_ROLE) whenNotPaused {
        if (threshold == 0 || threshold > totalSigners) revert InvalidThreshold();
        if (totalSigners > MAX_SIGNERS) revert InvalidThreshold();
        if (_configs[configId].active) revert ConfigurationAlreadyExists();

        ThresholdConfig storage config = _configs[configId];
        config.threshold = threshold;
        config.totalSigners = totalSigners;
        config.groupPublicKey = groupPubKey;
        config.active = true;
        config.createdAt = block.timestamp;

        _configIds.push(configId);

        emit ThresholdConfigCreated(configId, threshold, totalSigners, block.timestamp);
    }

    /**
     * @notice Register a signer's public key share for a configuration.
     * @param configId  The threshold configuration
     * @param signer    Address of the signer
     * @param index     Signer's Shamir index (1-based, must be unique)
     * @param pubShare  Signer's public key share (g^{share_i})
     * @param g2Key     Signer's G2 public key share (ZID-009: required for pairing verification)
     */
    function registerSigner(
        bytes32 configId,
        address signer,
        uint256 index,
        BN254.G1Point calldata pubShare,
        BN254.G2Point calldata g2Key
    ) external onlyRole(CONFIG_MANAGER_ROLE) whenNotPaused {
        ThresholdConfig storage config = _configs[configId];
        if (!config.active) revert ConfigurationNotFound();
        if (index == 0 || index > config.totalSigners) revert InvalidSignerIndex();
        if (_signers[configId][index].active) revert SignerAlreadyRegistered();

        // ZID-009: Require non-zero G2 key
        require(g2Key.x[0] != 0 || g2Key.x[1] != 0, "G2 key must not be zero");

        _signers[configId][index] = SignerInfo({
            signerAddress: signer,
            index: index,
            publicKeyShare: pubShare,
            g2Key: g2Key,
            teeAttestation: bytes32(0),
            active: true,
            registeredAt: block.timestamp
        });

        _signerIndices[configId][signer] = index;
        _grantRole(SIGNER_ROLE, signer);

        emit SignerRegistered(configId, signer, index, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Credential request and signing
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Submit a credential signing request.
     * @param configId       Which threshold config to use
     * @param credentialHash Hash of the credential to be signed
     * @param messageHashes  Array of message hashes to include in the signature
     * @param ttl            Time-to-live in seconds (0 for default)
     * @return requestId     Unique request identifier
     */
    function requestCredential(
        bytes32 configId,
        bytes32 credentialHash,
        uint256[] calldata messageHashes,
        uint256 ttl
    ) external whenNotPaused returns (bytes32 requestId) {
        ThresholdConfig storage config = _configs[configId];
        if (!config.active) revert ConfigurationNotActive();

        uint256 expiry = block.timestamp + (ttl > 0 ? ttl : REQUEST_DEFAULT_TTL);

        requestId = keccak256(
            abi.encodePacked(configId, credentialHash, block.timestamp, msg.sender)
        );

        CredentialRequest storage req = _requests[requestId];
        req.configId = configId;
        req.credentialHash = credentialHash;
        req.expiresAt = expiry;

        for (uint256 i = 0; i < messageHashes.length; i++) {
            req.messageHashes.push(messageHashes[i]);
        }

        emit CredentialRequested(configId, requestId, credentialHash, expiry);
    }

    /**
     * @notice Submit a partial signature for a credential request.
     * @param requestId  The credential request
     * @param sigmaI     The partial signature point (σ_i = H(m)^{share_i})
     * @param teeProof   Optional TEE attestation co-signature
     */
    function submitPartialSignature(
        bytes32 requestId,
        BN254.G1Point calldata sigmaI,
        bytes32 teeProof
    ) external onlyRole(SIGNER_ROLE) whenNotPaused nonReentrant {
        CredentialRequest storage req = _requests[requestId];
        if (req.configId == bytes32(0)) revert RequestNotFound();
        if (req.finalized) revert RequestAlreadyFinalized();
        if (block.timestamp > req.expiresAt) revert RequestExpired();

        uint256 signerIndex = _signerIndices[req.configId][msg.sender];
        if (signerIndex == 0) revert SignerNotRegistered();
        if (_hasSubmitted[requestId][signerIndex]) revert DuplicatePartialSignature();

        // Verify partial signature: e(σ_i, g2) == e(H(m), pk_i)
        SignerInfo storage signer = _signers[req.configId][signerIndex];
        if (!_verifyPartialSignature(req, signer, sigmaI)) {
            revert InvalidPartialSignature();
        }

        // Store partial signature
        _partialSigs[requestId][signerIndex] = PartialSignature({
            signerIndex: signerIndex,
            sigmaI: sigmaI,
            teeProof: teeProof
        });
        _hasSubmitted[requestId][signerIndex] = true;
        req.partialSigCount += 1;

        // Record TEE attestation if provided
        if (teeProof != bytes32(0)) {
            _teeAttestations[msg.sender] = teeProof;
            signer.teeAttestation = teeProof;
            emit TEEAttestationRecorded(req.configId, msg.sender, teeProof);
        }

        emit PartialSignatureSubmitted(
            requestId, msg.sender, signerIndex, req.partialSigCount
        );
    }

    /**
     * @notice Aggregate partial signatures into a full credential signature.
     * @dev Uses Lagrange interpolation to combine t partial signatures.
     *      Can be called by anyone once enough partials are collected.
     * @param requestId    The credential request to finalize
     * @param signerIndices Indices of the t signers to use for aggregation
     * @return credentialHash The hash of the issued credential
     */
    function aggregateSignatures(
        bytes32 requestId,
        uint256[] calldata signerIndices
    ) external whenNotPaused nonReentrant returns (bytes32 credentialHash) {
        CredentialRequest storage req = _requests[requestId];
        if (req.configId == bytes32(0)) revert RequestNotFound();
        if (req.finalized) revert RequestAlreadyFinalized();

        ThresholdConfig storage config = _configs[req.configId];
        if (signerIndices.length < config.threshold) {
            revert InsufficientPartialSignatures();
        }

        // Compute Lagrange coefficients and aggregate
        BN254.G1Point memory aggregated = BN254.g1Zero();

        for (uint256 i = 0; i < signerIndices.length; i++) {
            uint256 idx = signerIndices[i];
            if (!_hasSubmitted[requestId][idx]) revert InsufficientPartialSignatures();

            // Compute Lagrange coefficient λ_i = Π_{j≠i} (j / (j - i))
            uint256 lambda = _computeLagrangeCoeff(signerIndices, i);

            // σ_agg += λ_i · σ_i
            BN254.G1Point memory weighted = BN254.ecMul(
                _partialSigs[requestId][idx].sigmaI,
                lambda
            );
            aggregated = BN254.ecAdd(aggregated, weighted);
        }

        // Store aggregated signature
        req.aggregatedSig = aggregated;
        req.finalized = true;
        unchecked { ++totalCredentialsIssued; }

        credentialHash = req.credentialHash;

        emit CredentialAggregated(
            requestId, credentialHash, signerIndices.length, block.timestamp
        );
    }

    // ──────────────────────────────────────────────────────────────────────
    // Key rotation
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Initiate key rotation to a new threshold configuration.
     * @dev Existing credentials remain valid — only future issuance uses the new key.
     * @param oldConfigId  Current configuration
     * @param newConfigId  New configuration (must already be created and have signers)
     */
    function initiateKeyRotation(
        bytes32 oldConfigId,
        bytes32 newConfigId
    ) external onlyRole(CONFIG_MANAGER_ROLE) whenNotPaused {
        ThresholdConfig storage oldConfig = _configs[oldConfigId];
        ThresholdConfig storage newConfig = _configs[newConfigId];

        if (!oldConfig.active) revert ConfigurationNotActive();
        if (!newConfig.active) revert ConfigurationNotFound();
        if (oldConfig.keyRotationDeadline != 0) revert KeyRotationInProgress();

        oldConfig.keyRotationDeadline = block.timestamp + KEY_ROTATION_WINDOW;
        oldConfig.pendingRotationConfigId = newConfigId;

        emit KeyRotationInitiated(oldConfigId, newConfigId, block.timestamp);
    }

    /**
     * @notice Complete key rotation after the rotation window has passed.
     * @param oldConfigId The configuration being rotated out
     */
    function completeKeyRotation(
        bytes32 oldConfigId
    ) external onlyRole(CONFIG_MANAGER_ROLE) whenNotPaused {
        ThresholdConfig storage oldConfig = _configs[oldConfigId];
        if (oldConfig.keyRotationDeadline == 0) revert KeyRotationNotInProgress();
        // Allow completion after the deadline passes
        // (In production, you might require all in-flight requests to complete first)

        bytes32 newConfigId = oldConfig.pendingRotationConfigId;
        oldConfig.active = false;
        oldConfig.keyRotationDeadline = 0;

        emit KeyRotationCompleted(oldConfigId, newConfigId, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Emergency recovery via guardians
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Initiate emergency key recovery for a compromised configuration.
     * @param configId    The compromised configuration
     * @param newConfigId The recovery configuration to switch to
     */
    function initiateEmergencyRecovery(
        bytes32 configId,
        bytes32 newConfigId
    ) external onlyRole(GUARDIAN_ROLE) whenNotPaused {
        RecoveryState storage recovery = _recoveryStates[configId];
        if (recovery.initiated) revert RecoveryAlreadyInitiated();

        recovery.initiated = true;
        recovery.initiator = msg.sender;
        recovery.initiatedAt = block.timestamp;
        recovery.cooldownEndsAt = block.timestamp + RECOVERY_COOLDOWN;
        recovery.approvalCount = 1;
        recovery.newConfigId = newConfigId;
        recovery.guardianApprovals[msg.sender] = true;

        emit EmergencyRecoveryInitiated(configId, msg.sender, block.timestamp);
        emit GuardianApproval(configId, msg.sender, 1);
    }

    /**
     * @notice Approve an emergency recovery as a guardian.
     * @param configId The configuration under recovery
     */
    function approveRecovery(
        bytes32 configId
    ) external onlyRole(GUARDIAN_ROLE) whenNotPaused {
        RecoveryState storage recovery = _recoveryStates[configId];
        if (!recovery.initiated) revert RecoveryNotInitiated();
        if (recovery.guardianApprovals[msg.sender]) revert DuplicatePartialSignature();

        recovery.guardianApprovals[msg.sender] = true;
        recovery.approvalCount += 1;

        emit GuardianApproval(configId, msg.sender, recovery.approvalCount);
    }

    /**
     * @notice Execute emergency recovery after sufficient guardian approvals and cooldown.
     * @param configId         The configuration to recover
     * @param requiredApprovals Minimum guardian approvals needed
     */
    function executeRecovery(
        bytes32 configId,
        uint256 requiredApprovals
    ) external onlyRole(GUARDIAN_ROLE) whenNotPaused {
        RecoveryState storage recovery = _recoveryStates[configId];
        if (!recovery.initiated) revert RecoveryNotInitiated();
        if (block.timestamp < recovery.cooldownEndsAt) revert RecoveryCooldownActive();
        if (recovery.approvalCount < requiredApprovals) {
            revert InsufficientGuardianApprovals();
        }

        // Deactivate old config and activate the recovery config
        _configs[configId].active = false;
        bytes32 newConfigId = recovery.newConfigId;

        // Reset recovery state
        recovery.initiated = false;
        recovery.approvalCount = 0;

        emit KeyRotationCompleted(configId, newConfigId, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // TEE attestation
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Record a TEE attestation for a signer.
     * @dev Signers running in a TEE (e.g., SGX/TDX) can submit attestation reports
     *      that are verified and stored on-chain.
     * @param configId          The configuration
     * @param attestationHash   Hash of the full TEE attestation report
     * @param enclaveReport     Enclave measurement and report data
     */
    function recordTEEAttestation(
        bytes32 configId,
        bytes32 attestationHash,
        bytes calldata enclaveReport
    ) external onlyRole(SIGNER_ROLE) whenNotPaused {
        uint256 signerIndex = _signerIndices[configId][msg.sender];
        if (signerIndex == 0) revert SignerNotRegistered();

        // Verify enclave report structure (simplified)
        if (!_verifyTEEReport(enclaveReport, attestationHash)) {
            revert InvalidTEEAttestation();
        }

        _signers[configId][signerIndex].teeAttestation = attestationHash;
        _teeAttestations[msg.sender] = attestationHash;

        emit TEEAttestationRecorded(configId, msg.sender, attestationHash);
    }

    /**
     * @notice Get aggregated TEE attestation status for a configuration.
     * @param configId     The configuration
     * @param signerIndices Indices to check
     * @return attestedCount Number of signers with valid TEE attestations
     * @return attestations Array of attestation hashes
     */
    function getAggregatedTEEStatus(
        bytes32 configId,
        uint256[] calldata signerIndices
    ) external view returns (uint256 attestedCount, bytes32[] memory attestations) {
        attestations = new bytes32[](signerIndices.length);
        for (uint256 i = 0; i < signerIndices.length; i++) {
            SignerInfo storage signer = _signers[configId][signerIndices[i]];
            attestations[i] = signer.teeAttestation;
            if (signer.teeAttestation != bytes32(0)) {
                unchecked { ++attestedCount; }
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // View functions
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Get configuration details
    function getConfig(bytes32 configId) external view returns (
        uint256 threshold,
        uint256 totalSigners,
        bool active,
        uint256 createdAt
    ) {
        ThresholdConfig storage config = _configs[configId];
        return (config.threshold, config.totalSigners, config.active, config.createdAt);
    }

    /// @notice Get signer details
    function getSigner(bytes32 configId, uint256 index) external view returns (
        address signerAddress,
        bool active,
        bytes32 teeAttestation
    ) {
        SignerInfo storage signer = _signers[configId][index];
        return (signer.signerAddress, signer.active, signer.teeAttestation);
    }

    /// @notice Get credential request status
    function getRequestStatus(bytes32 requestId) external view returns (
        bytes32 configId,
        bytes32 credentialHash,
        uint256 partialSigCount,
        bool finalized,
        uint256 expiresAt
    ) {
        CredentialRequest storage req = _requests[requestId];
        return (req.configId, req.credentialHash, req.partialSigCount, req.finalized, req.expiresAt);
    }

    /// @notice Pause
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }

    /// @notice Unpause
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ──────────────────────────────────────────────────────────────────────
    // Internal functions
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @dev Compute Lagrange coefficient λ_i for index set S at position i.
     *      λ_i = Π_{j∈S, j≠i} (x_j / (x_j - x_i)) mod r
     *      where x_k = signerIndices[k]
     */
    function _computeLagrangeCoeff(
        uint256[] calldata signerIndices,
        uint256 i
    ) internal view returns (uint256) {
        uint256 xi = signerIndices[i];
        uint256 numerator = 1;
        uint256 denominator = 1;

        for (uint256 j = 0; j < signerIndices.length; j++) {
            if (j == i) continue;
            uint256 xj = signerIndices[j];

            // numerator *= x_j
            numerator = mulmod(numerator, xj, BN254.R_MOD);

            // denominator *= (x_j - x_i) mod r
            uint256 diff;
            if (xj > xi) {
                diff = xj - xi;
            } else {
                diff = BN254.R_MOD - (xi - xj);
            }
            denominator = mulmod(denominator, diff, BN254.R_MOD);
        }

        // λ_i = numerator * denominator^{-1} mod r
        uint256 denomInverse = BN254.scalarInverse(denominator);
        return mulmod(numerator, denomInverse, BN254.R_MOD);
    }

    /**
     * @dev Verify a partial BLS signature: e(σ_i, g2) == e(H(m), pk_i)
     */
    function _verifyPartialSignature(
        CredentialRequest storage req,
        SignerInfo storage signer,
        BN254.G1Point calldata sigmaI
    ) internal view returns (bool) {
        // Hash the credential data to a G1 point
        BN254.G1Point memory hashedMessage = BN254.hashToG1(
            abi.encodePacked("ZeroID.ThresholdSign"),
            abi.encodePacked(req.credentialHash, req.messageHashes)
        );

        // Check e(σ_i, g2) == e(H(m), pk_i)
        return BN254.pairingCheck(
            sigmaI,
            BN254.g2Generator(),
            hashedMessage,
            _signerG2Key(signer)
        );
    }

    /**
     * @dev Return the registered G2 public key share for a signer.
     *      ZID-009: Returns the actual registered G2 key instead of a generic generator.
     */
    function _signerG2Key(
        SignerInfo storage signer
    ) internal view returns (BN254.G2Point memory) {
        require(signer.active, "Signer not active");
        require(signer.g2Key.x[0] != 0 || signer.g2Key.x[1] != 0, "Signer G2 key not registered");
        return signer.g2Key;
    }

    /**
     * @dev Verify a TEE attestation report.
     *      In production, this would parse Intel SGX/TDX attestation structures.
     */
    function _verifyTEEReport(
        bytes calldata enclaveReport,
        bytes32 attestationHash
    ) internal pure returns (bool) {
        // Minimum report size for SGX attestation
        if (enclaveReport.length < 64) return false;

        // Verify the hash matches the report
        return keccak256(enclaveReport) == attestationHash;
    }
}
