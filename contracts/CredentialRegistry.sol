// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IZeroID.sol";

/**
 * @title CredentialRegistry
 * @author Aethelred Team
 * @notice Manages the full credential lifecycle — issuance, suspension,
 *         reinstatement, revocation, and expiry — for the ZeroID protocol.
 *         Credentials are stored as Merkle-root commitments; actual claim
 *         data never touches the chain.
 *
 * @dev Architecture:
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │                    CREDENTIAL REGISTRY                         │
 * ├────────────────────────────────────────────────────────────────┤
 * │  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐  │
 * │  │  Issuance     │  │  Revocation     │  │  Verification    │  │
 * │  │  ──────────   │  │  ────────────   │  │  ────────────    │  │
 * │  │  • issue      │  │  • revoke       │  │  • status check  │  │
 * │  │  • batch      │  │  • suspend      │  │  • expiry check  │  │
 * │  │  • schema chk │  │  • reinstate    │  │  • batch verify  │  │
 * │  └──────────────┘  └────────────────┘  └──────────────────┘  │
 * │  ┌──────────────┐  ┌────────────────┐                        │
 * │  │  Revocation    │  │  Accumulator   │                        │
 * │  │  Registry      │  │  ────────────  │                        │
 * │  │  ──────────    │  │  • add member  │                        │
 * │  │  • bitmap      │  │  • remove      │                        │
 * │  │  • epoch       │  │  • witness gen │                        │
 * │  └──────────────┘  └────────────────┘                        │
 * └────────────────────────────────────────────────────────────────┘
 *
 * Trust model:
 *   - Only addresses with ISSUER_ROLE may issue or revoke credentials.
 *   - Issuers must be approved by governance (GovernanceModule).
 *   - Schemas must be registered and active before credentials can reference them.
 *   - A revocation accumulator enables efficient batch revocation checks.
 */
