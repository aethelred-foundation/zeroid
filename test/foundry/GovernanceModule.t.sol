// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";

contract GovernanceModuleTest is TestHelper {
    GovernanceModule public gov;

    bytes32 constant SCHEMA_HASH = keccak256("schema:governance:test");
    bytes32 constant ISSUER_DID = keccak256("did:zeroid:issuer1");

    function setUp() public {
        gov = new GovernanceModule(admin, 1 days, 1);

        // Set up voter (alice) with weight
        vm.startPrank(admin);
        gov.setVoterWeight(alice, 1);
        gov.setVoterWeight(bob, 1);
        vm.stopPrank();
    }

    // ════════════════════════════════════════════════════════════════
    // Deployment
    // ════════════════════════════════════════════════════════════════

    function test_Constructor_SetsRolesAndParams() public view {
        assertTrue(gov.hasRole(gov.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(gov.hasRole(gov.VOTER_ROLE(), admin));
        assertEq(gov.votingPeriod(), 1 days);
        assertEq(gov.quorumRequired(), 1);
        assertEq(gov.nextProposalId(), 1);
    }

    function test_Constructor_RevertsZeroAdmin() public {
        vm.expectRevert("Zero admin");
        new GovernanceModule(address(0), 1 days, 1);
    }

    function test_Constructor_RevertsInvalidVotingPeriod() public {
        vm.expectRevert("Invalid voting period");
        new GovernanceModule(admin, 1 hours, 1); // too short
    }

    function test_Constructor_RevertsZeroQuorum() public {
        vm.expectRevert("Zero quorum");
        new GovernanceModule(admin, 1 days, 0);
    }

    // ════════════════════════════════════════════════════════════════
    // Voter Management
    // ════════════════════════════════════════════════════════════════

    function test_SetVoterWeight() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit GovernanceModule.VoterWeightSet(carol, 5);
        gov.setVoterWeight(carol, 5);

        assertEq(gov.getVoterWeight(carol), 5);
        assertTrue(gov.hasRole(gov.VOTER_ROLE(), carol));
    }

    function test_SetVoterWeight_RevertsZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert("Zero voter");
        gov.setVoterWeight(address(0), 1);
    }

    // ════════════════════════════════════════════════════════════════
    // Schema Proposal
    // ════════════════════════════════════════════════════════════════

    function test_ProposeSchema_Success() public {
        bytes32[] memory attrs = new bytes32[](2);
        attrs[0] = keccak256("attr:name");
        attrs[1] = keccak256("attr:dob");

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit IGovernanceModule.SchemaProposed(SCHEMA_HASH, alice, "KYC Schema");
        uint256 proposalId = gov.proposeSchema(SCHEMA_HASH, "KYC Schema", attrs);

        assertEq(proposalId, 1);
        assertEq(uint8(gov.getProposalState(1)), uint8(ProposalState.Active));
    }

    function test_ProposeSchema_RevertsNoAttributes() public {
        bytes32[] memory attrs = new bytes32[](0);

        vm.prank(alice);
        vm.expectRevert(GovernanceModule.NoAttributes.selector);
        gov.proposeSchema(SCHEMA_HASH, "KYC Schema", attrs);
    }

    function test_ProposeSchema_RevertsZeroHash() public {
        bytes32[] memory attrs = new bytes32[](1);
        attrs[0] = keccak256("a");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(GovernanceModule.SchemaAlreadyExists.selector, bytes32(0)));
        gov.proposeSchema(bytes32(0), "Test", attrs);
    }

    function test_ProposeSchema_RevertsInsufficientVotingPower() public {
        bytes32[] memory attrs = new bytes32[](1);
        attrs[0] = keccak256("a");

        vm.prank(carol); // carol has no weight
        vm.expectRevert();
        gov.proposeSchema(SCHEMA_HASH, "Test", attrs);
    }

    // ════════════════════════════════════════════════════════════════
    // Issuer Proposal
    // ════════════════════════════════════════════════════════════════

    function test_ProposeIssuer_Success() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit IGovernanceModule.IssuerProposed(ISSUER_DID, alice);
        uint256 proposalId = gov.proposeIssuer(ISSUER_DID);

        assertEq(proposalId, 1);
    }

    function test_ProposeIssuer_RevertsZeroDid() public {
        vm.prank(alice);
        vm.expectRevert("Zero issuer DID");
        gov.proposeIssuer(bytes32(0));
    }

    // ════════════════════════════════════════════════════════════════
    // Voting
    // ════════════════════════════════════════════════════════════════

    function test_CastVote_Success() public {
        _createSchemaProposal();

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit IGovernanceModule.VoteCast(1, alice, true, 1);
        gov.castVote(1, true);
    }

    function test_CastVote_RevertsAlreadyVoted() public {
        _createSchemaProposal();

        vm.prank(alice);
        gov.castVote(1, true);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(GovernanceModule.AlreadyVoted.selector, 1, alice));
        gov.castVote(1, true);
    }

    function test_CastVote_RevertsAfterVotingEnds() public {
        _createSchemaProposal();

        vm.warp(block.timestamp + 2 days);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(GovernanceModule.ProposalNotActive.selector, 1));
        gov.castVote(1, true);
    }

    function test_CastVote_RevertsProposalNotFound() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(GovernanceModule.ProposalNotFound.selector, 999));
        gov.castVote(999, true);
    }

    // ════════════════════════════════════════════════════════════════
    // Proposal Lifecycle: Vote → Queue → Execute
    // ════════════════════════════════════════════════════════════════

    function test_FullLifecycle_Schema() public {
        _createSchemaProposal();

        // Vote
        vm.prank(alice);
        gov.castVote(1, true);

        // End voting
        uint256 afterVoting = block.timestamp + 1 days + 1;
        vm.warp(afterVoting);

        // State should be Succeeded
        assertEq(uint8(gov.getProposalState(1)), uint8(ProposalState.Succeeded));

        // Queue
        gov.queueProposal(1);
        assertEq(uint8(gov.getProposalState(1)), uint8(ProposalState.Queued));

        // Wait for timelock
        vm.warp(afterVoting + 24 hours + 1);

        // Execute
        vm.prank(admin);
        gov.executeProposal(1);

        assertEq(uint8(gov.getProposalState(1)), uint8(ProposalState.Executed));
        assertTrue(gov.isApprovedSchema(SCHEMA_HASH));
        assertEq(gov.totalSchemas(), 1);
    }

    function test_FullLifecycle_Issuer() public {
        vm.prank(alice);
        gov.proposeIssuer(ISSUER_DID);

        vm.prank(alice);
        gov.castVote(1, true);

        uint256 afterVoting = block.timestamp + 1 days + 1;
        vm.warp(afterVoting);
        gov.queueProposal(1);

        vm.warp(afterVoting + 24 hours + 1);

        vm.prank(admin);
        gov.executeProposal(1);

        assertTrue(gov.isApprovedIssuer(ISSUER_DID));
        assertEq(gov.totalIssuers(), 1);
    }

    function test_Proposal_Defeated_InsufficientVotes() public {
        _createSchemaProposal();

        vm.prank(alice);
        gov.castVote(1, false); // vote against

        vm.warp(block.timestamp + 1 days + 1);

        assertEq(uint8(gov.getProposalState(1)), uint8(ProposalState.Defeated));
    }

    function test_Proposal_Defeated_NoQuorum() public {
        // Set quorum to 10
        vm.prank(admin);
        gov.setQuorum(10);

        _createSchemaProposal();

        vm.prank(alice);
        gov.castVote(1, true); // only 1 vote, quorum is 10

        vm.warp(block.timestamp + 1 days + 1);

        assertEq(uint8(gov.getProposalState(1)), uint8(ProposalState.Defeated));
    }

    function test_ExecuteProposal_RevertsTimelockNotExpired() public {
        _createSchemaProposal();

        vm.prank(alice);
        gov.castVote(1, true);

        vm.warp(block.timestamp + 1 days + 1);
        gov.queueProposal(1);

        vm.prank(admin);
        vm.expectRevert();
        gov.executeProposal(1); // timelock not expired
    }

    function test_ExecuteProposal_RevertsExecutionWindowExpired() public {
        _createSchemaProposal();

        vm.prank(alice);
        gov.castVote(1, true);

        vm.warp(block.timestamp + 1 days + 1);
        gov.queueProposal(1);

        vm.warp(block.timestamp + 24 hours + 7 days + 2);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(GovernanceModule.ExecutionWindowExpired.selector, 1));
        gov.executeProposal(1);
    }

    // ════════════════════════════════════════════════════════════════
    // Cancel Proposal
    // ════════════════════════════════════════════════════════════════

    function test_CancelProposal_ByProposer() public {
        _createSchemaProposal();

        vm.prank(alice);
        gov.cancelProposal(1);

        assertEq(uint8(gov.getProposalState(1)), uint8(ProposalState.Cancelled));
    }

    function test_CancelProposal_ByAdmin() public {
        _createSchemaProposal();

        vm.prank(admin);
        gov.cancelProposal(1);

        assertEq(uint8(gov.getProposalState(1)), uint8(ProposalState.Cancelled));
    }

    function test_CancelProposal_RevertsAlreadyExecuted() public {
        _createSchemaProposal();
        vm.prank(alice);
        gov.castVote(1, true);
        uint256 afterVoting = block.timestamp + 1 days + 1;
        vm.warp(afterVoting);
        gov.queueProposal(1);
        vm.warp(afterVoting + 24 hours + 1);
        vm.prank(admin);
        gov.executeProposal(1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(GovernanceModule.ProposalAlreadyExecuted.selector, 1));
        gov.cancelProposal(1);
    }

    function test_CancelProposal_RevertsUnauthorized() public {
        _createSchemaProposal();

        vm.prank(carol);
        vm.expectRevert("Not authorized to cancel");
        gov.cancelProposal(1);
    }

    // ════════════════════════════════════════════════════════════════
    // Schema / Issuer Management (direct)
    // ════════════════════════════════════════════════════════════════

    function test_RevokeSchema() public {
        // First approve via governance flow
        _createAndExecuteSchemaProposal();

        vm.prank(admin);
        gov.revokeSchema(SCHEMA_HASH);

        assertFalse(gov.isApprovedSchema(SCHEMA_HASH));
    }

    function test_RemoveIssuer() public {
        // Approve issuer
        vm.prank(alice);
        gov.proposeIssuer(ISSUER_DID);
        vm.prank(alice);
        gov.castVote(1, true);
        uint256 afterVoting = block.timestamp + 1 days + 1;
        vm.warp(afterVoting);
        gov.queueProposal(1);
        vm.warp(afterVoting + 24 hours + 1);
        vm.prank(admin);
        gov.executeProposal(1);

        vm.prank(admin);
        gov.removeIssuer(ISSUER_DID);

        assertFalse(gov.isApprovedIssuer(ISSUER_DID));
    }

    // ════════════════════════════════════════════════════════════════
    // Governance Parameters
    // ════════════════════════════════════════════════════════════════

    function test_SetVotingPeriod() public {
        vm.prank(admin);
        vm.expectEmit(false, false, false, true);
        emit GovernanceModule.VotingPeriodUpdated(1 days, 7 days);
        gov.setVotingPeriod(7 days);

        assertEq(gov.votingPeriod(), 7 days);
    }

    function test_SetVotingPeriod_RevertsInvalid() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(GovernanceModule.InvalidVotingPeriod.selector, uint64(1 hours)));
        gov.setVotingPeriod(1 hours);
    }

    function test_SetQuorum() public {
        vm.prank(admin);
        vm.expectEmit(false, false, false, true);
        emit GovernanceModule.QuorumUpdated(1, 5);
        gov.setQuorum(5);

        assertEq(gov.quorumRequired(), 5);
    }

    function test_SetQuorum_RevertsZero() public {
        vm.prank(admin);
        vm.expectRevert("Zero quorum");
        gov.setQuorum(0);
    }

    // ════════════════════════════════════════════════════════════════
    // Proposal Queries
    // ════════════════════════════════════════════════════════════════

    function test_GetProposal() public {
        _createSchemaProposal();

        (
            address proposer,
            GovernanceModule.ProposalType pType,
            bytes32 targetHash,
            , , , , ,
        ) = gov.getProposal(1);

        assertEq(proposer, alice);
        assertEq(uint8(pType), uint8(GovernanceModule.ProposalType.Schema));
        assertEq(targetHash, SCHEMA_HASH);
    }

    function test_HasVoted() public {
        _createSchemaProposal();

        assertFalse(gov.hasVoted(1, alice));

        vm.prank(alice);
        gov.castVote(1, true);

        assertTrue(gov.hasVoted(1, alice));
    }

    // ════════════════════════════════════════════════════════════════
    // Pause
    // ════════════════════════════════════════════════════════════════

    function test_Pause_BlocksProposals() public {
        vm.prank(admin);
        gov.pause();

        bytes32[] memory attrs = new bytes32[](1);
        attrs[0] = keccak256("a");

        vm.prank(alice);
        vm.expectRevert();
        gov.proposeSchema(SCHEMA_HASH, "Test", attrs);
    }

    // ════════════════════════════════════════════════════════════════
    // Helpers
    // ════════════════════════════════════════════════════════════════

    function _createSchemaProposal() internal {
        bytes32[] memory attrs = new bytes32[](2);
        attrs[0] = keccak256("attr:name");
        attrs[1] = keccak256("attr:dob");

        vm.prank(alice);
        gov.proposeSchema(SCHEMA_HASH, "KYC Schema", attrs);
    }

    function _createAndExecuteSchemaProposal() internal {
        _createSchemaProposal();
        vm.prank(alice);
        gov.castVote(1, true);
        uint256 afterVoting = block.timestamp + 1 days + 1;
        vm.warp(afterVoting);
        gov.queueProposal(1);
        vm.warp(afterVoting + 24 hours + 1);
        vm.prank(admin);
        gov.executeProposal(1);
    }
}
