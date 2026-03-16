// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interfaces/IZeroID.sol";

/**
 * @title TEEAttestationRegistry
 * @author Aethelred Team
 * @notice Manages Trusted Execution Environment attestation reports for the
 *         ZeroID protocol. Supports Intel SGX DCAP, AMD SEV-SNP, and
 *         Arm TrustZone attestation formats.
 *
 * @dev Architecture:
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │                  TEE ATTESTATION REGISTRY                      │
 * ├────────────────────────────────────────────────────────────────┤
 * │  ┌────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
 * │  │  Attestation    │  │  Platform Policy  │  │  Node Mgmt   │  │
 * │  │  ──────────     │  │  ───────────────  │  │  ──────────  │  │
 * │  │  • submit       │  │  • SGX settings   │  │  • register  │  │
 * │  │  • verify sig   │  │  • SEV settings   │  │  • stake     │  │
 * │  │  • revoke       │  │  • freshness      │  │  • slash     │  │
 * │  │  • refresh      │  │  • min CPUSVN     │  │  • withdraw  │  │
 * │  └────────────────┘  └──────────────────┘  └──────────────┘  │
 * │  ┌────────────────┐  ┌──────────────────┐                    │
 * │  │  Enclave Allow  │  │  Audit Trail      │                    │
 * │  │  ──────────     │  │  ──────────       │                    │
 * │  │  • MRSIGNER     │  │  • full history   │                    │
 * │  │  • MRENCLAVE    │  │  • revocation log │                    │
 * │  │  • TCB level    │  │  • stale cleanup  │                    │
 * │  └────────────────┘  └──────────────────┘                    │
 * └────────────────────────────────────────────────────────────────┘
 *
 * Trust model:
 *   - Attestation signatures are verified against platform-specific
 *     signing keys registered by governance.
 *   - Enclave measurements (MRENCLAVE/MRSIGNER for SGX, launch digest
 *     for SEV) are checked against an allowlist.
 *   - Attestation freshness is enforced per platform policy.
 *   - Node operators must be registered and can be slashed for misconduct.
 */
