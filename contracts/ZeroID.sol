// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IZeroID.sol";

/**
 * @title ZeroID
 * @author Aethelred Team
 * @notice Core self-sovereign identity registry for the ZeroID protocol.
 *         Manages decentralised identifiers (DIDs), controller delegation,
 *         social-recovery, and identity lifecycle state transitions.
 *
 * @dev Architecture:
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │                       ZEROID CORE REGISTRY                     │
 * ├────────────────────────────────────────────────────────────────┤
 * │  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐  │
 * │  │  Registration │  │  Resolution     │  │  Recovery        │  │
 * │  │  ───────────  │  │  ──────────     │  │  ────────        │  │
 * │  │  • register   │  │  • resolve DID  │  │  • initiate      │  │
 * │  │  • batch      │  │  • status check │  │  • execute       │  │
 * │  │  • nonce mgmt │  │  • controller   │  │  • timelock      │  │
 * │  └──────────────┘  └────────────────┘  └──────────────────┘  │
 * │  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐  │
 * │  │  Delegation   │  │  Auth Keys     │  │  Lifecycle       │  │
 * │  │  ──────────── │  │  ──────────    │  │  ─────────       │  │
 * │  │  • delegate   │  │  • add key     │  │  • suspend       │  │
 * │  │  • revoke     │  │  • revoke key  │  │  • reactivate    │  │
 * │  │  • check      │  │  • rotate      │  │  • deactivate    │  │
 * │  └──────────────┘  └────────────────┘  └──────────────────┘  │
 * └────────────────────────────────────────────────────────────────┘
 *
 * Trust model:
 *   - Each DID is uniquely mapped to a controller address on registration.
 *   - Recovery uses a hash-committed scheme: the recovery hash is set at
 *     registration and can only be exercised by proving pre-image knowledge.
 *   - A 48-hour timelock protects recovery to give the controller time to
 *     contest a malicious recovery attempt.
 *   - PII never touches the chain — only keccak256 hashes of DIDs are stored.
 */
