// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";

contract AIAgentRegistryTest is TestHelper {
    AIAgentRegistry public registry;

    bytes32 constant AGENT_1 = keccak256("agent:1");
    bytes32 constant AGENT_2 = keccak256("agent:2");
    bytes32 constant CAP_VERIFY = keccak256("identity.verify");
    bytes32 constant CAP_SIGN = keccak256("identity.sign");
    string constant DID_1 = "did:agent:31337:0x1234";
    string constant DID_2 = "did:agent:31337:0x5678";

    function setUp() public {
        registry = new AIAgentRegistry(admin);

        // Register a capability
        vm.prank(admin);
        registry.registerCapability(CAP_VERIFY, "Verify Identity", "Can verify identities", false);

        vm.prank(admin);
        registry.registerCapability(CAP_SIGN, "Sign Docs", "Requires human approval", true);
    }

    function _registerAgent1() internal {
        registry.registerAgent(AGENT_1, alice, DID_1, keccak256("att:1"));
    }

    function _registerAgent2() internal {
        registry.registerAgent(AGENT_2, bob, DID_2, keccak256("att:2"));
    }

    // ════════════════════════════════════════════════════════════════
    // Deployment
    // ════════════════════════════════════════════════════════════════

    function test_Constructor_SetsRoles() public view {
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.GOVERNANCE_ROLE(), admin));
        assertTrue(registry.hasRole(registry.HUMAN_APPROVER_ROLE(), admin));
    }

    function test_InitialState() public view {
        assertEq(registry.totalAgents(), 0);
        assertEq(registry.totalDelegations(), 0);
        assertEq(registry.totalInvocations(), 0);
    }

    function test_Constants() public view {
        assertEq(registry.MAX_DELEGATION_DEPTH(), 5);
        assertEq(registry.DEFAULT_REPUTATION(), 5000);
        assertEq(registry.MAX_REPUTATION(), 10000);
        assertEq(registry.APPROVAL_DEFAULT_TTL(), 24 hours);
        assertEq(registry.MIN_REPUTATION_FOR_DELEGATION(), 3000);
    }

    // ════════════════════════════════════════════════════════════════
    // Agent Registration
    // ════════════════════════════════════════════════════════════════

    function test_RegisterAgent_Success() public {
        vm.expectEmit(true, true, false, true);
        emit AIAgentRegistry.AgentRegistered(AGENT_1, alice, DID_1, block.timestamp);
        _registerAgent1();

        assertEq(registry.totalAgents(), 1);

        AIAgentRegistry.AgentIdentity memory agent = registry.getAgent(AGENT_1);
        assertEq(agent.owner, alice);
        assertEq(agent.reputationScore, 5000);
        assertEq(uint8(agent.status), uint8(AIAgentRegistry.AgentStatus.Active));
    }

    function test_RegisterAgent_RevertsDuplicate() public {
        _registerAgent1();

        vm.expectRevert(AIAgentRegistry.AgentAlreadyRegistered.selector);
        registry.registerAgent(AGENT_1, bob, DID_2, keccak256("att"));
    }

    function test_RegisterAgent_RevertsInvalidDID_TooShort() public {
        vm.expectRevert(AIAgentRegistry.InvalidDIDFormat.selector);
        registry.registerAgent(AGENT_1, alice, "short", keccak256("att"));
    }

    function test_RegisterAgent_RevertsInvalidDID_WrongPrefix() public {
        vm.expectRevert(AIAgentRegistry.InvalidDIDFormat.selector);
        registry.registerAgent(AGENT_1, alice, "xyz:agent:31337:0x1234", keccak256("att"));
    }

    function test_GetAgentByAddress() public {
        _registerAgent1();
        assertEq(registry.getAgentByAddress(alice), AGENT_1);
    }

    // ════════════════════════════════════════════════════════════════
    // Agent Lifecycle
    // ════════════════════════════════════════════════════════════════

    function test_SuspendAgent_Success() public {
        _registerAgent1();

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit AIAgentRegistry.AgentSuspendedEvent(AGENT_1, "misbehavior", block.timestamp);
        registry.suspendAgent(AGENT_1, "misbehavior");

        AIAgentRegistry.AgentIdentity memory agent = registry.getAgent(AGENT_1);
        assertEq(uint8(agent.status), uint8(AIAgentRegistry.AgentStatus.Suspended));
    }

    function test_SuspendAgent_RevertsNotRegistered() public {
        vm.prank(admin);
        vm.expectRevert(AIAgentRegistry.AgentNotRegistered.selector);
        registry.suspendAgent(keccak256("unknown"), "reason");
    }

    function test_SuspendAgent_RevertsAlreadyRevoked() public {
        _registerAgent1();

        vm.prank(admin);
        registry.revokeAgent(AGENT_1, "bad");

        vm.prank(admin);
        vm.expectRevert(AIAgentRegistry.AgentRevoked.selector);
        registry.suspendAgent(AGENT_1, "again");
    }

    function test_ReinstateAgent_Success() public {
        _registerAgent1();

        vm.prank(admin);
        registry.suspendAgent(AGENT_1, "temp");

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit AIAgentRegistry.AgentReinstated(AGENT_1, block.timestamp);
        registry.reinstateAgent(AGENT_1);

        AIAgentRegistry.AgentIdentity memory agent = registry.getAgent(AGENT_1);
        assertEq(uint8(agent.status), uint8(AIAgentRegistry.AgentStatus.Active));
    }

    function test_ReinstateAgent_RevertsNotSuspended() public {
        _registerAgent1();

        vm.prank(admin);
        vm.expectRevert(AIAgentRegistry.AgentNotRegistered.selector);
        registry.reinstateAgent(AGENT_1); // Active, not Suspended
    }

    function test_RevokeAgent_Success() public {
        _registerAgent1();

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit AIAgentRegistry.AgentRevokedEvent(AGENT_1, "permanent", block.timestamp);
        registry.revokeAgent(AGENT_1, "permanent");

        AIAgentRegistry.AgentIdentity memory agent = registry.getAgent(AGENT_1);
        assertEq(uint8(agent.status), uint8(AIAgentRegistry.AgentStatus.Revoked));
    }

    // ════════════════════════════════════════════════════════════════
    // Capability Management
    // ════════════════════════════════════════════════════════════════

    function test_RegisterCapability_RevertsDuplicate() public {
        vm.prank(admin);
        vm.expectRevert(AIAgentRegistry.InvalidCapability.selector);
        registry.registerCapability(CAP_VERIFY, "dup", "dup", false);
    }

    function test_GrantCapability_Success() public {
        _registerAgent1();

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit AIAgentRegistry.CapabilityGranted(AGENT_1, CAP_VERIFY, 0, block.timestamp);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);

        assertTrue(registry.hasActiveCapability(AGENT_1, CAP_VERIFY));

        AIAgentRegistry.AgentIdentity memory agent = registry.getAgent(AGENT_1);
        assertEq(agent.capabilityCount, 1);
    }

    function test_GrantCapability_RevertsDuplicate() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);

        vm.prank(admin);
        vm.expectRevert(AIAgentRegistry.CapabilityAlreadyGranted.selector);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);
    }

    function test_GrantCapability_RevertsAgentNotRegistered() public {
        vm.prank(admin);
        vm.expectRevert(AIAgentRegistry.AgentNotRegistered.selector);
        registry.grantCapability(keccak256("bad"), CAP_VERIFY, 0);
    }

    function test_GrantCapability_RevertsInvalidCapability() public {
        _registerAgent1();

        vm.prank(admin);
        vm.expectRevert(AIAgentRegistry.InvalidCapability.selector);
        registry.grantCapability(AGENT_1, keccak256("nonexistent"), 0);
    }

    function test_RevokeCapability_Success() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit AIAgentRegistry.CapabilityRevoked(AGENT_1, CAP_VERIFY, block.timestamp);
        registry.revokeCapability(AGENT_1, CAP_VERIFY);

        assertFalse(registry.hasActiveCapability(AGENT_1, CAP_VERIFY));
    }

    function test_RevokeCapability_RevertsNotGranted() public {
        _registerAgent1();

        vm.prank(admin);
        vm.expectRevert(AIAgentRegistry.CapabilityNotGranted.selector);
        registry.revokeCapability(AGENT_1, CAP_VERIFY);
    }

    function test_HasActiveCapability_FalseWhenExpired() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, block.timestamp + 1 hours);

        vm.warp(block.timestamp + 2 hours);

        assertFalse(registry.hasActiveCapability(AGENT_1, CAP_VERIFY));
    }

    function test_HasActiveCapability_FalseWhenSuspended() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);

        vm.prank(admin);
        registry.suspendAgent(AGENT_1, "temp");

        assertFalse(registry.hasActiveCapability(AGENT_1, CAP_VERIFY));
    }

    // ════════════════════════════════════════════════════════════════
    // Delegation
    // ════════════════════════════════════════════════════════════════

    function test_DelegateCapability_Success() public {
        _registerAgent1();
        _registerAgent2();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);

        vm.prank(alice); // ZID-008: must be agent owner
        vm.expectEmit(true, true, true, true);
        emit AIAgentRegistry.DelegationCreated(AGENT_1, AGENT_2, CAP_VERIFY, 1, block.timestamp);
        registry.delegateCapability(AGENT_1, AGENT_2, CAP_VERIFY, 0);

        assertEq(registry.totalDelegations(), 1);
        assertTrue(registry.hasActiveCapability(AGENT_2, CAP_VERIFY));
    }

    function test_DelegateCapability_RevertsSelfDelegation() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);

        vm.prank(alice); // ZID-008: must be agent owner
        vm.expectRevert(AIAgentRegistry.SelfDelegationNotAllowed.selector);
        registry.delegateCapability(AGENT_1, AGENT_1, CAP_VERIFY, 0);
    }

    function test_DelegateCapability_RevertsCapabilityNotGranted() public {
        _registerAgent1();
        _registerAgent2();

        vm.prank(alice); // ZID-008: must be agent owner
        vm.expectRevert(AIAgentRegistry.CapabilityNotGranted.selector);
        registry.delegateCapability(AGENT_1, AGENT_2, CAP_VERIFY, 0);
    }

    function test_DelegateCapability_RevertsLowReputation() public {
        _registerAgent1();
        _registerAgent2();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);

        // Drop reputation below threshold
        bytes32 verifierRole = registry.VERIFIER_ROLE();
        vm.prank(admin);
        registry.grantRole(verifierRole, admin);
        vm.prank(admin);
        registry.updateReputation(AGENT_1, -3000, "poor performance");

        vm.prank(alice); // ZID-008: must be agent owner
        vm.expectRevert(AIAgentRegistry.InvalidReputationScore.selector);
        registry.delegateCapability(AGENT_1, AGENT_2, CAP_VERIFY, 0);
    }

    function test_RevokeDelegation_Success() public {
        _registerAgent1();
        _registerAgent2();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);

        vm.prank(alice); // ZID-008: must be agent owner
        registry.delegateCapability(AGENT_1, AGENT_2, CAP_VERIFY, 0);

        vm.prank(alice); // agent 1 owner
        vm.expectEmit(true, true, true, true);
        emit AIAgentRegistry.DelegationRevoked(AGENT_1, AGENT_2, CAP_VERIFY, block.timestamp);
        registry.revokeDelegation(AGENT_1, AGENT_2, CAP_VERIFY);

        assertFalse(registry.hasActiveCapability(AGENT_2, CAP_VERIFY));
    }

    function test_RevokeDelegation_RevertsNotFound() public {
        _registerAgent1();
        _registerAgent2();

        vm.prank(alice);
        vm.expectRevert(AIAgentRegistry.DelegationNotFound.selector);
        registry.revokeDelegation(AGENT_1, AGENT_2, CAP_VERIFY);
    }

    // ════════════════════════════════════════════════════════════════
    // Capability Invocation
    // ════════════════════════════════════════════════════════════════

    function test_InvokeCapability_Success() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);

        vm.prank(alice); // ZID-008: must be agent owner
        vm.expectEmit(true, true, false, true);
        emit AIAgentRegistry.AgentCapabilityInvoked(AGENT_1, CAP_VERIFY, block.timestamp);
        bool approved = registry.invokeCapability(AGENT_1, CAP_VERIFY);
        assertTrue(approved);

        assertEq(registry.totalInvocations(), 1);
    }

    function test_InvokeCapability_RevertsHumanApprovalRequired() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_SIGN, 0);

        vm.prank(alice); // ZID-008: must be agent owner
        vm.expectRevert(AIAgentRegistry.HumanApprovalRequired.selector);
        registry.invokeCapability(AGENT_1, CAP_SIGN);
    }

    function test_InvokeCapability_RevertsCapabilityExpired() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, block.timestamp + 1 hours);

        vm.warp(block.timestamp + 2 hours);

        vm.prank(alice); // ZID-008: must be agent owner
        vm.expectRevert(AIAgentRegistry.CapabilityExpired.selector);
        registry.invokeCapability(AGENT_1, CAP_VERIFY);
    }

    function test_InvokeCapability_RevertsRateLimit() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);

        vm.prank(admin);
        registry.configureRateLimit(AGENT_1, CAP_VERIFY, 2, 1 hours);

        vm.prank(alice);
        registry.invokeCapability(AGENT_1, CAP_VERIFY);
        vm.prank(alice);
        registry.invokeCapability(AGENT_1, CAP_VERIFY);

        vm.prank(alice);
        vm.expectRevert(AIAgentRegistry.RateLimitExceeded.selector);
        registry.invokeCapability(AGENT_1, CAP_VERIFY);
    }

    function test_InvokeCapability_RateLimitResetsAfterWindow() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);

        vm.prank(admin);
        registry.configureRateLimit(AGENT_1, CAP_VERIFY, 1, 1 hours);

        vm.prank(alice);
        registry.invokeCapability(AGENT_1, CAP_VERIFY);

        vm.warp(block.timestamp + 2 hours);

        // Should succeed after window reset
        vm.prank(alice);
        bool approved = registry.invokeCapability(AGENT_1, CAP_VERIFY);
        assertTrue(approved);
    }

    // ════════════════════════════════════════════════════════════════
    // Human-in-the-Loop Approvals
    // ════════════════════════════════════════════════════════════════

    function test_RequestHumanApproval_Success() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_SIGN, 0);

        bytes32 approvalId = registry.requestHumanApproval(AGENT_1, CAP_SIGN, "Need to sign document");

        AIAgentRegistry.ApprovalRequest memory req = registry.getApproval(approvalId);
        assertEq(req.agentId, AGENT_1);
        assertEq(uint8(req.status), uint8(AIAgentRegistry.ApprovalStatus.Pending));
    }

    function test_GrantApproval_Success() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_SIGN, 0);

        bytes32 approvalId = registry.requestHumanApproval(AGENT_1, CAP_SIGN, "Sign doc");

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit AIAgentRegistry.HumanApprovalGranted(approvalId, admin, block.timestamp);
        registry.grantApproval(approvalId);

        AIAgentRegistry.ApprovalRequest memory req = registry.getApproval(approvalId);
        assertEq(uint8(req.status), uint8(AIAgentRegistry.ApprovalStatus.Approved));
    }

    function test_GrantApproval_RevertsNotFound() public {
        vm.prank(admin);
        vm.expectRevert(AIAgentRegistry.ApprovalNotFound.selector);
        registry.grantApproval(keccak256("unknown"));
    }

    function test_GrantApproval_RevertsExpired() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_SIGN, 0);

        bytes32 approvalId = registry.requestHumanApproval(AGENT_1, CAP_SIGN, "Sign doc");

        vm.warp(block.timestamp + 25 hours);

        vm.prank(admin);
        vm.expectRevert(AIAgentRegistry.ApprovalExpired.selector);
        registry.grantApproval(approvalId);
    }

    function test_DenyApproval_Success() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_SIGN, 0);

        bytes32 approvalId = registry.requestHumanApproval(AGENT_1, CAP_SIGN, "Sign doc");

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit AIAgentRegistry.HumanApprovalDenied(approvalId, admin, "Risky operation", block.timestamp);
        registry.denyApproval(approvalId, "Risky operation");

        AIAgentRegistry.ApprovalRequest memory req = registry.getApproval(approvalId);
        assertEq(uint8(req.status), uint8(AIAgentRegistry.ApprovalStatus.Denied));
    }

    // ════════════════════════════════════════════════════════════════
    // Reputation
    // ════════════════════════════════════════════════════════════════

    function test_UpdateReputation_Increase() public {
        _registerAgent1();

        bytes32 verifierRole = registry.VERIFIER_ROLE();
        vm.prank(admin);
        registry.grantRole(verifierRole, admin);

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit AIAgentRegistry.ReputationUpdated(AGENT_1, 2000, 7000, "good work", block.timestamp);
        registry.updateReputation(AGENT_1, 2000, "good work");

        AIAgentRegistry.AgentIdentity memory agent = registry.getAgent(AGENT_1);
        assertEq(agent.reputationScore, 7000);
    }

    function test_UpdateReputation_Decrease() public {
        _registerAgent1();

        bytes32 verifierRole = registry.VERIFIER_ROLE();
        vm.prank(admin);
        registry.grantRole(verifierRole, admin);

        vm.prank(admin);
        registry.updateReputation(AGENT_1, -1000, "mistake");

        AIAgentRegistry.AgentIdentity memory agent = registry.getAgent(AGENT_1);
        assertEq(agent.reputationScore, 4000);
    }

    function test_UpdateReputation_CapsAtMax() public {
        _registerAgent1();

        bytes32 verifierRole = registry.VERIFIER_ROLE();
        vm.prank(admin);
        registry.grantRole(verifierRole, admin);

        vm.prank(admin);
        registry.updateReputation(AGENT_1, 20000, "outstanding");

        AIAgentRegistry.AgentIdentity memory agent = registry.getAgent(AGENT_1);
        assertEq(agent.reputationScore, 10000); // capped
    }

    function test_UpdateReputation_AutoSuspendsAtZero() public {
        _registerAgent1();

        bytes32 verifierRole = registry.VERIFIER_ROLE();
        vm.prank(admin);
        registry.grantRole(verifierRole, admin);

        vm.prank(admin);
        registry.updateReputation(AGENT_1, -5000, "very bad");

        AIAgentRegistry.AgentIdentity memory agent = registry.getAgent(AGENT_1);
        assertEq(agent.reputationScore, 0);
        assertEq(uint8(agent.status), uint8(AIAgentRegistry.AgentStatus.Suspended));
    }

    function test_UpdateReputation_RevertsNotRegistered() public {
        bytes32 verifierRole = registry.VERIFIER_ROLE();
        vm.prank(admin);
        registry.grantRole(verifierRole, admin);

        vm.prank(admin);
        vm.expectRevert(AIAgentRegistry.AgentNotRegistered.selector);
        registry.updateReputation(keccak256("bad"), 100, "test");
    }

    // ════════════════════════════════════════════════════════════════
    // Rate Limiting
    // ════════════════════════════════════════════════════════════════

    function test_ConfigureRateLimit() public {
        _registerAgent1();

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit AIAgentRegistry.RateLimitConfigured(AGENT_1, CAP_VERIFY, 10, 3600, block.timestamp);
        registry.configureRateLimit(AGENT_1, CAP_VERIFY, 10, 3600);
    }

    // ════════════════════════════════════════════════════════════════
    // Pause
    // ════════════════════════════════════════════════════════════════

    function test_Pause_BlocksRegistration() public {
        vm.prank(admin);
        registry.pause();

        vm.expectRevert();
        registry.registerAgent(AGENT_1, alice, DID_1, keccak256("att"));
    }

    function test_Pause_BlocksInvocation() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);

        vm.prank(admin);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.invokeCapability(AGENT_1, CAP_VERIFY);
    }

    // ════════════════════════════════════════════════════════════════
    // ZID-008: Owner Authentication
    // ════════════════════════════════════════════════════════════════

    function test_DelegateCapability_RevertsNonOwner() public {
        _registerAgent1();
        _registerAgent2();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);

        // bob is not the owner of AGENT_1 (alice is)
        vm.prank(bob);
        vm.expectRevert("Only agent owner can delegate capabilities");
        registry.delegateCapability(AGENT_1, AGENT_2, CAP_VERIFY, 0);
    }

    function test_InvokeCapability_RevertsNonOwner() public {
        _registerAgent1();

        vm.prank(admin);
        registry.grantCapability(AGENT_1, CAP_VERIFY, 0);

        // bob is not the owner of AGENT_1 (alice is)
        vm.prank(bob);
        vm.expectRevert("Only agent owner can invoke capabilities");
        registry.invokeCapability(AGENT_1, CAP_VERIFY);
    }
}