contract CredentialRegistry is ICredentialRegistry, AccessControl, Pausable, ReentrancyGuard {

    // ──────────────────────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────────────────────

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    // ──────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────

    uint64 public constant MAX_CREDENTIAL_VALIDITY = 365 days * 10; // 10 years
    uint32 public constant MAX_BATCH_SIZE = 100;

    // ──────────────────────────────────────────────────────────────
    // External References
    // ──────────────────────────────────────────────────────────────

    /// @notice ZeroID identity registry for DID validation
    IIdentityRegistry public immutable identityRegistry;

    // ──────────────────────────────────────────────────────────────
    // Storage
    // ──────────────────────────────────────────────────────────────

    /// @dev credentialHash => Credential
    mapping(bytes32 => Credential) private _credentials;

    /// @dev Approved schemas: schemaHash => active flag
    mapping(bytes32 => bool) private _approvedSchemas;

    /// @dev Issuer DID => list of credential hashes they have issued
    mapping(bytes32 => bytes32[]) private _issuerCredentials;

    /// @dev Subject DID => list of credential hashes held
    mapping(bytes32 => bytes32[]) private _subjectCredentials;

    /// @dev Revocation accumulator: epoch-based bitmap for efficient revocation checks
    /// @dev epoch => slot => bitmap (each bit = one credential in the set)
    uint256 public currentRevocationEpoch;
    mapping(uint256 => mapping(uint256 => uint256)) private _revocationBitmap;

    /// @dev credentialHash => (epoch, slot, bitIndex) for revocation bitmap
    struct RevocationIndex {
        uint256 epoch;
        uint128 slot;
        uint8 bitIndex;
    }
    mapping(bytes32 => RevocationIndex) private _revocationIndices;
    uint128 private _nextRevocationSlot;
    uint8 private _nextBitIndex;

    /// @notice Total credentials issued
    uint256 public totalCredentialsIssued;

    /// @notice Total credentials currently revoked
    uint256 public totalRevoked;

    // ──────────────────────────────────────────────────────────────
    // Events (beyond interface)
    // ──────────────────────────────────────────────────────────────

    event SchemaApproved(bytes32 indexed schemaHash);
    event SchemaRevoked(bytes32 indexed schemaHash);
    event RevocationEpochAdvanced(uint256 oldEpoch, uint256 newEpoch);
    event BatchCredentialsIssued(bytes32 indexed issuerDid, uint32 count);

    // ──────────────────────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────────────────────

    error CredentialAlreadyExists(bytes32 credentialHash);
    error CredentialNotFound(bytes32 credentialHash);
    error CredentialNotActive(bytes32 credentialHash);
    error CredentialAlreadyRevoked(bytes32 credentialHash);
    error SchemaNotApproved(bytes32 schemaHash);
    error InvalidExpiry(uint64 expiresAt);
    error SubjectIdentityNotActive(bytes32 subjectDid);
    error NotCredentialIssuer(bytes32 credentialHash, address caller);
    error InvalidTransition(CredentialStatus from, CredentialStatus to);
    error BatchSizeExceeded(uint32 size);

    // ──────────────────────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────────────────────

    modifier credentialExists(bytes32 credentialHash) {
        if (_credentials[credentialHash].issuedAt == 0) {
            revert CredentialNotFound(credentialHash);
        }
        _;
    }

    modifier onlyCredentialIssuer(bytes32 credentialHash) {
        Credential storage cred = _credentials[credentialHash];
        // The issuer DID's controller must be the caller
        Identity memory issuerIdentity = identityRegistry.resolveIdentity(cred.issuerDid);
        if (issuerIdentity.controller != msg.sender) {
            revert NotCredentialIssuer(credentialHash, msg.sender);
        }
        _;
    }

    // ──────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────

    /// @param admin Initial admin address
    /// @param _identityRegistry Address of the ZeroID identity registry
    constructor(address admin, address _identityRegistry) {
        require(admin != address(0), "Zero admin");
        require(_identityRegistry != address(0), "Zero registry");

        identityRegistry = IIdentityRegistry(_identityRegistry);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
    }

    // ──────────────────────────────────────────────────────────────
    // Schema Management
    // ──────────────────────────────────────────────────────────────

    /// @notice Approve a credential schema (called by governance)
    /// @param schemaHash The schema hash to approve
    function approveSchema(bytes32 schemaHash) external onlyRole(GOVERNANCE_ROLE) {
        require(schemaHash != bytes32(0), "Zero schema");
        _approvedSchemas[schemaHash] = true;
        emit SchemaApproved(schemaHash);
    }

    /// @notice Revoke a credential schema
    function revokeSchema(bytes32 schemaHash) external onlyRole(GOVERNANCE_ROLE) {
        _approvedSchemas[schemaHash] = false;
        emit SchemaRevoked(schemaHash);
    }

    /// @notice Check if a schema is approved
    function isSchemaApproved(bytes32 schemaHash) external view returns (bool) {
        return _approvedSchemas[schemaHash];
    }

    // ──────────────────────────────────────────────────────────────
    // Credential Issuance
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc ICredentialRegistry
    function issueCredential(
        bytes32 credentialHash,
        bytes32 schemaHash,
        bytes32 subjectDid,
        uint64 expiresAt,
        bytes32 merkleRoot
    ) external override onlyRole(ISSUER_ROLE) whenNotPaused nonReentrant {
        _issueCredentialInternal(credentialHash, schemaHash, subjectDid, expiresAt, merkleRoot);
    }

    /// @notice Batch-issue multiple credentials in a single transaction
    /// @param credentialHashes Array of credential hashes
    /// @param schemaHashes Array of schema hashes
    /// @param subjectDids Array of subject DID hashes
    /// @param expiresAts Array of expiry timestamps
    /// @param merkleRoots Array of Merkle roots for credential data
    function batchIssueCredentials(
        bytes32[] calldata credentialHashes,
        bytes32[] calldata schemaHashes,
        bytes32[] calldata subjectDids,
        uint64[] calldata expiresAts,
        bytes32[] calldata merkleRoots
    ) external onlyRole(ISSUER_ROLE) whenNotPaused nonReentrant {
        uint32 len = uint32(credentialHashes.length);
        if (len > MAX_BATCH_SIZE) revert BatchSizeExceeded(len);
        require(
            len == schemaHashes.length &&
            len == subjectDids.length &&
            len == expiresAts.length &&
            len == merkleRoots.length,
            "Array length mismatch"
        );

        // Resolve issuer DID from caller
        bytes32 issuerDid = _resolveCallerDid();

        for (uint32 i = 0; i < len; ) {
            _issueCredentialInternal(
                credentialHashes[i],
                schemaHashes[i],
                subjectDids[i],
                expiresAts[i],
                merkleRoots[i]
            );
            unchecked { i++; }
        }

        emit BatchCredentialsIssued(issuerDid, len);
    }

    function _issueCredentialInternal(
        bytes32 credentialHash,
        bytes32 schemaHash,
        bytes32 subjectDid,
        uint64 expiresAt,
        bytes32 merkleRoot
    ) internal {
        if (credentialHash == bytes32(0)) revert CredentialNotFound(credentialHash);
        if (_credentials[credentialHash].issuedAt != 0) revert CredentialAlreadyExists(credentialHash);
        if (!_approvedSchemas[schemaHash]) revert SchemaNotApproved(schemaHash);
        if (!identityRegistry.isActiveIdentity(subjectDid)) revert SubjectIdentityNotActive(subjectDid);

        uint64 now64 = uint64(block.timestamp);
        if (expiresAt <= now64 || expiresAt > now64 + MAX_CREDENTIAL_VALIDITY) {
            revert InvalidExpiry(expiresAt);
        }

        bytes32 issuerDid = _resolveCallerDid();

        _credentials[credentialHash] = Credential({
            credentialHash: credentialHash,
            schemaHash: schemaHash,
            issuerDid: issuerDid,
            subjectDid: subjectDid,
            issuedAt: now64,
            expiresAt: expiresAt,
            status: CredentialStatus.Active,
            merkleRoot: merkleRoot
        });

        // Assign revocation bitmap index
        _assignRevocationIndex(credentialHash);

        _issuerCredentials[issuerDid].push(credentialHash);
        _subjectCredentials[subjectDid].push(credentialHash);

        unchecked { totalCredentialsIssued++; }

        emit CredentialIssued(credentialHash, issuerDid, subjectDid);
    }

    // ──────────────────────────────────────────────────────────────
    // Credential Lifecycle
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc ICredentialRegistry
    function revokeCredential(bytes32 credentialHash)
        external override
        credentialExists(credentialHash)
        onlyRole(ISSUER_ROLE)
        onlyCredentialIssuer(credentialHash)
    {
        Credential storage cred = _credentials[credentialHash];
        if (cred.status == CredentialStatus.Revoked) revert CredentialAlreadyRevoked(credentialHash);

        cred.status = CredentialStatus.Revoked;
        _setRevocationBit(credentialHash);
        unchecked { totalRevoked++; }

        emit CredentialRevoked(credentialHash, cred.issuerDid, uint64(block.timestamp));
    }

    /// @inheritdoc ICredentialRegistry
    function suspendCredential(bytes32 credentialHash)
        external override
        credentialExists(credentialHash)
        onlyRole(ISSUER_ROLE)
        onlyCredentialIssuer(credentialHash)
    {
        Credential storage cred = _credentials[credentialHash];
        if (cred.status != CredentialStatus.Active) {
            revert InvalidTransition(cred.status, CredentialStatus.Suspended);
        }

        cred.status = CredentialStatus.Suspended;

        emit CredentialSuspended(credentialHash, cred.issuerDid, uint64(block.timestamp));
    }

    /// @inheritdoc ICredentialRegistry
    function reinstateCredential(bytes32 credentialHash)
        external override
        credentialExists(credentialHash)
        onlyRole(ISSUER_ROLE)
        onlyCredentialIssuer(credentialHash)
    {
        Credential storage cred = _credentials[credentialHash];
        if (cred.status != CredentialStatus.Suspended) {
            revert InvalidTransition(cred.status, CredentialStatus.Active);
        }

        cred.status = CredentialStatus.Active;

        emit CredentialReinstated(credentialHash, cred.issuerDid, uint64(block.timestamp));
    }

    // ──────────────────────────────────────────────────────────────
    // Credential Queries
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc ICredentialRegistry
    function getCredential(bytes32 credentialHash)
        external view override
        credentialExists(credentialHash)
        returns (Credential memory)
    {
        return _credentials[credentialHash];
    }

    /// @inheritdoc ICredentialRegistry
    function isCredentialValid(bytes32 credentialHash) external view override returns (bool) {
        Credential storage cred = _credentials[credentialHash];
        if (cred.issuedAt == 0) return false;
        if (cred.status != CredentialStatus.Active) return false;
        if (block.timestamp >= cred.expiresAt) return false;
        return true;
    }

    /// @notice Get all credential hashes issued by a specific issuer
    function getIssuerCredentials(bytes32 issuerDid) external view returns (bytes32[] memory) {
        return _issuerCredentials[issuerDid];
    }

    /// @notice Get all credential hashes held by a subject
    function getSubjectCredentials(bytes32 subjectDid) external view returns (bytes32[] memory) {
        return _subjectCredentials[subjectDid];
    }

    /// @notice Batch-check validity of multiple credentials
    /// @param credentialHashes Array of credential hashes to check
    /// @return results Array of validity booleans
    function batchCheckValidity(bytes32[] calldata credentialHashes)
        external view returns (bool[] memory results)
    {
        results = new bool[](credentialHashes.length);
        for (uint256 i = 0; i < credentialHashes.length; ) {
            Credential storage cred = _credentials[credentialHashes[i]];
            results[i] = cred.issuedAt != 0 &&
                          cred.status == CredentialStatus.Active &&
                          block.timestamp < cred.expiresAt;
            unchecked { i++; }
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Revocation Accumulator
    // ──────────────────────────────────────────────────────────────

    /// @notice Check if a credential is revoked using the bitmap
    /// @param credentialHash The credential to check
    /// @return True if the credential is revoked in the bitmap
    function isRevokedInBitmap(bytes32 credentialHash) external view returns (bool) {
        RevocationIndex storage idx = _revocationIndices[credentialHash];
        if (idx.epoch == 0 && idx.slot == 0 && idx.bitIndex == 0) return false;
        return (_revocationBitmap[idx.epoch][idx.slot] >> idx.bitIndex) & 1 == 1;
    }

    /// @notice Advance the revocation epoch (governance only)
    function advanceRevocationEpoch() external onlyRole(GOVERNANCE_ROLE) {
        uint256 oldEpoch = currentRevocationEpoch;
        unchecked { currentRevocationEpoch++; }
        _nextRevocationSlot = 0;
        _nextBitIndex = 0;
        emit RevocationEpochAdvanced(oldEpoch, currentRevocationEpoch);
    }

    function _assignRevocationIndex(bytes32 credentialHash) internal {
        _revocationIndices[credentialHash] = RevocationIndex({
            epoch: currentRevocationEpoch,
            slot: _nextRevocationSlot,
            bitIndex: _nextBitIndex
        });

        unchecked {
            _nextBitIndex++;
            if (_nextBitIndex == 0) { // Overflowed past 255
                _nextRevocationSlot++;
            }
        }
    }

    function _setRevocationBit(bytes32 credentialHash) internal {
        RevocationIndex storage idx = _revocationIndices[credentialHash];
        _revocationBitmap[idx.epoch][idx.slot] |= (1 << idx.bitIndex);
    }

    // ──────────────────────────────────────────────────────────────
    // Internal Helpers
    // ──────────────────────────────────────────────────────────────

    /// @dev Resolve the caller's DID from the identity registry
    function _resolveCallerDid() internal view returns (bytes32) {
        // Use a direct call — the identity registry maps controller => DID
        (bool success, bytes memory data) = address(identityRegistry).staticcall(
            abi.encodeWithSignature("resolveByController(address)", msg.sender)
        );
        require(success && data.length == 32, "Cannot resolve issuer DID");
        return abi.decode(data, (bytes32));
    }

    // ──────────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────────

    function pause() external onlyRole(ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(ADMIN_ROLE) { _unpause(); }
}
