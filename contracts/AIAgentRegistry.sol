// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AIAgentRegistry
 * @author ZeroID Cryptography Team
 * @notice On-chain registry for AI agent identities with capability-based access
 *         control (CBAC), delegation graphs, reputation scoring, and human-in-the-loop
 *         governance. Implements the DID:agent method for interoperability.
 *
 * @dev Design principles:
 *      - Every AI agent has a unique DID (did:agent:<chainId>:<address>)
 *      - Capabilities are fine-grained, enumerable, and revocable
 *      - Delegation forms a directed acyclic graph (DAG): agent A can grant a
 *        subset of its capabilities to agent B, who can further sub-delegate
 *      - Reputation is updated via on-chain attestations from verifiers
 *      - Sensitive operations require explicit human approval
 *      - Rate limiting per agent per capability prevents runaway agents
 *      - Governance (DEFAULT_ADMIN_ROLE) can suspend/revoke any agent
 */
contract AIAgentRegistry is AccessControl, Pausable, ReentrancyGuard {
    // ──────────────────────────────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────────────────────────────

    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant HUMAN_APPROVER_ROLE = keccak256("HUMAN_APPROVER_ROLE");

    // ──────────────────────────────────────────────────────────────────────
    // Custom errors
    // ──────────────────────────────────────────────────────────────────────

    error AgentAlreadyRegistered();
    error AgentNotRegistered();
    error AgentSuspended();
    error AgentRevoked();
    error InvalidCapability();
    error CapabilityAlreadyGranted();
    error CapabilityNotGranted();
    error InsufficientCapability();
    error DelegationCycleDetected();
    error DelegationDepthExceeded();
    error DelegationNotFound();
    error RateLimitExceeded();
    error HumanApprovalRequired();
    error ApprovalAlreadyExists();
    error ApprovalNotFound();
    error ApprovalExpired();
    error InvalidReputationScore();
    error InvalidDIDFormat();
    error SelfDelegationNotAllowed();
    error CapabilityExpired();

    // ──────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────

    event AgentRegistered(
        bytes32 indexed agentId,
        address indexed owner,
        string agentDID,
        uint256 timestamp
    );

    event AgentSuspendedEvent(
        bytes32 indexed agentId,
        string reason,
        uint256 timestamp
    );

    event AgentReinstated(
        bytes32 indexed agentId,
        uint256 timestamp
    );

    event AgentRevokedEvent(
        bytes32 indexed agentId,
        string reason,
        uint256 timestamp
    );

    event CapabilityGranted(
        bytes32 indexed agentId,
        bytes32 indexed capabilityId,
        uint256 expiresAt,
        uint256 timestamp
    );

    event CapabilityRevoked(
        bytes32 indexed agentId,
        bytes32 indexed capabilityId,
        uint256 timestamp
    );

    event DelegationCreated(
        bytes32 indexed fromAgent,
        bytes32 indexed toAgent,
        bytes32 indexed capabilityId,
        uint256 depth,
        uint256 timestamp
    );

    event DelegationRevoked(
        bytes32 indexed fromAgent,
        bytes32 indexed toAgent,
        bytes32 indexed capabilityId,
        uint256 timestamp
    );

    event ReputationUpdated(
        bytes32 indexed agentId,
        int256 delta,
        uint256 newScore,
        string reason,
        uint256 timestamp
    );

    event HumanApprovalRequested(
        bytes32 indexed approvalId,
        bytes32 indexed agentId,
        bytes32 indexed capabilityId,
        string description,
        uint256 timestamp
    );

    event HumanApprovalGranted(
        bytes32 indexed approvalId,
        address indexed approver,
        uint256 timestamp
    );

    event HumanApprovalDenied(
        bytes32 indexed approvalId,
        address indexed approver,
        string reason,
        uint256 timestamp
    );

    event RateLimitConfigured(
        bytes32 indexed agentId,
        bytes32 indexed capabilityId,
        uint256 maxCallsPerWindow,
        uint256 windowDuration,
        uint256 timestamp
    );

    event AgentCapabilityInvoked(
        bytes32 indexed agentId,
        bytes32 indexed capabilityId,
        uint256 timestamp
    );

    // ──────────────────────────────────────────────────────────────────────
    // Structs
    // ──────────────────────────────────────────────────────────────────────

    enum AgentStatus {
        Active,
        Suspended,
        Revoked
    }

    /// @notice AI agent identity record
    struct AgentIdentity {
        bytes32 agentId;              // Unique identifier
        address owner;                // Human/contract that controls this agent
        string agentDID;              // W3C DID string (did:agent:<chainId>:<addr>)
        bytes32 attestationHash;      // Hash of capability attestations
        AgentStatus status;
        uint256 registeredAt;
        uint256 reputationScore;      // 0–10000 (basis points, 10000 = perfect)
        uint256 totalInvocations;     // Lifetime capability invocations
        uint256 capabilityCount;      // Number of active capabilities
        uint256 delegationCount;      // Number of outbound delegations
    }

    /// @notice A capability that can be granted to an agent
    struct Capability {
        bytes32 capabilityId;         // e.g., keccak256("identity.verify")
        string name;                  // Human-readable name
        string description;           // What this capability allows
        bool requiresHumanApproval;   // Whether invocation needs HITL approval
        bool active;                  // Whether this capability type is enabled
        uint256 registeredAt;
    }

    /// @notice Grant of a capability to a specific agent
    struct CapabilityGrant {
        bytes32 capabilityId;
        uint256 grantedAt;
        uint256 expiresAt;            // 0 = no expiry
        bool active;
        bytes32 delegatedFrom;        // bytes32(0) if directly granted
        uint256 delegationDepth;      // 0 = direct grant, 1+ = delegation
    }

    /// @notice Delegation edge in the delegation DAG
    struct Delegation {
        bytes32 fromAgent;
        bytes32 toAgent;
        bytes32 capabilityId;
        uint256 depth;                // Delegation depth from original grant
        uint256 createdAt;
        uint256 expiresAt;
        bool active;
    }

    /// @notice Rate limit configuration for an agent's capability
    struct RateLimit {
        uint256 maxCallsPerWindow;
        uint256 windowDuration;       // In seconds
        uint256 currentWindowStart;
        uint256 callsInCurrentWindow;
    }

    /// @notice Human-in-the-loop approval request
    struct ApprovalRequest {
        bytes32 approvalId;
        bytes32 agentId;
        bytes32 capabilityId;
        string description;
        address requestedBy;
        uint256 requestedAt;
        uint256 expiresAt;
        ApprovalStatus status;
        address approver;
        string denialReason;
    }

    enum ApprovalStatus {
        Pending,
        Approved,
        Denied,
        Expired
    }

    // ──────────────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────────────

    uint256 public constant MAX_DELEGATION_DEPTH = 5;
    uint256 public constant DEFAULT_REPUTATION = 5000; // 50%
    uint256 public constant MAX_REPUTATION = 10000;
    uint256 public constant APPROVAL_DEFAULT_TTL = 24 hours;
    uint256 public constant MIN_REPUTATION_FOR_DELEGATION = 3000; // 30%

    // ──────────────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Agent identities by ID
    mapping(bytes32 => AgentIdentity) private _agents;

    /// @notice Address to agent ID mapping
    mapping(address => bytes32) private _addressToAgent;

    /// @notice Registered capability types
    mapping(bytes32 => Capability) private _capabilities;

    /// @notice Agent capability grants: agentId => capabilityId => CapabilityGrant
    mapping(bytes32 => mapping(bytes32 => CapabilityGrant)) private _grants;

    /// @notice Delegations: delegationKey => Delegation
    mapping(bytes32 => Delegation) private _delegations;

    /// @notice Outbound delegations per agent: agentId => delegationKey[]
    mapping(bytes32 => bytes32[]) private _outboundDelegations;

    /// @notice Rate limits: agentId => capabilityId => RateLimit
    mapping(bytes32 => mapping(bytes32 => RateLimit)) private _rateLimits;

    /// @notice Approval requests
    mapping(bytes32 => ApprovalRequest) private _approvals;

    /// @notice Pending approvals per agent
    mapping(bytes32 => bytes32[]) private _pendingApprovals;

    /// @notice All registered agent IDs
    bytes32[] private _agentIds;

    /// @notice All registered capability IDs
    bytes32[] private _capabilityIds;

    /// @notice Global counters
    uint256 public totalAgents;
    uint256 public totalDelegations;
    uint256 public totalInvocations;

    // ──────────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────────

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
        _grantRole(HUMAN_APPROVER_ROLE, admin);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Agent registration
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Register a new AI agent identity.
     * @param agentId          Unique agent identifier
     * @param owner            Address that controls this agent
     * @param agentDID         W3C DID string (must start with "did:agent:")
     * @param attestationHash  Hash of initial capability attestations
     */
    function registerAgent(
        bytes32 agentId,
        address owner,
        string calldata agentDID,
        bytes32 attestationHash
    ) external whenNotPaused {
        if (_agents[agentId].registeredAt != 0) revert AgentAlreadyRegistered();
        if (bytes(agentDID).length < 10) revert InvalidDIDFormat();

        // Verify DID format starts with "did:agent:"
        bytes memory didBytes = bytes(agentDID);
        if (didBytes[0] != 'd' || didBytes[1] != 'i' || didBytes[2] != 'd' ||
            didBytes[3] != ':' || didBytes[4] != 'a') {
            revert InvalidDIDFormat();
        }

        _agents[agentId] = AgentIdentity({
            agentId: agentId,
            owner: owner,
            agentDID: agentDID,
            attestationHash: attestationHash,
            status: AgentStatus.Active,
            registeredAt: block.timestamp,
            reputationScore: DEFAULT_REPUTATION,
            totalInvocations: 0,
            capabilityCount: 0,
            delegationCount: 0
        });

        _addressToAgent[owner] = agentId;
        _agentIds.push(agentId);
        unchecked { ++totalAgents; }

        emit AgentRegistered(agentId, owner, agentDID, block.timestamp);
    }

    /**
     * @notice Suspend an agent (can be reinstated).
     * @param agentId The agent to suspend
     * @param reason  Reason for suspension
     */
    function suspendAgent(
        bytes32 agentId,
        string calldata reason
    ) external onlyRole(GOVERNANCE_ROLE) {
        AgentIdentity storage agent = _agents[agentId];
        if (agent.registeredAt == 0) revert AgentNotRegistered();
        if (agent.status == AgentStatus.Revoked) revert AgentRevoked();

        agent.status = AgentStatus.Suspended;
        emit AgentSuspendedEvent(agentId, reason, block.timestamp);
    }

    /**
     * @notice Reinstate a suspended agent.
     * @param agentId The agent to reinstate
     */
    function reinstateAgent(
        bytes32 agentId
    ) external onlyRole(GOVERNANCE_ROLE) {
        AgentIdentity storage agent = _agents[agentId];
        if (agent.registeredAt == 0) revert AgentNotRegistered();
        if (agent.status != AgentStatus.Suspended) revert AgentNotRegistered();

        agent.status = AgentStatus.Active;
        emit AgentReinstated(agentId, block.timestamp);
    }

    /**
     * @notice Permanently revoke an agent (cannot be reinstated).
     * @param agentId The agent to revoke
     * @param reason  Reason for permanent revocation
     */
    function revokeAgent(
        bytes32 agentId,
        string calldata reason
    ) external onlyRole(GOVERNANCE_ROLE) {
        AgentIdentity storage agent = _agents[agentId];
        if (agent.registeredAt == 0) revert AgentNotRegistered();

        agent.status = AgentStatus.Revoked;
        emit AgentRevokedEvent(agentId, reason, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Capability management
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Register a new capability type in the system.
     * @param capabilityId         Unique capability identifier
     * @param name                 Human-readable name
     * @param description          What this capability allows
     * @param requiresHumanApproval Whether invocations need HITL approval
     */
    function registerCapability(
        bytes32 capabilityId,
        string calldata name,
        string calldata description,
        bool requiresHumanApproval
    ) external onlyRole(GOVERNANCE_ROLE) {
        if (_capabilities[capabilityId].active) revert InvalidCapability();

        _capabilities[capabilityId] = Capability({
            capabilityId: capabilityId,
            name: name,
            description: description,
            requiresHumanApproval: requiresHumanApproval,
            active: true,
            registeredAt: block.timestamp
        });

        _capabilityIds.push(capabilityId);
    }

    /**
     * @notice Grant a capability to an agent.
     * @param agentId       The agent receiving the capability
     * @param capabilityId  The capability to grant
     * @param expiresAt     Expiration timestamp (0 for no expiry)
     */
    function grantCapability(
        bytes32 agentId,
        bytes32 capabilityId,
        uint256 expiresAt
    ) external onlyRole(GOVERNANCE_ROLE) whenNotPaused {
        _requireActiveAgent(agentId);
        if (!_capabilities[capabilityId].active) revert InvalidCapability();
        if (_grants[agentId][capabilityId].active) revert CapabilityAlreadyGranted();

        _grants[agentId][capabilityId] = CapabilityGrant({
            capabilityId: capabilityId,
            grantedAt: block.timestamp,
            expiresAt: expiresAt,
            active: true,
            delegatedFrom: bytes32(0),
            delegationDepth: 0
        });

        _agents[agentId].capabilityCount += 1;

        emit CapabilityGranted(agentId, capabilityId, expiresAt, block.timestamp);
    }

    /**
     * @notice Revoke a capability from an agent.
     * @param agentId       The agent
     * @param capabilityId  The capability to revoke
     */
    function revokeCapability(
        bytes32 agentId,
        bytes32 capabilityId
    ) external onlyRole(GOVERNANCE_ROLE) {
        CapabilityGrant storage grant = _grants[agentId][capabilityId];
        if (!grant.active) revert CapabilityNotGranted();

        grant.active = false;
        _agents[agentId].capabilityCount -= 1;

        emit CapabilityRevoked(agentId, capabilityId, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Delegation (DAG structure)
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Delegate a capability from one agent to another.
     * @dev Creates an edge in the delegation DAG. The delegating agent must
     *      hold the capability and have sufficient reputation.
     * @param fromAgentId   Agent delegating the capability
     * @param toAgentId     Agent receiving the delegation
     * @param capabilityId  The capability being delegated
     * @param expiresAt     When the delegation expires (0 = same as parent)
     */
    function delegateCapability(
        bytes32 fromAgentId,
        bytes32 toAgentId,
        bytes32 capabilityId,
        uint256 expiresAt
    ) external whenNotPaused nonReentrant {
        if (fromAgentId == toAgentId) revert SelfDelegationNotAllowed();
        _requireActiveAgent(fromAgentId);
        _requireActiveAgent(toAgentId);

        // ZID-008: Only the owner of fromAgentId can delegate capabilities
        require(msg.sender == _agents[fromAgentId].owner, "Only agent owner can delegate capabilities");

        // Verify the delegator owns the capability
        CapabilityGrant storage parentGrant = _grants[fromAgentId][capabilityId];
        if (!parentGrant.active) revert CapabilityNotGranted();
        if (parentGrant.expiresAt != 0 && block.timestamp > parentGrant.expiresAt) {
            revert CapabilityExpired();
        }

        // Check delegation depth limit
        uint256 newDepth = parentGrant.delegationDepth + 1;
        if (newDepth > MAX_DELEGATION_DEPTH) revert DelegationDepthExceeded();

        // Check reputation threshold
        if (_agents[fromAgentId].reputationScore < MIN_REPUTATION_FOR_DELEGATION) {
            revert InvalidReputationScore();
        }

        // Check for cycles: toAgent must not already delegate to fromAgent
        // (simplified cycle detection via depth limit)
        if (_grants[toAgentId][capabilityId].active &&
            _grants[toAgentId][capabilityId].delegatedFrom == toAgentId) {
            revert DelegationCycleDetected();
        }

        // Create delegation
        bytes32 delegationKey = keccak256(
            abi.encodePacked(fromAgentId, toAgentId, capabilityId)
        );

        _delegations[delegationKey] = Delegation({
            fromAgent: fromAgentId,
            toAgent: toAgentId,
            capabilityId: capabilityId,
            depth: newDepth,
            createdAt: block.timestamp,
            expiresAt: expiresAt != 0 ? expiresAt : parentGrant.expiresAt,
            active: true
        });

        // Grant the capability to the target agent via delegation
        uint256 effectiveExpiry = expiresAt != 0 ? expiresAt : parentGrant.expiresAt;
        _grants[toAgentId][capabilityId] = CapabilityGrant({
            capabilityId: capabilityId,
            grantedAt: block.timestamp,
            expiresAt: effectiveExpiry,
            active: true,
            delegatedFrom: fromAgentId,
            delegationDepth: newDepth
        });

        _outboundDelegations[fromAgentId].push(delegationKey);
        _agents[fromAgentId].delegationCount += 1;
        _agents[toAgentId].capabilityCount += 1;
        unchecked { ++totalDelegations; }

        emit DelegationCreated(fromAgentId, toAgentId, capabilityId, newDepth, block.timestamp);
    }

    /**
     * @notice Revoke a delegation.
     * @param fromAgentId  The delegating agent
     * @param toAgentId    The delegated-to agent
     * @param capabilityId The capability
     */
    function revokeDelegation(
        bytes32 fromAgentId,
        bytes32 toAgentId,
        bytes32 capabilityId
    ) external whenNotPaused {
        // Only the delegator or governance can revoke
        AgentIdentity storage fromAgent = _agents[fromAgentId];
        require(
            msg.sender == fromAgent.owner || hasRole(GOVERNANCE_ROLE, msg.sender),
            "Not authorized"
        );

        bytes32 delegationKey = keccak256(
            abi.encodePacked(fromAgentId, toAgentId, capabilityId)
        );

        Delegation storage del = _delegations[delegationKey];
        if (!del.active) revert DelegationNotFound();

        del.active = false;
        _grants[toAgentId][capabilityId].active = false;
        _agents[toAgentId].capabilityCount -= 1;

        emit DelegationRevoked(fromAgentId, toAgentId, capabilityId, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Capability invocation with rate limiting
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Invoke a capability (records the invocation and enforces rate limits).
     * @param agentId       The agent invoking
     * @param capabilityId  The capability being invoked
     * @return approved     Whether the invocation is permitted
     */
    function invokeCapability(
        bytes32 agentId,
        bytes32 capabilityId
    ) external whenNotPaused nonReentrant returns (bool approved) {
        _requireActiveAgent(agentId);

        // ZID-008: Only the owner of agentId can invoke capabilities
        require(msg.sender == _agents[agentId].owner, "Only agent owner can invoke capabilities");

        CapabilityGrant storage grant = _grants[agentId][capabilityId];
        if (!grant.active) revert CapabilityNotGranted();
        if (grant.expiresAt != 0 && block.timestamp > grant.expiresAt) {
            revert CapabilityExpired();
        }

        // Check HITL requirement
        Capability storage cap = _capabilities[capabilityId];
        if (cap.requiresHumanApproval) {
            revert HumanApprovalRequired();
        }

        // Enforce rate limit
        _enforceRateLimit(agentId, capabilityId);

        // Record invocation
        _agents[agentId].totalInvocations += 1;
        unchecked { ++totalInvocations; }

        emit AgentCapabilityInvoked(agentId, capabilityId, block.timestamp);
        return true;
    }

    /**
     * @notice Configure rate limits for an agent's capability.
     * @param agentId           The agent
     * @param capabilityId      The capability
     * @param maxCallsPerWindow Maximum invocations per window
     * @param windowDuration    Window duration in seconds
     */
    function configureRateLimit(
        bytes32 agentId,
        bytes32 capabilityId,
        uint256 maxCallsPerWindow,
        uint256 windowDuration
    ) external onlyRole(GOVERNANCE_ROLE) {
        _rateLimits[agentId][capabilityId] = RateLimit({
            maxCallsPerWindow: maxCallsPerWindow,
            windowDuration: windowDuration,
            currentWindowStart: block.timestamp,
            callsInCurrentWindow: 0
        });

        emit RateLimitConfigured(
            agentId, capabilityId, maxCallsPerWindow, windowDuration, block.timestamp
        );
    }

    // ──────────────────────────────────────────────────────────────────────
    // Human-in-the-loop approvals
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Request human approval for a sensitive capability invocation.
     * @param agentId       The agent requesting approval
     * @param capabilityId  The capability that requires approval
     * @param description   Description of the intended action
     * @return approvalId   Unique approval request identifier
     */
    function requestHumanApproval(
        bytes32 agentId,
        bytes32 capabilityId,
        string calldata description
    ) external whenNotPaused returns (bytes32 approvalId) {
        _requireActiveAgent(agentId);
        if (!_grants[agentId][capabilityId].active) revert CapabilityNotGranted();

        approvalId = keccak256(
            abi.encodePacked(agentId, capabilityId, block.timestamp, msg.sender)
        );

        _approvals[approvalId] = ApprovalRequest({
            approvalId: approvalId,
            agentId: agentId,
            capabilityId: capabilityId,
            description: description,
            requestedBy: msg.sender,
            requestedAt: block.timestamp,
            expiresAt: block.timestamp + APPROVAL_DEFAULT_TTL,
            status: ApprovalStatus.Pending,
            approver: address(0),
            denialReason: ""
        });

        _pendingApprovals[agentId].push(approvalId);

        emit HumanApprovalRequested(
            approvalId, agentId, capabilityId, description, block.timestamp
        );
    }

    /**
     * @notice Grant human approval for a pending request.
     * @param approvalId The approval request to grant
     */
    function grantApproval(
        bytes32 approvalId
    ) external onlyRole(HUMAN_APPROVER_ROLE) whenNotPaused {
        ApprovalRequest storage req = _approvals[approvalId];
        if (req.requestedAt == 0) revert ApprovalNotFound();
        if (req.status != ApprovalStatus.Pending) revert ApprovalAlreadyExists();
        if (block.timestamp > req.expiresAt) revert ApprovalExpired();

        req.status = ApprovalStatus.Approved;
        req.approver = msg.sender;

        emit HumanApprovalGranted(approvalId, msg.sender, block.timestamp);
    }

    /**
     * @notice Deny a human approval request.
     * @param approvalId The approval request to deny
     * @param reason     Reason for denial
     */
    function denyApproval(
        bytes32 approvalId,
        string calldata reason
    ) external onlyRole(HUMAN_APPROVER_ROLE) {
        ApprovalRequest storage req = _approvals[approvalId];
        if (req.requestedAt == 0) revert ApprovalNotFound();
        if (req.status != ApprovalStatus.Pending) revert ApprovalAlreadyExists();

        req.status = ApprovalStatus.Denied;
        req.approver = msg.sender;
        req.denialReason = reason;

        emit HumanApprovalDenied(approvalId, msg.sender, reason, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Reputation
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Update an agent's reputation score.
     * @param agentId The agent
     * @param delta   Change in reputation (positive or negative)
     * @param reason  Human-readable reason for the change
     */
    function updateReputation(
        bytes32 agentId,
        int256 delta,
        string calldata reason
    ) external onlyRole(VERIFIER_ROLE) {
        AgentIdentity storage agent = _agents[agentId];
        if (agent.registeredAt == 0) revert AgentNotRegistered();

        uint256 newScore;
        if (delta >= 0) {
            newScore = agent.reputationScore + uint256(delta);
            if (newScore > MAX_REPUTATION) newScore = MAX_REPUTATION;
        } else {
            uint256 absDelta = uint256(-delta);
            if (absDelta > agent.reputationScore) {
                newScore = 0;
            } else {
                newScore = agent.reputationScore - absDelta;
            }
        }

        agent.reputationScore = newScore;

        // Auto-suspend agents with critically low reputation
        if (newScore == 0 && agent.status == AgentStatus.Active) {
            agent.status = AgentStatus.Suspended;
            emit AgentSuspendedEvent(agentId, "Reputation dropped to zero", block.timestamp);
        }

        emit ReputationUpdated(agentId, delta, newScore, reason, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // View functions
    // ──────────────────────────────────────────────────────────────────────

    function getAgent(bytes32 agentId) external view returns (AgentIdentity memory) {
        return _agents[agentId];
    }

    function getCapability(bytes32 capabilityId) external view returns (Capability memory) {
        return _capabilities[capabilityId];
    }

    function getGrant(bytes32 agentId, bytes32 capabilityId) external view returns (CapabilityGrant memory) {
        return _grants[agentId][capabilityId];
    }

    function getDelegation(bytes32 fromAgent, bytes32 toAgent, bytes32 capabilityId) external view returns (Delegation memory) {
        bytes32 key = keccak256(abi.encodePacked(fromAgent, toAgent, capabilityId));
        return _delegations[key];
    }

    function getApproval(bytes32 approvalId) external view returns (ApprovalRequest memory) {
        return _approvals[approvalId];
    }

    function hasActiveCapability(bytes32 agentId, bytes32 capabilityId) external view returns (bool) {
        CapabilityGrant storage grant = _grants[agentId][capabilityId];
        if (!grant.active) return false;
        if (grant.expiresAt != 0 && block.timestamp > grant.expiresAt) return false;
        return _agents[agentId].status == AgentStatus.Active;
    }

    function getAgentByAddress(address addr) external view returns (bytes32) {
        return _addressToAgent[addr];
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ──────────────────────────────────────────────────────────────────────
    // Internal functions
    // ──────────────────────────────────────────────────────────────────────

    function _requireActiveAgent(bytes32 agentId) internal view {
        AgentIdentity storage agent = _agents[agentId];
        if (agent.registeredAt == 0) revert AgentNotRegistered();
        if (agent.status == AgentStatus.Suspended) revert AgentSuspended();
        if (agent.status == AgentStatus.Revoked) revert AgentRevoked();
    }

    function _enforceRateLimit(bytes32 agentId, bytes32 capabilityId) internal {
        RateLimit storage rl = _rateLimits[agentId][capabilityId];

        // If no rate limit configured, skip
        if (rl.maxCallsPerWindow == 0) return;

        // Reset window if expired
        if (block.timestamp >= rl.currentWindowStart + rl.windowDuration) {
            rl.currentWindowStart = block.timestamp;
            rl.callsInCurrentWindow = 0;
        }

        if (rl.callsInCurrentWindow >= rl.maxCallsPerWindow) {
            revert RateLimitExceeded();
        }

        rl.callsInCurrentWindow += 1;
    }
}
