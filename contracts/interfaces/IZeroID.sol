// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * @title IZeroID
 * @author Aethelred Team
 * @notice Core interfaces for the ZeroID self-sovereign identity protocol.
 *         Defines the canonical types, events, and function signatures shared
 *         across all ZeroID contracts.
 *
 * @dev Interface hierarchy:
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │                      IZeroID Interfaces                      │
 * ├──────────────────────────────────────────────────────────────┤
 * │  IIdentityRegistry    — DID registration & resolution        │
 * │  ICredentialRegistry  — credential lifecycle management      │
 * │  IZKVerifier          — Groth16 ZK proof verification        │
 * │  ITEEAttestation      — TEE enclave attestation registry     │
 * │  ISelectiveDisclosure — attribute-level proof disclosure     │
 * │  IGovernanceModule    — DAO governance for credential schemas│
 * └──────────────────────────────────────────────────────────────┘
 */

// ────────────────────────────────────────────────────────────────
// Shared Types
// ────────────────────────────────────────────────────────────────

/// @notice Status of a decentralised identity
enum IdentityStatus {
    Inactive,
    Active,
    Suspended,
    Revoked
}

/// @notice Credential lifecycle state
enum CredentialStatus {
    None,
    Active,
    Suspended,
    Revoked,
    Expired
}

/// @notice TEE platform type
enum TEEPlatform {
    Unknown,
    IntelSGX,
    AMDSEV,
    ArmTrustZone
}

/// @notice Governance proposal state
enum ProposalState {
    Pending,
    Active,
    Defeated,
    Succeeded,
    Queued,
    Executed,
    Cancelled
}

/// @notice Packed Groth16 proof structure — 256 bytes on-chain
struct Groth16Proof {
    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;
}

/// @notice On-chain identity record
struct Identity {
    bytes32 didHash;
    address controller;
    uint64 createdAt;
    uint64 updatedAt;
    IdentityStatus status;
    bytes32 recoveryHash;
    uint32 credentialCount;
    uint32 nonce;
}

/// @notice On-chain credential record
struct Credential {
    bytes32 credentialHash;
    bytes32 schemaHash;
    bytes32 issuerDid;
    bytes32 subjectDid;
    uint64 issuedAt;
    uint64 expiresAt;
    CredentialStatus status;
    bytes32 merkleRoot;
}

/// @notice TEE attestation report
struct AttestationReport {
    bytes32 enclaveHash;
    TEEPlatform platform;
    uint64 attestedAt;
    uint64 expiresAt;
    bytes32 reportDataHash;
    address nodeOperator;
    bool isValid;
}

/// @notice Credential schema definition
struct CredentialSchema {
    bytes32 schemaHash;
    string name;
    address proposer;
    uint64 createdAt;
    bool isActive;
    bytes32[] attributeHashes;
}

// ────────────────────────────────────────────────────────────────
// IIdentityRegistry
// ────────────────────────────────────────────────────────────────

interface IIdentityRegistry {
    event IdentityRegistered(bytes32 indexed didHash, address indexed controller, uint64 timestamp);
    event IdentityUpdated(bytes32 indexed didHash, IdentityStatus newStatus, uint64 timestamp);
    event ControllerChanged(bytes32 indexed didHash, address indexed oldController, address indexed newController);
    event RecoveryInitiated(bytes32 indexed didHash, address indexed newController);

    function registerIdentity(bytes32 didHash, bytes32 recoveryHash) external;
    function resolveIdentity(bytes32 didHash) external view returns (Identity memory);
    function updateIdentityStatus(bytes32 didHash, IdentityStatus newStatus) external;
    function changeController(bytes32 didHash, address newController) external;
    function initiateRecovery(bytes32 didHash, bytes32 recoveryProof, address newController) external;
    function isActiveIdentity(bytes32 didHash) external view returns (bool);
}

// ────────────────────────────────────────────────────────────────
// ICredentialRegistry
// ────────────────────────────────────────────────────────────────

interface ICredentialRegistry {
    event CredentialIssued(bytes32 indexed credentialHash, bytes32 indexed issuerDid, bytes32 indexed subjectDid);
    event CredentialRevoked(bytes32 indexed credentialHash, bytes32 indexed issuerDid, uint64 timestamp);
    event CredentialSuspended(bytes32 indexed credentialHash, bytes32 indexed issuerDid, uint64 timestamp);
    event CredentialReinstated(bytes32 indexed credentialHash, bytes32 indexed issuerDid, uint64 timestamp);