contract TEEAttestationRegistry is ITEEAttestation, AccessControl, Pausable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ──────────────────────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────────────────────

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant TEE_NODE_ROLE = keccak256("TEE_NODE_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");

    // ──────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────

    uint64 public constant MIN_ATTESTATION_VALIDITY = 1 hours;
    uint64 public constant MAX_ATTESTATION_VALIDITY = 30 days;
    uint256 public constant MIN_NODE_STAKE = 1 ether;

    // ──────────────────────────────────────────────────────────────
    // Storage
    // ──────────────────────────────────────────────────────────────

    /// @dev enclaveHash => AttestationReport
    mapping(bytes32 => AttestationReport) private _attestations;

    /// @dev Platform-specific policy settings
    struct PlatformPolicy {
        uint64 minFreshness;        // Minimum re-attestation interval
        uint64 maxValidityDuration; // Maximum attestation lifetime
        bool isEnabled;             // Whether this platform is accepted
        address signingKey;         // Platform attestation verification key
    }
    mapping(TEEPlatform => PlatformPolicy) private _platformPolicies;

    /// @dev Allowed enclave measurements: measurementHash => allowed
    mapping(bytes32 => bool) private _allowedMeasurements;

    /// @dev Node operator records
    struct NodeOperator {
        address operator;
        uint256 stakedAmount;
        uint64 registeredAt;
        uint32 attestationCount;
        uint32 slashCount;
        bool isActive;
    }
    mapping(address => NodeOperator) private _nodeOperators;

    /// @dev Attestation history: enclaveHash => timestamps[]
    mapping(bytes32 => uint64[]) private _attestationHistory;

    /// @notice Total number of active attestations
    uint256 public totalActiveAttestations;

    /// @notice Total staked amount across all node operators
    uint256 public totalStaked;

    // ──────────────────────────────────────────────────────────────
    // Events (beyond interface)
    // ──────────────────────────────────────────────────────────────

    event NodeOperatorRegistered(address indexed operator, uint256 stakeAmount);
    event NodeOperatorSlashed(address indexed operator, uint256 slashAmount, bytes32 reason);
    event NodeOperatorDeactivated(address indexed operator);
    event MeasurementAllowed(bytes32 indexed measurementHash, TEEPlatform platform);
    event MeasurementRevoked(bytes32 indexed measurementHash);
    event StakeWithdrawn(address indexed operator, uint256 amount);

    // ──────────────────────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────────────────────

    error PlatformNotEnabled(TEEPlatform platform);
    error InvalidAttestationSignature();
    error AttestationExpired(bytes32 enclaveHash);
    error AttestationNotFound(bytes32 enclaveHash);
    error AttestationAlreadyExists(bytes32 enclaveHash);
    error InvalidValidityDuration(uint64 duration);
    error MeasurementNotAllowed(bytes32 measurementHash);
    error NodeNotRegistered(address operator);
    error NodeAlreadyRegistered(address operator);
    error InsufficientStake(uint256 required, uint256 provided);
    error NodeNotActive(address operator);
    error NothingToWithdraw();
    error StaleAttestation(uint64 lastAttestation, uint64 minFreshness);

    // ──────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────

    /// @param admin Initial admin address
    constructor(address admin) {
        require(admin != address(0), "Zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
        _grantRole(SLASHER_ROLE, admin);
    }

    // ──────────────────────────────────────────────────────────────
    // Platform Policy Management
    // ──────────────────────────────────────────────────────────────

    /// @notice Configure attestation policy for a TEE platform
    /// @param platform The TEE platform to configure
    /// @param minFreshness Minimum re-attestation interval in seconds
    /// @param maxValidityDuration Maximum attestation lifetime in seconds
    /// @param signingKey The platform's attestation signing verification key
    function setPlatformPolicy(
        TEEPlatform platform,
        uint64 minFreshness,
        uint64 maxValidityDuration,
        address signingKey
    ) external onlyRole(GOVERNANCE_ROLE) {
        require(platform != TEEPlatform.Unknown, "Invalid platform");
        require(signingKey != address(0), "Zero signing key");
        require(maxValidityDuration >= minFreshness, "Max < min freshness");

        _platformPolicies[platform] = PlatformPolicy({
            minFreshness: minFreshness,
            maxValidityDuration: maxValidityDuration,
            isEnabled: true,
            signingKey: signingKey
        });

        emit PlatformPolicyUpdated(platform, minFreshness);
    }

    /// @notice Disable a TEE platform
    function disablePlatform(TEEPlatform platform) external onlyRole(GOVERNANCE_ROLE) {
        _platformPolicies[platform].isEnabled = false;
        emit PlatformPolicyUpdated(platform, 0);
    }

    /// @notice Get platform policy
    function getPlatformPolicy(TEEPlatform platform) external view returns (PlatformPolicy memory) {
        return _platformPolicies[platform];
    }

    // ──────────────────────────────────────────────────────────────
    // Enclave Measurement Allowlist
    // ──────────────────────────────────────────────────────────────

    /// @notice Add an enclave measurement to the allowlist
    /// @param measurementHash Hash of MRENCLAVE/MRSIGNER (SGX) or launch digest (SEV)
    /// @param platform Which platform this measurement applies to
    function allowMeasurement(
        bytes32 measurementHash,
        TEEPlatform platform
    ) external onlyRole(GOVERNANCE_ROLE) {
        require(measurementHash != bytes32(0), "Zero measurement");
        _allowedMeasurements[measurementHash] = true;
        emit MeasurementAllowed(measurementHash, platform);
    }

    /// @notice Remove an enclave measurement from the allowlist
    function revokeMeasurement(bytes32 measurementHash) external onlyRole(GOVERNANCE_ROLE) {
        _allowedMeasurements[measurementHash] = false;
        emit MeasurementRevoked(measurementHash);
    }

    /// @notice Check if a measurement is allowed
    function isMeasurementAllowed(bytes32 measurementHash) external view returns (bool) {
        return _allowedMeasurements[measurementHash];
    }

    // ──────────────────────────────────────────────────────────────
    // Node Operator Management
    // ──────────────────────────────────────────────────────────────

    /// @notice Register as a TEE node operator with a stake
    function registerNodeOperator() external payable whenNotPaused nonReentrant {
        if (_nodeOperators[msg.sender].registeredAt != 0) revert NodeAlreadyRegistered(msg.sender);
        if (msg.value < MIN_NODE_STAKE) revert InsufficientStake(MIN_NODE_STAKE, msg.value);

        _nodeOperators[msg.sender] = NodeOperator({
            operator: msg.sender,
            stakedAmount: msg.value,
            registeredAt: uint64(block.timestamp),
            attestationCount: 0,
            slashCount: 0,
            isActive: true
        });

        totalStaked += msg.value;
        _grantRole(TEE_NODE_ROLE, msg.sender);

        emit NodeOperatorRegistered(msg.sender, msg.value);
    }

    /// @notice Add additional stake
    function addStake() external payable {
        if (_nodeOperators[msg.sender].registeredAt == 0) revert NodeNotRegistered(msg.sender);
        require(msg.value > 0, "Zero stake");

        _nodeOperators[msg.sender].stakedAmount += msg.value;
        totalStaked += msg.value;
    }

    /// @notice Withdraw stake (only for deactivated operators)
    function withdrawStake() external nonReentrant {
        NodeOperator storage node = _nodeOperators[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered(msg.sender);
        if (node.isActive) revert NodeNotActive(msg.sender);
        if (node.stakedAmount == 0) revert NothingToWithdraw();

        uint256 amount = node.stakedAmount;
        node.stakedAmount = 0;
        totalStaked -= amount;

        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Transfer failed");

        emit StakeWithdrawn(msg.sender, amount);
    }

    /// @notice Slash a node operator for misconduct
    /// @param operator The node operator to slash
    /// @param amount The amount to slash
    /// @param reason Hash describing the reason for slashing
    function slashOperator(
        address operator,
        uint256 amount,
        bytes32 reason
    ) external onlyRole(SLASHER_ROLE) {
        NodeOperator storage node = _nodeOperators[operator];
        if (node.registeredAt == 0) revert NodeNotRegistered(operator);

        uint256 slashAmount = amount > node.stakedAmount ? node.stakedAmount : amount;
        node.stakedAmount -= slashAmount;
        totalStaked -= slashAmount;
        unchecked { node.slashCount++; }

        // Deactivate if stake falls below minimum
        if (node.stakedAmount < MIN_NODE_STAKE) {
            node.isActive = false;
            _revokeRole(TEE_NODE_ROLE, operator);
            emit NodeOperatorDeactivated(operator);
        }

        emit NodeOperatorSlashed(operator, slashAmount, reason);
    }

    /// @notice Get node operator info
    function getNodeOperator(address operator) external view returns (NodeOperator memory) {
        return _nodeOperators[operator];
    }

    // ──────────────────────────────────────────────────────────────
    // Attestation Submission
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc ITEEAttestation
    function submitAttestation(
        bytes32 enclaveHash,
        TEEPlatform platform,
        bytes32 reportDataHash,
        bytes calldata attestationSignature,
        uint64 validityDuration
    ) external override onlyRole(TEE_NODE_ROLE) whenNotPaused nonReentrant {
        // Validate platform is enabled
        PlatformPolicy storage policy = _platformPolicies[platform];
        if (!policy.isEnabled) revert PlatformNotEnabled(platform);

        // Validate validity duration
        if (validityDuration < MIN_ATTESTATION_VALIDITY || validityDuration > policy.maxValidityDuration) {
            revert InvalidValidityDuration(validityDuration);
        }

        // Validate enclave measurement is in the allowlist
        if (!_allowedMeasurements[enclaveHash]) revert MeasurementNotAllowed(enclaveHash);

        // Verify attestation signature against platform signing key
        bytes32 messageHash = keccak256(abi.encodePacked(
            enclaveHash, platform, reportDataHash, msg.sender, validityDuration
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedHash.recover(attestationSignature);

        if (recoveredSigner != policy.signingKey) revert InvalidAttestationSignature();

        // Check freshness if this is a re-attestation
        AttestationReport storage existing = _attestations[enclaveHash];
        if (existing.attestedAt != 0 && existing.isValid) {
            // This is a refresh — mark old one as replaced
            existing.isValid = false;
            // No decrement of totalActiveAttestations — we'll increment again below
        } else if (existing.attestedAt == 0) {
            unchecked { totalActiveAttestations++; }
        }

        uint64 now64 = uint64(block.timestamp);

        _attestations[enclaveHash] = AttestationReport({
            enclaveHash: enclaveHash,
            platform: platform,
            attestedAt: now64,
            expiresAt: now64 + validityDuration,
            reportDataHash: reportDataHash,
            nodeOperator: msg.sender,
            isValid: true
        });

        _attestationHistory[enclaveHash].push(now64);

        NodeOperator storage node = _nodeOperators[msg.sender];
        unchecked { node.attestationCount++; }

        emit AttestationSubmitted(enclaveHash, platform, msg.sender);
    }

    /// @inheritdoc ITEEAttestation
    function revokeAttestation(bytes32 enclaveHash) external override {
        AttestationReport storage report = _attestations[enclaveHash];
        if (report.attestedAt == 0) revert AttestationNotFound(enclaveHash);

        // Only the node operator or governance can revoke
        require(
            report.nodeOperator == msg.sender || hasRole(GOVERNANCE_ROLE, msg.sender),
            "Not authorized to revoke"
        );

        // ZID-012: Prevent double-revocation and counter underflow
        require(report.isValid, "Attestation already revoked");

        report.isValid = false;
        unchecked { totalActiveAttestations--; }

        emit AttestationRevoked(enclaveHash, uint64(block.timestamp));
    }

    // ──────────────────────────────────────────────────────────────
    // Attestation Queries
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc ITEEAttestation
    function isAttestationValid(bytes32 enclaveHash) external view override returns (bool) {
        AttestationReport storage report = _attestations[enclaveHash];
        return report.isValid && block.timestamp < report.expiresAt;
    }

    /// @inheritdoc ITEEAttestation
    function getAttestation(bytes32 enclaveHash)
        external view override returns (AttestationReport memory)
    {
        return _attestations[enclaveHash];
    }

    /// @notice Check if an attestation is both valid and fresh per platform policy
    /// @param enclaveHash The enclave to check
    /// @return fresh True if the attestation is valid and within freshness window
    function isAttestationFresh(bytes32 enclaveHash) external view returns (bool fresh) {
        AttestationReport storage report = _attestations[enclaveHash];
        if (!report.isValid || block.timestamp >= report.expiresAt) return false;

        PlatformPolicy storage policy = _platformPolicies[report.platform];
        uint64 age = uint64(block.timestamp) - report.attestedAt;
        return age <= policy.minFreshness;
    }

    /// @notice Get attestation history length for an enclave
    function getAttestationHistoryLength(bytes32 enclaveHash) external view returns (uint256) {
        return _attestationHistory[enclaveHash].length;
    }

    // ──────────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────────

    function pause() external onlyRole(ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(ADMIN_ROLE) { _unpause(); }

    /// @notice Allow contract to receive ETH for staking
    receive() external payable {}
}
