// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IZeroID.sol";

/**
 * @title SelectiveDisclosure
 * @author Aethelred Team
 * @notice Enables attribute-level selective disclosure of verifiable
 *         credentials using ZK proofs and Merkle inclusion proofs.
 *         Verifiers can request specific attributes from a credential
 *         and holders can prove possession without revealing other data.
 *
 * @dev Architecture:
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │                   SELECTIVE DISCLOSURE ENGINE                   │
 * ├────────────────────────────────────────────────────────────────┤
 * │  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐  │
 * │  │  Requests     │  │  Proof Submit   │  │  Verification    │  │
 * │  │  ──────────   │  │  ────────────   │  │  ────────────    │  │
 * │  │  • create     │  │  • ZK proof     │  │  • Merkle check  │  │
 * │  │  • cancel     │  │  • Merkle path  │  │  • circuit check │  │
 * │  │  • expire     │  │  • nullifier    │  │  • cred validity │  │
 * │  └──────────────┘  └────────────────┘  └──────────────────┘  │
 * │  ┌──────────────┐  ┌────────────────┐                        │
 * │  │  Policies     │  │  Audit Trail   │                        │
 * │  │  ──────────── │  │  ──────────    │                        │
 * │  │  • min attrs  │  │  • request log │                        │
 * │  │  • max age    │  │  • result log  │                        │
 * │  │  • verifier   │  │  • metrics     │                        │
 * │  └──────────────┘  └────────────────┘                        │
 * └────────────────────────────────────────────────────────────────┘
 *
 * Privacy model:
 *   - The holder's credential Merkle root is stored on-chain at issuance.
 *   - To disclose an attribute, the holder supplies a Merkle inclusion
 *     proof showing the attribute exists in their credential tree.
 *   - A ZK proof demonstrates possession of valid attribute data matching
 *     the revealed Merkle leaf, without revealing the actual data.
 *   - Nullifiers prevent double-proof of the same attribute in the same
 *     disclosure context.
 */