    function issueCredential(
        bytes32 credentialHash,
        bytes32 schemaHash,
        bytes32 subjectDid,
        uint64 expiresAt,
        bytes32 merkleRoot
    ) external;

    function revokeCredential(bytes32 credentialHash) external;
    function suspendCredential(bytes32 credentialHash) external;
    function reinstateCredential(bytes32 credentialHash) external;
    function getCredential(bytes32 credentialHash) external view returns (Credential memory);
    function isCredentialValid(bytes32 credentialHash) external view returns (bool);
}

// ────────────────────────────────────────────────────────────────
// IZKVerifier
// ────────────────────────────────────────────────────────────────

interface IZKVerifier {
    event ProofVerified(bytes32 indexed proofHash, bytes32 indexed credentialHash, bool valid);
    event VerificationKeyUpdated(bytes32 indexed circuitId, uint64 timestamp);

    function verifyProof(
        bytes32 circuitId,
        Groth16Proof calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (bool);

    function setVerificationKey(
        bytes32 circuitId,
        uint256[2] calldata alpha,
        uint256[2][2] calldata beta,
        uint256[2][2] calldata gamma,
        uint256[2][2] calldata delta,
        uint256[2][] calldata ic
    ) external;

    function isCircuitRegistered(bytes32 circuitId) external view returns (bool);
}

// ────────────────────────────────────────────────────────────────
// ITEEAttestation
// ────────────────────────────────────────────────────────────────

interface ITEEAttestation {
    event AttestationSubmitted(bytes32 indexed enclaveHash, TEEPlatform platform, address indexed nodeOperator);
    event AttestationRevoked(bytes32 indexed enclaveHash, uint64 timestamp);
    event PlatformPolicyUpdated(TEEPlatform platform, uint64 minFreshness);

    function submitAttestation(
        bytes32 enclaveHash,
        TEEPlatform platform,
        bytes32 reportDataHash,
        bytes calldata attestationSignature,
        uint64 validityDuration
    ) external;

    function revokeAttestation(bytes32 enclaveHash) external;
    function isAttestationValid(bytes32 enclaveHash) external view returns (bool);
    function getAttestation(bytes32 enclaveHash) external view returns (AttestationReport memory);
}

// ────────────────────────────────────────────────────────────────
// ISelectiveDisclosure
// ────────────────────────────────────────────────────────────────

interface ISelectiveDisclosure {
    event DisclosureRequested(bytes32 indexed requestId, bytes32 indexed subjectDid, bytes32[] attributeHashes);
    event DisclosureProofSubmitted(bytes32 indexed requestId, bool verified);
    event DisclosureRequestCancelled(bytes32 indexed requestId);

    function createDisclosureRequest(
        bytes32 subjectDid,
        bytes32 credentialHash,
        bytes32[] calldata attributeHashes,
        uint64 expiresAt
    ) external returns (bytes32 requestId);

    function submitDisclosureProof(
        bytes32 requestId,
        bytes32 circuitId,
        Groth16Proof calldata proof,
        uint256[] calldata publicInputs,
        bytes32[] calldata merkleProof
    ) external returns (bool);

    function getDisclosureResult(bytes32 requestId) external view returns (bool verified, uint64 verifiedAt);
}

// ────────────────────────────────────────────────────────────────
// IGovernanceModule
// ────────────────────────────────────────────────────────────────

interface IGovernanceModule {
    event SchemaProposed(bytes32 indexed schemaHash, address indexed proposer, string name);
    event SchemaApproved(bytes32 indexed schemaHash, uint64 timestamp);
    event SchemaRevoked(bytes32 indexed schemaHash, uint64 timestamp);
    event IssuerProposed(bytes32 indexed issuerDid, address indexed proposer);
    event IssuerApproved(bytes32 indexed issuerDid, uint64 timestamp);
    event IssuerRemoved(bytes32 indexed issuerDid, uint64 timestamp);
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, bytes32 indexed targetHash);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);

    function proposeSchema(
        bytes32 schemaHash,
        string calldata name,
        bytes32[] calldata attributeHashes
    ) external returns (uint256 proposalId);

    function proposeIssuer(bytes32 issuerDid) external returns (uint256 proposalId);
    function castVote(uint256 proposalId, bool support) external;
    function executeProposal(uint256 proposalId) external;
    function cancelProposal(uint256 proposalId) external;
    function getProposalState(uint256 proposalId) external view returns (ProposalState);
    function isApprovedSchema(bytes32 schemaHash) external view returns (bool);
    function isApprovedIssuer(bytes32 issuerDid) external view returns (bool);
}
