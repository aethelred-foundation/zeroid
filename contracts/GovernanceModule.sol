// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IZeroID.sol";

/**
 * @title GovernanceModule
 * @author Aethelred Team
 * @notice DAO governance module for managing credential schemas, trusted
 *         issuers, and protocol parameters for the ZeroID protocol.
 *         Uses a weighted voting system with quorum requirements and
 *         timelock execution.
 *
 * @dev Architecture:
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │                     GOVERNANCE MODULE                          │
 * ├────────────────────────────────────────────────────────────────┤
 * │  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐  │
 * │  │  Proposals    │  │  Voting         │  │  Execution       │  │
 * │  │  ──────────   │  │  ────────       │  │  ─────────       │  │
 * │  │  • schema     │  │  • cast vote    │  │  • timelock      │  │
 * │  │  • issuer     │  │  • weight       │  │  • queue         │  │
 * │  │  • parameter  │  │  • quorum       │  │  • execute       │  │
 * │  │  • cancel     │  │  • snapshot     │  │  • cancel        │  │
 * │  └──────────────┘  └────────────────┘  └──────────────────┘  │
 * │  ┌──────────────┐  ┌────────────────┐                        │
 * │  │  Schema Mgmt  │  │  Issuer Mgmt   │                        │
 * │  │  ──────────── │  │  ──────────     │                        │
 * │  │  • register   │  │  • approve      │                        │
 * │  │  • deprecate  │  │  • remove       │                        │
 * │  │  • attributes │  │  • reputation   │                        │
 * │  └──────────────┘  └────────────────┘                        │
 * └────────────────────────────────────────────────────────────────┘
 *
 * Governance model:
 *   - Proposals require a minimum voting power to create.
 *   - Voting runs for a configurable period with quorum requirements.
 *   - Passed proposals enter a timelock before execution.
 *   - Two proposal types: Schema (add credential type) and Issuer (trust).
 *   - Emergency cancellation available to ADMIN_ROLE.
 */