contract SelectiveDisclosure is ISelectiveDisclosure, AccessControl, Pausable, ReentrancyGuard {

    // ──────────────────────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────────────────────

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    // ──────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────

    uint64 public constant MIN_REQUEST_VALIDITY = 5 minutes;
    uint64 public constant MAX_REQUEST_VALIDITY = 7 days;
    uint32 public constant MAX_ATTRIBUTES_PER_REQUEST = 32;
    uint32 public constant MAX_MERKLE_PROOF_DEPTH = 32;

    // ──────────────────────────────────────────────────────────────
    // External References
    // ──────────────────────────────────────────────────────────────

    ICredentialRegistry public immutable credentialRegistry;
    IZKVerifier public immutable zkVerifier;

    // ──────────────────────────────────────────────────────────────
    // Storage
    // ──────────────────────────────────────────────────────────────

    struct DisclosureRequest {
        bytes32 requestId;
        bytes32 subjectDid;
        bytes32 credentialHash;
        bytes32[] attributeHashes;
        address verifier;
        uint64 createdAt;
        uint64 expiresAt;
        bool fulfilled;
        bool cancelled;
    }

    struct DisclosureResult {
        bool verified;
        uint64 verifiedAt;
        bytes32 proofHash;
        bytes32 nullifier;
    }

    /// @dev requestId => DisclosureRequest
    mapping(bytes32 => DisclosureRequest) private _requests;

    /// @dev requestId => DisclosureResult
    mapping(bytes32 => DisclosureResult) private _results;

    /// @dev Context-scoped nullifier tracking: context hash => nullifier => used
    mapping(bytes32 => mapping(bytes32 => bool)) private _contextNullifiers;

    /// @dev Verifier request history: verifier address => request IDs
    mapping(address => bytes32[]) private _verifierRequests;

    /// @dev Subject disclosure history: subjectDid => request IDs
    mapping(bytes32 => bytes32[]) private _subjectDisclosures;

    /// @notice Running request counter for deterministic ID generation
    uint256 private _requestNonce;

    /// @notice Total disclosure requests created
    uint256 public totalRequests;

    /// @notice Total successful disclosures
    uint256 public totalSuccessfulDisclosures;

    // ──────────────────────────────────────────────────────────────
    // Events (beyond interface)
    // ──────────────────────────────────────────────────────────────

    event DisclosureNullifierUsed(bytes32 indexed requestId, bytes32 indexed nullifier);
    event MerkleProofVerified(bytes32 indexed requestId, bytes32 indexed attributeHash, bool valid);

    // ──────────────────────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────────────────────

    error RequestNotFound(bytes32 requestId);
    error RequestExpired(bytes32 requestId);
    error RequestAlreadyFulfilled(bytes32 requestId);
    error RequestCancelled(bytes32 requestId);
    error NotRequestVerifier(bytes32 requestId, address caller);
    error TooManyAttributes(uint32 count);
    error InvalidRequestValidity(uint64 expiresAt);
    error CredentialNotValid(bytes32 credentialHash);
    error MerkleProofTooDeep(uint32 depth);
    error MerkleProofInvalid(bytes32 leaf, bytes32 root);
    error ZKProofInvalid(bytes32 circuitId);
    error NullifierAlreadyUsed(bytes32 contextHash, bytes32 nullifier);
    error NoAttributesRequested();
    error AttributeCountMismatch(uint256 expected, uint256 actual);

    // ──────────────────────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────────────────────

    modifier requestExists(bytes32 requestId) {
        if (_requests[requestId].createdAt == 0) revert RequestNotFound(requestId);
        _;
    }

    modifier requestOpen(bytes32 requestId) {
        DisclosureRequest storage req = _requests[requestId];
        if (req.cancelled) revert RequestCancelled(requestId);
        if (req.fulfilled) revert RequestAlreadyFulfilled(requestId);
        if (block.timestamp >= req.expiresAt) revert RequestExpired(requestId);
        _;
    }

    // ──────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────

    /// @param admin Initial admin address
    /// @param _credentialRegistry Address of the CredentialRegistry contract
    /// @param _zkVerifier Address of the ZKCredentialVerifier contract
    constructor(address admin, address _credentialRegistry, address _zkVerifier) {
        require(admin != address(0), "Zero admin");
        require(_credentialRegistry != address(0), "Zero credential registry");
        require(_zkVerifier != address(0), "Zero ZK verifier");

        credentialRegistry = ICredentialRegistry(_credentialRegistry);
        zkVerifier = IZKVerifier(_zkVerifier);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
    }

    // ──────────────────────────────────────────────────────────────
    // Disclosure Request Management
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc ISelectiveDisclosure
    function createDisclosureRequest(
        bytes32 subjectDid,
        bytes32 credentialHash,
        bytes32[] calldata attributeHashes,
        uint64 expiresAt
    ) external override onlyRole(VERIFIER_ROLE) whenNotPaused returns (bytes32 requestId) {
        if (attributeHashes.length == 0) revert NoAttributesRequested();
        if (attributeHashes.length > MAX_ATTRIBUTES_PER_REQUEST) {
            revert TooManyAttributes(uint32(attributeHashes.length));
        }

        uint64 now64 = uint64(block.timestamp);
        if (expiresAt < now64 + MIN_REQUEST_VALIDITY || expiresAt > now64 + MAX_REQUEST_VALIDITY) {
            revert InvalidRequestValidity(expiresAt);
        }

        // Verify credential exists and is valid
        if (!credentialRegistry.isCredentialValid(credentialHash)) {
            revert CredentialNotValid(credentialHash);
        }

        // Generate deterministic request ID
        unchecked { _requestNonce++; }
        requestId = keccak256(abi.encodePacked(
            msg.sender, subjectDid, credentialHash, _requestNonce, block.timestamp
        ));

        // Copy attribute hashes into storage
        DisclosureRequest storage req = _requests[requestId];
        req.requestId = requestId;
        req.subjectDid = subjectDid;
        req.credentialHash = credentialHash;
        req.verifier = msg.sender;
        req.createdAt = now64;
        req.expiresAt = expiresAt;

        for (uint256 i = 0; i < attributeHashes.length; ) {
            req.attributeHashes.push(attributeHashes[i]);
            unchecked { i++; }
        }

        _verifierRequests[msg.sender].push(requestId);
        _subjectDisclosures[subjectDid].push(requestId);

        unchecked { totalRequests++; }

        emit DisclosureRequested(requestId, subjectDid, attributeHashes);
    }

    /// @notice Cancel an open disclosure request (only by the requesting verifier)
    /// @param requestId The request to cancel
    function cancelDisclosureRequest(bytes32 requestId)
        external requestExists(requestId)
    {
        DisclosureRequest storage req = _requests[requestId];
        if (req.verifier != msg.sender) revert NotRequestVerifier(requestId, msg.sender);

        req.cancelled = true;

        emit DisclosureRequestCancelled(requestId);
    }

    // ──────────────────────────────────────────────────────────────
    // Disclosure Proof Submission
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc ISelectiveDisclosure
    function submitDisclosureProof(
        bytes32 requestId,
        bytes32 circuitId,
        Groth16Proof calldata proof,
        uint256[] calldata publicInputs,
        bytes32[] calldata merkleProof
    ) external override
        requestExists(requestId)
        requestOpen(requestId)
        whenNotPaused
        nonReentrant
        returns (bool)
    {
        DisclosureRequest storage req = _requests[requestId];

        if (merkleProof.length > MAX_MERKLE_PROOF_DEPTH) {
            revert MerkleProofTooDeep(uint32(merkleProof.length));
        }

        // Re-verify credential is still valid at proof time
        if (!credentialRegistry.isCredentialValid(req.credentialHash)) {
            revert CredentialNotValid(req.credentialHash);
        }

        // Context hash for nullifier scoping
        bytes32 contextHash = keccak256(abi.encodePacked(requestId, req.verifier));

        // Extract nullifier from public inputs (convention: last public input)
        require(publicInputs.length >= 3, "Insufficient public inputs");
        bytes32 nullifier = bytes32(publicInputs[publicInputs.length - 1]);

        // Prevent nullifier reuse within this context
        if (_contextNullifiers[contextHash][nullifier]) {
            revert NullifierAlreadyUsed(contextHash, nullifier);
        }

        // Step 1: Verify Merkle inclusion — the disclosed attribute leaves
        //         must be present in the credential's Merkle tree
        Credential memory cred = credentialRegistry.getCredential(req.credentialHash);
        bool merkleValid = _verifyMerkleInclusion(
            req.attributeHashes,
            merkleProof,
            cred.merkleRoot
        );

        if (!merkleValid) {
            revert MerkleProofInvalid(req.attributeHashes[0], cred.merkleRoot);
        }

        // ZID-010: Bind ZK proof public inputs to request context
        // publicInputs[0] must commit to the credential's merkle root
        require(
            bytes32(publicInputs[0]) == cred.merkleRoot,
            "Public input[0] must match credential merkle root"
        );
        // publicInputs[1] must commit to the request context hash
        require(
            bytes32(publicInputs[1]) == contextHash,
            "Public input[1] must match request context hash"
        );

        // Step 2: Verify ZK proof — proves the holder knows attribute values
        //         matching the disclosed Merkle leaves without revealing them
        bool zkValid = zkVerifier.verifyProof(circuitId, proof, publicInputs);

        if (!zkValid) {
            revert ZKProofInvalid(circuitId);
        }

        // Record nullifier usage
        _contextNullifiers[contextHash][nullifier] = true;

        // Mark request fulfilled and record result
        req.fulfilled = true;
        bytes32 proofHash = keccak256(abi.encode(proof.a, proof.b, proof.c));

        _results[requestId] = DisclosureResult({
            verified: true,
            verifiedAt: uint64(block.timestamp),
            proofHash: proofHash,
            nullifier: nullifier
        });

        unchecked { totalSuccessfulDisclosures++; }

        emit DisclosureNullifierUsed(requestId, nullifier);
        emit DisclosureProofSubmitted(requestId, true);

        return true;
    }

    // ──────────────────────────────────────────────────────────────
    // Queries
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc ISelectiveDisclosure
    function getDisclosureResult(bytes32 requestId)
        external view override
        requestExists(requestId)
        returns (bool verified, uint64 verifiedAt)
    {
        DisclosureResult storage result = _results[requestId];
        return (result.verified, result.verifiedAt);
    }

    /// @notice Get full disclosure request details
    function getDisclosureRequest(bytes32 requestId)
        external view requestExists(requestId)
        returns (
            bytes32 subjectDid,
            bytes32 credentialHash,
            bytes32[] memory attributeHashes,
            address verifier,
            uint64 createdAt,
            uint64 expiresAt,
            bool fulfilled,
            bool cancelled
        )
    {
        DisclosureRequest storage req = _requests[requestId];
        return (
            req.subjectDid,
            req.credentialHash,
            req.attributeHashes,
            req.verifier,
            req.createdAt,
            req.expiresAt,
            req.fulfilled,
            req.cancelled
        );
    }

    /// @notice Get request IDs for a verifier
    function getVerifierRequests(address verifier) external view returns (bytes32[] memory) {
        return _verifierRequests[verifier];
    }

    /// @notice Get disclosure history for a subject DID
    function getSubjectDisclosures(bytes32 subjectDid) external view returns (bytes32[] memory) {
        return _subjectDisclosures[subjectDid];
    }

    /// @notice Check if a nullifier has been used in a specific disclosure context
    function isNullifierUsedInContext(bytes32 requestId, bytes32 nullifier) external view returns (bool) {
        DisclosureRequest storage req = _requests[requestId];
        bytes32 contextHash = keccak256(abi.encodePacked(requestId, req.verifier));
        return _contextNullifiers[contextHash][nullifier];
    }

    // ──────────────────────────────────────────────────────────────
    // Internal — Merkle Verification
    // ──────────────────────────────────────────────────────────────

    /// @dev Verify that a set of attribute hashes are included in a Merkle tree
    ///      Uses a combined leaf approach: hash all requested attributes into
    ///      a single leaf and verify against the root.
    function _verifyMerkleInclusion(
        bytes32[] memory leaves,
        bytes32[] memory proof,
        bytes32 root
    ) internal pure returns (bool) {
        // Combine all attribute hashes into a single composite leaf
        bytes32 computedHash = leaves[0];
        for (uint256 i = 1; i < leaves.length; ) {
            computedHash = _efficientHash(computedHash, leaves[i]);
            unchecked { i++; }
        }

        // Walk the Merkle proof path
        for (uint256 i = 0; i < proof.length; ) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = _efficientHash(computedHash, proofElement);
            } else {
                computedHash = _efficientHash(proofElement, computedHash);
            }
            unchecked { i++; }
        }

        return computedHash == root;
    }

    /// @dev Gas-efficient hash of two bytes32 values using assembly
    function _efficientHash(bytes32 a, bytes32 b) internal pure returns (bytes32 value) {
        assembly {
            mstore(0x00, a)
            mstore(0x20, b)
            value := keccak256(0x00, 0x40)
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────────

    function pause() external onlyRole(ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(ADMIN_ROLE) { _unpause(); }
}