contract ZeroID is IIdentityRegistry, AccessControl, Pausable, ReentrancyGuard {

    // ──────────────────────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────────────────────

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ──────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────

    /// @notice Timelock duration for recovery operations
    uint64 public constant RECOVERY_TIMELOCK = 48 hours;

    /// @notice Maximum number of authentication keys per identity
    uint32 public constant MAX_AUTH_KEYS = 16;

    /// @notice Maximum batch registration size
    uint32 public constant MAX_BATCH_SIZE = 50;

    // ──────────────────────────────────────────────────────────────
    // Storage
    // ──────────────────────────────────────────────────────────────

    /// @dev didHash => Identity record
    mapping(bytes32 => Identity) private _identities;

    /// @dev controller address => didHash (reverse lookup)
    mapping(address => bytes32) private _controllerToDid;

    /// @dev didHash => delegate address => expiry timestamp
    mapping(bytes32 => mapping(address => uint64)) private _delegates;

    /// @dev didHash => authentication key hash => active flag
    mapping(bytes32 => mapping(bytes32 => bool)) private _authKeys;

    /// @dev didHash => count of authentication keys
    mapping(bytes32 => uint32) private _authKeyCount;

    /// @dev Recovery requests: didHash => pending recovery
    struct RecoveryRequest {
        address newController;
        uint64 executeAfter;
        bool active;
    }
    mapping(bytes32 => RecoveryRequest) private _recoveryRequests;

    /// @notice Total number of registered identities
    uint256 public totalIdentities;

    // ──────────────────────────────────────────────────────────────
    // Events (beyond interface)
    // ──────────────────────────────────────────────────────────────

    event DelegateAdded(bytes32 indexed didHash, address indexed delegate, uint64 expiresAt);
    event DelegateRevoked(bytes32 indexed didHash, address indexed delegate);
    event AuthKeyAdded(bytes32 indexed didHash, bytes32 indexed keyHash);
    event AuthKeyRevoked(bytes32 indexed didHash, bytes32 indexed keyHash);
    event RecoveryExecuted(bytes32 indexed didHash, address indexed newController);
    event RecoveryCancelled(bytes32 indexed didHash);

    // ──────────────────────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────────────────────

    error IdentityAlreadyExists(bytes32 didHash);
    error IdentityNotFound(bytes32 didHash);
    error NotController(bytes32 didHash, address caller);
    error InvalidStatus(IdentityStatus current, IdentityStatus required);
    error InvalidRecoveryProof();
    error RecoveryNotActive(bytes32 didHash);
    error RecoveryTimelockNotExpired(uint64 executeAfter);
    error RecoveryAlreadyActive(bytes32 didHash);
    error MaxAuthKeysReached(bytes32 didHash);
    error AuthKeyAlreadyExists(bytes32 keyHash);
    error AuthKeyNotFound(bytes32 keyHash);
    error ControllerAlreadyBound(address controller);
    error BatchSizeExceeded(uint32 size);
    error ZeroAddress();
    error ZeroHash();
    error DelegateExpired(address delegate);

    // ──────────────────────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────────────────────

    modifier onlyController(bytes32 didHash) {
        if (_identities[didHash].controller != msg.sender) {
            revert NotController(didHash, msg.sender);
        }
        _;
    }

    modifier identityExists(bytes32 didHash) {
        if (_identities[didHash].createdAt == 0) {
            revert IdentityNotFound(didHash);
        }
        _;
    }

    modifier identityActive(bytes32 didHash) {
        if (_identities[didHash].status != IdentityStatus.Active) {
            revert InvalidStatus(_identities[didHash].status, IdentityStatus.Active);
        }
        _;
    }

    // ──────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────

    /// @param admin The initial admin address receiving DEFAULT_ADMIN_ROLE
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
    }

    // ──────────────────────────────────────────────────────────────
    // Identity Registration
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc IIdentityRegistry
    function registerIdentity(
        bytes32 didHash,
        bytes32 recoveryHash
    ) external override whenNotPaused nonReentrant {
        if (didHash == bytes32(0)) revert ZeroHash();
        if (recoveryHash == bytes32(0)) revert ZeroHash();
        if (_identities[didHash].createdAt != 0) revert IdentityAlreadyExists(didHash);
        if (_controllerToDid[msg.sender] != bytes32(0)) revert ControllerAlreadyBound(msg.sender);

        uint64 now64 = uint64(block.timestamp);

        _identities[didHash] = Identity({
            didHash: didHash,
            controller: msg.sender,
            createdAt: now64,
            updatedAt: now64,
            status: IdentityStatus.Active,
            recoveryHash: recoveryHash,
            credentialCount: 0,
            nonce: 0
        });

        _controllerToDid[msg.sender] = didHash;
        unchecked { totalIdentities++; }

        emit IdentityRegistered(didHash, msg.sender, now64);
    }

    /// @notice Batch-register multiple identities in a single transaction
    /// @param didHashes Array of DID hashes
    /// @param controllers Array of controller addresses
    /// @param recoveryHashes Array of recovery commitment hashes
    function batchRegister(
        bytes32[] calldata didHashes,
        address[] calldata controllers,
        bytes32[] calldata recoveryHashes
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant {
        uint32 len = uint32(didHashes.length);
        if (len > MAX_BATCH_SIZE) revert BatchSizeExceeded(len);
        require(len == controllers.length && len == recoveryHashes.length, "Array length mismatch");

        uint64 now64 = uint64(block.timestamp);

        for (uint32 i = 0; i < len; ) {
            bytes32 dh = didHashes[i];
            address ctrl = controllers[i];
            bytes32 rh = recoveryHashes[i];

            if (dh == bytes32(0) || rh == bytes32(0)) revert ZeroHash();
            if (ctrl == address(0)) revert ZeroAddress();
            if (_identities[dh].createdAt != 0) revert IdentityAlreadyExists(dh);
            if (_controllerToDid[ctrl] != bytes32(0)) revert ControllerAlreadyBound(ctrl);

            _identities[dh] = Identity({
                didHash: dh,
                controller: ctrl,
                createdAt: now64,
                updatedAt: now64,
                status: IdentityStatus.Active,
                recoveryHash: rh,
                credentialCount: 0,
                nonce: 0
            });

            _controllerToDid[ctrl] = dh;

            emit IdentityRegistered(dh, ctrl, now64);

            unchecked { i++; }
        }

        unchecked { totalIdentities += len; }
    }

    // ──────────────────────────────────────────────────────────────
    // Identity Resolution
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc IIdentityRegistry
    function resolveIdentity(bytes32 didHash)
        external view override identityExists(didHash)
        returns (Identity memory)
    {
        return _identities[didHash];
    }

    /// @inheritdoc IIdentityRegistry
    function isActiveIdentity(bytes32 didHash) external view override returns (bool) {
        return _identities[didHash].status == IdentityStatus.Active;
    }

    /// @notice Resolve the DID hash bound to a controller address
    /// @param controller The controller address to look up
    /// @return The DID hash, or bytes32(0) if unbound
    function resolveByController(address controller) external view returns (bytes32) {
        return _controllerToDid[controller];
    }

    // ──────────────────────────────────────────────────────────────
    // Identity Lifecycle
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc IIdentityRegistry
    function updateIdentityStatus(
        bytes32 didHash,
        IdentityStatus newStatus
    ) external override identityExists(didHash) onlyRole(GOVERNANCE_ROLE) {
        Identity storage identity = _identities[didHash];
        identity.status = newStatus;
        identity.updatedAt = uint64(block.timestamp);
        unchecked { identity.nonce++; }

        emit IdentityUpdated(didHash, newStatus, uint64(block.timestamp));
    }

    /// @inheritdoc IIdentityRegistry
    function changeController(
        bytes32 didHash,
        address newController
    ) external override identityExists(didHash) identityActive(didHash) onlyController(didHash) {
        if (newController == address(0)) revert ZeroAddress();
        if (_controllerToDid[newController] != bytes32(0)) revert ControllerAlreadyBound(newController);

        Identity storage identity = _identities[didHash];
        address oldController = identity.controller;

        delete _controllerToDid[oldController];
        _controllerToDid[newController] = didHash;
        identity.controller = newController;
        identity.updatedAt = uint64(block.timestamp);
        unchecked { identity.nonce++; }

        emit ControllerChanged(didHash, oldController, newController);
    }

    // ──────────────────────────────────────────────────────────────
    // Social Recovery
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc IIdentityRegistry
    function initiateRecovery(
        bytes32 didHash,
        bytes32 recoveryProof,
        address newController
    ) external override identityExists(didHash) whenNotPaused nonReentrant {
        if (newController == address(0)) revert ZeroAddress();
        if (_recoveryRequests[didHash].active) revert RecoveryAlreadyActive(didHash);

        Identity storage identity = _identities[didHash];

        // Verify recovery proof: hash of the submitted proof must match stored commitment
        if (keccak256(abi.encodePacked(recoveryProof)) != identity.recoveryHash) {
            revert InvalidRecoveryProof();
        }

        _recoveryRequests[didHash] = RecoveryRequest({
            newController: newController,
            executeAfter: uint64(block.timestamp) + RECOVERY_TIMELOCK,
            active: true
        });

        emit RecoveryInitiated(didHash, newController);
    }

    /// @notice Execute a pending recovery after the timelock has elapsed
    /// @param didHash The DID to recover
    function executeRecovery(bytes32 didHash) external identityExists(didHash) nonReentrant {
        RecoveryRequest storage req = _recoveryRequests[didHash];
        if (!req.active) revert RecoveryNotActive(didHash);
        if (block.timestamp < req.executeAfter) revert RecoveryTimelockNotExpired(req.executeAfter);

        Identity storage identity = _identities[didHash];
        address oldController = identity.controller;
        address newController = req.newController;

        if (_controllerToDid[newController] != bytes32(0)) revert ControllerAlreadyBound(newController);

        delete _controllerToDid[oldController];
        _controllerToDid[newController] = didHash;
        identity.controller = newController;
        identity.updatedAt = uint64(block.timestamp);
        identity.status = IdentityStatus.Active;
        unchecked { identity.nonce++; }

        delete _recoveryRequests[didHash];

        emit RecoveryExecuted(didHash, newController);
        emit ControllerChanged(didHash, oldController, newController);
    }

    /// @notice Cancel a pending recovery (only by current controller)
    /// @param didHash The DID whose recovery to cancel
    function cancelRecovery(bytes32 didHash) external identityExists(didHash) onlyController(didHash) {
        if (!_recoveryRequests[didHash].active) revert RecoveryNotActive(didHash);
        delete _recoveryRequests[didHash];
        emit RecoveryCancelled(didHash);
    }

    // ──────────────────────────────────────────────────────────────
    // Delegation
    // ──────────────────────────────────────────────────────────────

    /// @notice Add a delegate with an expiry for a given DID
    /// @param didHash The identity granting delegation
    /// @param delegate The address being delegated to
    /// @param duration How long the delegation remains valid (in seconds)
    function addDelegate(
        bytes32 didHash,
        address delegate,
        uint64 duration
    ) external identityExists(didHash) identityActive(didHash) onlyController(didHash) {
        if (delegate == address(0)) revert ZeroAddress();
        require(duration > 0 && duration <= 365 days, "Invalid duration");

        uint64 expiresAt = uint64(block.timestamp) + duration;
        _delegates[didHash][delegate] = expiresAt;

        emit DelegateAdded(didHash, delegate, expiresAt);
    }

    /// @notice Revoke a delegate
    function revokeDelegate(
        bytes32 didHash,
        address delegate
    ) external identityExists(didHash) onlyController(didHash) {
        delete _delegates[didHash][delegate];
        emit DelegateRevoked(didHash, delegate);
    }

    /// @notice Check whether an address is a valid delegate for a DID
    function isValidDelegate(bytes32 didHash, address delegate) external view returns (bool) {
        uint64 expiresAt = _delegates[didHash][delegate];
        return expiresAt > 0 && block.timestamp < expiresAt;
    }

    // ──────────────────────────────────────────────────────────────
    // Authentication Keys
    // ──────────────────────────────────────────────────────────────

    /// @notice Register an authentication key for an identity
    /// @param didHash The identity to add the key to
    /// @param keyHash keccak256 hash of the public key material
    function addAuthKey(
        bytes32 didHash,
        bytes32 keyHash
    ) external identityExists(didHash) identityActive(didHash) onlyController(didHash) {
        if (keyHash == bytes32(0)) revert ZeroHash();
        if (_authKeys[didHash][keyHash]) revert AuthKeyAlreadyExists(keyHash);
        if (_authKeyCount[didHash] >= MAX_AUTH_KEYS) revert MaxAuthKeysReached(didHash);

        _authKeys[didHash][keyHash] = true;
        unchecked { _authKeyCount[didHash]++; }

        emit AuthKeyAdded(didHash, keyHash);
    }

    /// @notice Revoke an authentication key
    function revokeAuthKey(
        bytes32 didHash,
        bytes32 keyHash
    ) external identityExists(didHash) onlyController(didHash) {
        if (!_authKeys[didHash][keyHash]) revert AuthKeyNotFound(keyHash);

        _authKeys[didHash][keyHash] = false;
        unchecked { _authKeyCount[didHash]--; }

        emit AuthKeyRevoked(didHash, keyHash);
    }

    /// @notice Check whether an authentication key is valid
    function isAuthKey(bytes32 didHash, bytes32 keyHash) external view returns (bool) {
        return _authKeys[didHash][keyHash];
    }

    // ──────────────────────────────────────────────────────────────
    // Credential Count (called by CredentialRegistry)
    // ──────────────────────────────────────────────────────────────

    /// @notice Increment credential count for a DID (called by CredentialRegistry)
    /// @param didHash The identity to update
    function incrementCredentialCount(bytes32 didHash) external onlyRole(OPERATOR_ROLE) identityExists(didHash) {
        unchecked { _identities[didHash].credentialCount++; }
    }

    // ──────────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────────

    /// @notice Pause all registration and recovery operations
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /// @notice Unpause operations
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
}