contract GovernanceModule is IGovernanceModule, AccessControl, Pausable, ReentrancyGuard {

    // ──────────────────────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────────────────────

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant VOTER_ROLE = keccak256("VOTER_ROLE");

    // ──────────────────────────────────────────────────────────────
    // Constants & Parameters
    // ──────────────────────────────────────────────────────────────

    uint64 public constant MIN_VOTING_PERIOD = 1 days;
    uint64 public constant MAX_VOTING_PERIOD = 30 days;
    uint64 public constant EXECUTION_TIMELOCK = 24 hours;
    uint64 public constant EXECUTION_WINDOW = 7 days;
    uint256 public constant MIN_PROPOSAL_THRESHOLD = 1;

    // ──────────────────────────────────────────────────────────────
    // Storage — Configuration
    // ──────────────────────────────────────────────────────────────

    /// @notice Current voting period in seconds
    uint64 public votingPeriod;

    /// @notice Required quorum (number of votes needed)
    uint256 public quorumRequired;

    // ──────────────────────────────────────────────────────────────
    // Storage — Proposals
    // ──────────────────────────────────────────────────────────────

    enum ProposalType {
        Schema,
        Issuer,
        Parameter
    }

    struct Proposal {
        uint256 proposalId;
        address proposer;
        ProposalType proposalType;
        bytes32 targetHash;        // schemaHash or issuerDid
        string description;
        uint64 createdAt;
        uint64 votingEndsAt;
        uint64 executionEta;       // Earliest execution time (after timelock)
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
        bool cancelled;
        // Schema-specific payload
        bytes32[] attributeHashes;
        string schemaName;
    }

    /// @dev proposalId => Proposal
    mapping(uint256 => Proposal) private _proposals;

    /// @dev proposalId => voter => has voted
    mapping(uint256 => mapping(address => bool)) private _hasVoted;

    /// @dev proposalId => voter => vote weight
    mapping(uint256 => mapping(address => uint256)) private _voteWeights;

    /// @dev Voter weights: voter => voting power
    mapping(address => uint256) private _voterWeights;

    /// @notice Next proposal ID
    uint256 public nextProposalId;

    // ──────────────────────────────────────────────────────────────
    // Storage — Schemas & Issuers
    // ──────────────────────────────────────────────────────────────

    /// @dev schemaHash => CredentialSchema
    mapping(bytes32 => CredentialSchema) private _schemas;

    /// @dev Approved issuer DIDs: issuerDid => approved
    mapping(bytes32 => bool) private _approvedIssuers;

    /// @dev All approved schema hashes for enumeration
    bytes32[] private _schemaList;

    /// @dev All approved issuer DIDs for enumeration
    bytes32[] private _issuerList;

    /// @notice Total approved schemas
    uint256 public totalSchemas;

    /// @notice Total approved issuers
    uint256 public totalIssuers;

    // ──────────────────────────────────────────────────────────────
    // Events (beyond interface)
    // ──────────────────────────────────────────────────────────────

    event VotingPeriodUpdated(uint64 oldPeriod, uint64 newPeriod);
    event QuorumUpdated(uint256 oldQuorum, uint256 newQuorum);
    event VoterWeightSet(address indexed voter, uint256 weight);
    event ProposalQueued(uint256 indexed proposalId, uint64 executionEta);

    // ──────────────────────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────────────────────

    error ProposalNotFound(uint256 proposalId);
    error ProposalNotActive(uint256 proposalId);
    error ProposalNotSucceeded(uint256 proposalId);
    error ProposalNotQueued(uint256 proposalId);
    error ProposalAlreadyExecuted(uint256 proposalId);
    error ProposalCancelled(uint256 proposalId);
    error VotingNotEnded(uint256 proposalId);
    error AlreadyVoted(uint256 proposalId, address voter);
    error InsufficientVotingPower(address voter);
    error ExecutionTimelockNotExpired(uint64 eta);
    error ExecutionWindowExpired(uint256 proposalId);
    error SchemaAlreadyExists(bytes32 schemaHash);
    error IssuerAlreadyApproved(bytes32 issuerDid);
    error InvalidVotingPeriod(uint64 period);
    error NoAttributes();

    // ──────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────

    /// @param admin Initial admin address
    /// @param _votingPeriod Initial voting period in seconds
    /// @param _quorumRequired Initial quorum requirement
    constructor(address admin, uint64 _votingPeriod, uint256 _quorumRequired) {
        require(admin != address(0), "Zero admin");
        require(
            _votingPeriod >= MIN_VOTING_PERIOD && _votingPeriod <= MAX_VOTING_PERIOD,
            "Invalid voting period"
        );
        require(_quorumRequired > 0, "Zero quorum");

        votingPeriod = _votingPeriod;
        quorumRequired = _quorumRequired;
        nextProposalId = 1;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
        _grantRole(VOTER_ROLE, admin);

        _voterWeights[admin] = 1;
    }

    // ──────────────────────────────────────────────────────────────
    // Voter Management
    // ──────────────────────────────────────────────────────────────

    /// @notice Set voting weight for a voter
    /// @param voter The voter address
    /// @param weight The voting power to assign
    function setVoterWeight(address voter, uint256 weight) external onlyRole(GOVERNANCE_ROLE) {
        require(voter != address(0), "Zero voter");
        _voterWeights[voter] = weight;
        if (weight > 0 && !hasRole(VOTER_ROLE, voter)) {
            _grantRole(VOTER_ROLE, voter);
        }
        emit VoterWeightSet(voter, weight);
    }

    /// @notice Get the voting power of a voter
    function getVoterWeight(address voter) external view returns (uint256) {
        return _voterWeights[voter];
    }

    // ──────────────────────────────────────────────────────────────
    // Proposal Creation
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc IGovernanceModule
    function proposeSchema(
        bytes32 schemaHash,
        string calldata name,
        bytes32[] calldata attributeHashes
    ) external override onlyRole(VOTER_ROLE) whenNotPaused returns (uint256 proposalId) {
        if (schemaHash == bytes32(0)) revert SchemaAlreadyExists(schemaHash);
        if (_schemas[schemaHash].createdAt != 0) revert SchemaAlreadyExists(schemaHash);
        if (attributeHashes.length == 0) revert NoAttributes();
        if (_voterWeights[msg.sender] < MIN_PROPOSAL_THRESHOLD) {
            revert InsufficientVotingPower(msg.sender);
        }

        proposalId = _createProposal(ProposalType.Schema, schemaHash, name);

        // Store schema-specific payload
        Proposal storage p = _proposals[proposalId];
        p.schemaName = name;
        for (uint256 i = 0; i < attributeHashes.length; ) {
            p.attributeHashes.push(attributeHashes[i]);
            unchecked { i++; }
        }

        emit SchemaProposed(schemaHash, msg.sender, name);
    }

    /// @inheritdoc IGovernanceModule
    function proposeIssuer(bytes32 issuerDid)
        external override onlyRole(VOTER_ROLE) whenNotPaused returns (uint256 proposalId)
    {
        require(issuerDid != bytes32(0), "Zero issuer DID");
        if (_approvedIssuers[issuerDid]) revert IssuerAlreadyApproved(issuerDid);
        if (_voterWeights[msg.sender] < MIN_PROPOSAL_THRESHOLD) {
            revert InsufficientVotingPower(msg.sender);
        }

        proposalId = _createProposal(ProposalType.Issuer, issuerDid, "");

        emit IssuerProposed(issuerDid, msg.sender);
    }

    function _createProposal(
        ProposalType pType,
        bytes32 targetHash,
        string memory description
    ) internal returns (uint256 proposalId) {
        proposalId = nextProposalId;
        unchecked { nextProposalId++; }

        uint64 now64 = uint64(block.timestamp);

        Proposal storage p = _proposals[proposalId];
        p.proposalId = proposalId;
        p.proposer = msg.sender;
        p.proposalType = pType;
        p.targetHash = targetHash;
        p.description = description;
        p.createdAt = now64;
        p.votingEndsAt = now64 + votingPeriod;

        emit ProposalCreated(proposalId, msg.sender, targetHash);
    }

    // ──────────────────────────────────────────────────────────────
    // Voting
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc IGovernanceModule
    function castVote(uint256 proposalId, bool support)
        external override onlyRole(VOTER_ROLE) whenNotPaused
    {
        Proposal storage p = _proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound(proposalId);
        if (p.cancelled) revert ProposalCancelled(proposalId);
        if (p.executed) revert ProposalAlreadyExecuted(proposalId);
        if (block.timestamp >= p.votingEndsAt) revert ProposalNotActive(proposalId);
        if (_hasVoted[proposalId][msg.sender]) revert AlreadyVoted(proposalId, msg.sender);

        uint256 weight = _voterWeights[msg.sender];
        if (weight == 0) revert InsufficientVotingPower(msg.sender);

        _hasVoted[proposalId][msg.sender] = true;
        _voteWeights[proposalId][msg.sender] = weight;

        if (support) {
            p.forVotes += weight;
        } else {
            p.againstVotes += weight;
        }

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    // ──────────────────────────────────────────────────────────────
    // Proposal Lifecycle
    // ──────────────────────────────────────────────────────────────

    /// @notice Queue a successful proposal for execution after timelock
    /// @param proposalId The proposal to queue
    function queueProposal(uint256 proposalId) external {
        if (getProposalState(proposalId) != ProposalState.Succeeded) {
            revert ProposalNotSucceeded(proposalId);
        }

        Proposal storage p = _proposals[proposalId];
        p.executionEta = uint64(block.timestamp) + EXECUTION_TIMELOCK;

        emit ProposalQueued(proposalId, p.executionEta);
    }

    /// @inheritdoc IGovernanceModule
    function executeProposal(uint256 proposalId) external override onlyRole(GOVERNANCE_ROLE) nonReentrant {
        Proposal storage p = _proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound(proposalId);
        if (p.executed) revert ProposalAlreadyExecuted(proposalId);
        if (p.cancelled) revert ProposalCancelled(proposalId);
        if (p.executionEta == 0) revert ProposalNotQueued(proposalId);
        if (block.timestamp < p.executionEta) revert ExecutionTimelockNotExpired(p.executionEta);
        if (block.timestamp > p.executionEta + EXECUTION_WINDOW) {
            revert ExecutionWindowExpired(proposalId);
        }

        p.executed = true;

        if (p.proposalType == ProposalType.Schema) {
            _executeSchemaProposal(p);
        } else if (p.proposalType == ProposalType.Issuer) {
            _executeIssuerProposal(p);
        }
    }

    /// @inheritdoc IGovernanceModule
    function cancelProposal(uint256 proposalId) external override {
        Proposal storage p = _proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound(proposalId);
        if (p.executed) revert ProposalAlreadyExecuted(proposalId);

        // Only proposer or admin can cancel
        require(
            p.proposer == msg.sender || hasRole(ADMIN_ROLE, msg.sender),
            "Not authorized to cancel"
        );

        p.cancelled = true;

        emit ProposalCreated(proposalId, msg.sender, p.targetHash); // re-emit with cancel context
    }

    // ──────────────────────────────────────────────────────────────
    // Proposal Execution Handlers
    // ──────────────────────────────────────────────────────────────

    function _executeSchemaProposal(Proposal storage p) internal {
        bytes32 schemaHash = p.targetHash;

        CredentialSchema storage schema = _schemas[schemaHash];
        schema.schemaHash = schemaHash;
        schema.name = p.schemaName;
        schema.proposer = p.proposer;
        schema.createdAt = uint64(block.timestamp);
        schema.isActive = true;

        for (uint256 i = 0; i < p.attributeHashes.length; ) {
            schema.attributeHashes.push(p.attributeHashes[i]);
            unchecked { i++; }
        }

        _schemaList.push(schemaHash);
        unchecked { totalSchemas++; }

        emit SchemaApproved(schemaHash, uint64(block.timestamp));
    }

    function _executeIssuerProposal(Proposal storage p) internal {
        bytes32 issuerDid = p.targetHash;
        _approvedIssuers[issuerDid] = true;
        _issuerList.push(issuerDid);
        unchecked { totalIssuers++; }

        emit IssuerApproved(issuerDid, uint64(block.timestamp));
    }

    // ──────────────────────────────────────────────────────────────
    // Schema & Issuer Queries
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc IGovernanceModule
    function isApprovedSchema(bytes32 schemaHash) external view override returns (bool) {
        return _schemas[schemaHash].isActive;
    }

    /// @inheritdoc IGovernanceModule
    function isApprovedIssuer(bytes32 issuerDid) external view override returns (bool) {
        return _approvedIssuers[issuerDid];
    }

    /// @notice Get full schema details
    function getSchema(bytes32 schemaHash) external view returns (CredentialSchema memory) {
        return _schemas[schemaHash];
    }

    /// @notice Revoke a schema (governance only, outside proposal system for emergencies)
    function revokeSchema(bytes32 schemaHash) external onlyRole(GOVERNANCE_ROLE) {
        _schemas[schemaHash].isActive = false;
        emit SchemaRevoked(schemaHash, uint64(block.timestamp));
    }

    /// @notice Remove a trusted issuer (governance only, outside proposal system)
    function removeIssuer(bytes32 issuerDid) external onlyRole(GOVERNANCE_ROLE) {
        _approvedIssuers[issuerDid] = false;
        unchecked { if (totalIssuers > 0) totalIssuers--; }
        emit IssuerRemoved(issuerDid, uint64(block.timestamp));
    }

    // ──────────────────────────────────────────────────────────────
    // Proposal Queries
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc IGovernanceModule
    function getProposalState(uint256 proposalId) public view override returns (ProposalState) {
        Proposal storage p = _proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound(proposalId);

        if (p.cancelled) return ProposalState.Cancelled;
        if (p.executed) return ProposalState.Executed;

        if (block.timestamp < p.votingEndsAt) return ProposalState.Active;

        // Voting ended — check result
        bool quorumReached = (p.forVotes + p.againstVotes) >= quorumRequired;
        bool passed = p.forVotes > p.againstVotes;

        if (!quorumReached || !passed) return ProposalState.Defeated;

        if (p.executionEta == 0) return ProposalState.Succeeded;

        return ProposalState.Queued;
    }

    /// @notice Get proposal details
    function getProposal(uint256 proposalId) external view returns (
        address proposer,
        ProposalType proposalType,
        bytes32 targetHash,
        uint64 createdAt,
        uint64 votingEndsAt,
        uint256 forVotes,
        uint256 againstVotes,
        bool executed,
        bool cancelled
    ) {
        Proposal storage p = _proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound(proposalId);
        return (
            p.proposer, p.proposalType, p.targetHash,
            p.createdAt, p.votingEndsAt,
            p.forVotes, p.againstVotes,
            p.executed, p.cancelled
        );
    }

    /// @notice Check if an address has voted on a proposal
    function hasVoted(uint256 proposalId, address voter) external view returns (bool) {
        return _hasVoted[proposalId][voter];
    }

    // ──────────────────────────────────────────────────────────────
    // Governance Parameter Updates
    // ──────────────────────────────────────────────────────────────

    /// @notice Update the voting period
    function setVotingPeriod(uint64 newPeriod) external onlyRole(GOVERNANCE_ROLE) {
        if (newPeriod < MIN_VOTING_PERIOD || newPeriod > MAX_VOTING_PERIOD) {
            revert InvalidVotingPeriod(newPeriod);
        }
        uint64 oldPeriod = votingPeriod;
        votingPeriod = newPeriod;
        emit VotingPeriodUpdated(oldPeriod, newPeriod);
    }

    /// @notice Update the quorum requirement
    function setQuorum(uint256 newQuorum) external onlyRole(GOVERNANCE_ROLE) {
        require(newQuorum > 0, "Zero quorum");
        uint256 oldQuorum = quorumRequired;
        quorumRequired = newQuorum;
        emit QuorumUpdated(oldQuorum, newQuorum);
    }

    // ──────────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────────

    function pause() external onlyRole(ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(ADMIN_ROLE) { _unpause(); }
}
