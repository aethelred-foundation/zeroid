// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";

contract CredentialRegistryTest is TestHelper {
    ZeroID public zeroid;
    CredentialRegistry public registry;
    GovernanceModule public governance;

    bytes32 constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    function setUp() public {
        zeroid = new ZeroID(admin);
        governance = new GovernanceModule(admin, 1 days, 1);
        registry = new CredentialRegistry(admin, address(zeroid), address(governance));

        // Register issuer identity (alice) — she needs a DID for resolveByController
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        // Register subject identity (bob)
        vm.prank(bob);
        zeroid.registerIdentity(DID_HASH_2, keccak256(abi.encodePacked(bytes32(keccak256("r2")))));

        // Grant ISSUER_ROLE to alice
        vm.prank(admin);
        registry.grantRole(ISSUER_ROLE, alice);

        _approveGovernanceSchema(SCHEMA_HASH_1);
        _approveGovernanceIssuer(DID_HASH_1);

        // Approve a schema
        vm.prank(admin);
        registry.approveSchema(SCHEMA_HASH_1);

    }

    // ════════════════════════════════════════════════════════════════
    // Deployment
    // ════════════════════════════════════════════════════════════════

    function test_Constructor_SetsRegistry() public view {
        assertEq(address(registry.identityRegistry()), address(zeroid));
        assertEq(address(registry.governanceModule()), address(governance));
    }

    function test_Constructor_RevertsZeroAdmin() public {
        vm.expectRevert("Zero admin");
        new CredentialRegistry(address(0), address(zeroid), address(governance));
    }

    function test_Constructor_RevertsZeroRegistry() public {
        vm.expectRevert("Zero registry");
        new CredentialRegistry(admin, address(0), address(governance));
    }

    function test_Constructor_RevertsZeroGovernance() public {
        vm.expectRevert("Zero governance");
        new CredentialRegistry(admin, address(zeroid), address(0));
    }

    // ════════════════════════════════════════════════════════════════
    // Schema Management
    // ════════════════════════════════════════════════════════════════

    function test_ApproveSchema() public {
        bytes32 schema2 = keccak256("schema:v2");
        vm.prank(admin);
        vm.expectEmit(true, false, false, false);
        emit CredentialRegistry.SchemaApproved(schema2);
        registry.approveSchema(schema2);

        assertTrue(registry.isSchemaApproved(schema2));
    }

    function test_RevokeSchema() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, false);
        emit CredentialRegistry.SchemaRevoked(SCHEMA_HASH_1);
        registry.revokeSchema(SCHEMA_HASH_1);

        assertFalse(registry.isSchemaApproved(SCHEMA_HASH_1));
    }

    function test_ApproveSchema_RevertsZero() public {
        vm.prank(admin);
        vm.expectRevert("Zero schema");
        registry.approveSchema(bytes32(0));
    }

    // ════════════════════════════════════════════════════════════════
    // Credential Issuance
    // ════════════════════════════════════════════════════════════════

    function test_IssueCredential_Success() public {
        uint64 expiry = uint64(block.timestamp + 365 days);

        vm.prank(alice);
        vm.expectEmit(true, true, true, false);
        emit ICredentialRegistry.CredentialIssued(CREDENTIAL_HASH_1, DID_HASH_1, DID_HASH_2);
        registry.issueCredential(CREDENTIAL_HASH_1, SCHEMA_HASH_1, DID_HASH_2, expiry, MERKLE_ROOT_1);

        assertTrue(registry.isCredentialValid(CREDENTIAL_HASH_1));
        assertEq(registry.totalCredentialsIssued(), 1);
    }

    function test_IssueCredential_RevertsDuplicate() public {
        uint64 expiry = uint64(block.timestamp + 365 days);
        vm.prank(alice);
        registry.issueCredential(CREDENTIAL_HASH_1, SCHEMA_HASH_1, DID_HASH_2, expiry, MERKLE_ROOT_1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CredentialRegistry.CredentialAlreadyExists.selector, CREDENTIAL_HASH_1));
        registry.issueCredential(CREDENTIAL_HASH_1, SCHEMA_HASH_1, DID_HASH_2, expiry, MERKLE_ROOT_1);
    }

    function test_IssueCredential_RevertsSchemaNotApproved() public {
        bytes32 badSchema = keccak256("bad_schema");
        uint64 expiry = uint64(block.timestamp + 365 days);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CredentialRegistry.SchemaNotApproved.selector, badSchema));
        registry.issueCredential(CREDENTIAL_HASH_1, badSchema, DID_HASH_2, expiry, MERKLE_ROOT_1);
    }

    function test_IssueCredential_RevertsSchemaWithoutGovernanceApproval() public {
        bytes32 localOnlySchema = keccak256("schema:local-only");
        uint64 expiry = uint64(block.timestamp + 365 days);

        vm.prank(admin);
        registry.approveSchema(localOnlySchema);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CredentialRegistry.SchemaNotApproved.selector, localOnlySchema));
        registry.issueCredential(CREDENTIAL_HASH_1, localOnlySchema, DID_HASH_2, expiry, MERKLE_ROOT_1);
    }

    function test_IssueCredential_RevertsSubjectNotActive() public {
        bytes32 inactiveDid = keccak256("did:zeroid:inactive");
        uint64 expiry = uint64(block.timestamp + 365 days);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CredentialRegistry.SubjectIdentityNotActive.selector, inactiveDid));
        registry.issueCredential(CREDENTIAL_HASH_1, SCHEMA_HASH_1, inactiveDid, expiry, MERKLE_ROOT_1);
    }

    function test_IssueCredential_RevertsInvalidExpiry_Past() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.issueCredential(CREDENTIAL_HASH_1, SCHEMA_HASH_1, DID_HASH_2, uint64(block.timestamp - 1), MERKLE_ROOT_1);
    }

    function test_IssueCredential_RevertsWithoutIssuerRole() public {
        uint64 expiry = uint64(block.timestamp + 365 days);
        vm.prank(bob);
        vm.expectRevert();
        registry.issueCredential(CREDENTIAL_HASH_1, SCHEMA_HASH_1, DID_HASH_2, expiry, MERKLE_ROOT_1);
    }

    function test_IssueCredential_RevertsIssuerRoleWithoutActiveDid() public {
        address unboundIssuer = carol;
        uint64 expiry = uint64(block.timestamp + 365 days);

        vm.prank(admin);
        registry.grantRole(ISSUER_ROLE, unboundIssuer);

        vm.prank(unboundIssuer);
        vm.expectRevert(abi.encodeWithSelector(CredentialRegistry.IssuerIdentityNotActive.selector, bytes32(0)));
        registry.issueCredential(CREDENTIAL_HASH_1, SCHEMA_HASH_1, DID_HASH_2, expiry, MERKLE_ROOT_1);
    }

    function test_IssueCredential_RevertsIssuerWithoutGovernanceApproval() public {
        uint64 expiry = uint64(block.timestamp + 365 days);

        vm.prank(carol);
        zeroid.registerIdentity(DID_HASH_3, keccak256("recovery:carol"));

        vm.prank(admin);
        registry.grantRole(ISSUER_ROLE, carol);

        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(CredentialRegistry.IssuerNotApproved.selector, DID_HASH_3));
        registry.issueCredential(CREDENTIAL_HASH_2, SCHEMA_HASH_1, DID_HASH_2, expiry, MERKLE_ROOT_1);
    }

    // ════════════════════════════════════════════════════════════════
    // Credential Lifecycle
    // ════════════════════════════════════════════════════════════════

    function _issueTestCredential() internal {
        uint64 expiry = uint64(block.timestamp + 365 days);
        vm.prank(alice);
        registry.issueCredential(CREDENTIAL_HASH_1, SCHEMA_HASH_1, DID_HASH_2, expiry, MERKLE_ROOT_1);
    }

    function test_RevokeCredential() public {
        _issueTestCredential();

        vm.prank(alice);
        registry.revokeCredential(CREDENTIAL_HASH_1);

        assertFalse(registry.isCredentialValid(CREDENTIAL_HASH_1));
        assertEq(registry.totalRevoked(), 1);
    }

    function test_RevokeCredential_RevertsAlreadyRevoked() public {
        _issueTestCredential();

        vm.prank(alice);
        registry.revokeCredential(CREDENTIAL_HASH_1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CredentialRegistry.CredentialAlreadyRevoked.selector, CREDENTIAL_HASH_1));
        registry.revokeCredential(CREDENTIAL_HASH_1);
    }

    function test_SuspendCredential() public {
        _issueTestCredential();

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit ICredentialRegistry.CredentialSuspended(CREDENTIAL_HASH_1, DID_HASH_1, uint64(block.timestamp));
        registry.suspendCredential(CREDENTIAL_HASH_1);

        assertFalse(registry.isCredentialValid(CREDENTIAL_HASH_1));
    }

    function test_SuspendCredential_RevertsIfNotActive() public {
        _issueTestCredential();

        vm.prank(alice);
        registry.suspendCredential(CREDENTIAL_HASH_1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            CredentialRegistry.InvalidTransition.selector,
            CredentialStatus.Suspended,
            CredentialStatus.Suspended
        ));
        registry.suspendCredential(CREDENTIAL_HASH_1);
    }

    function test_ReinstateCredential() public {
        _issueTestCredential();

        vm.prank(alice);
        registry.suspendCredential(CREDENTIAL_HASH_1);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit ICredentialRegistry.CredentialReinstated(CREDENTIAL_HASH_1, DID_HASH_1, uint64(block.timestamp));
        registry.reinstateCredential(CREDENTIAL_HASH_1);

        assertTrue(registry.isCredentialValid(CREDENTIAL_HASH_1));
    }

    function test_ReinstateCredential_RevertsIfNotSuspended() public {
        _issueTestCredential();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            CredentialRegistry.InvalidTransition.selector,
            CredentialStatus.Active,
            CredentialStatus.Active
        ));
        registry.reinstateCredential(CREDENTIAL_HASH_1);
    }

    // ════════════════════════════════════════════════════════════════
    // Credential Queries
    // ════════════════════════════════════════════════════════════════

    function test_GetCredential() public {
        _issueTestCredential();

        Credential memory cred = registry.getCredential(CREDENTIAL_HASH_1);
        assertEq(cred.credentialHash, CREDENTIAL_HASH_1);
        assertEq(cred.schemaHash, SCHEMA_HASH_1);
        assertEq(cred.subjectDid, DID_HASH_2);
        assertEq(cred.merkleRoot, MERKLE_ROOT_1);
    }

    function test_GetCredential_RevertsNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(CredentialRegistry.CredentialNotFound.selector, CREDENTIAL_HASH_1));
        registry.getCredential(CREDENTIAL_HASH_1);
    }

    function test_IsCredentialValid_FalseWhenExpired() public {
        _issueTestCredential();

        vm.warp(block.timestamp + 366 days);
        assertFalse(registry.isCredentialValid(CREDENTIAL_HASH_1));
    }

    function test_IsCredentialValid_FalseForNonexistent() public view {
        assertFalse(registry.isCredentialValid(keccak256("nonexistent")));
    }

    function test_GetIssuerCredentials() public {
        _issueTestCredential();

        bytes32[] memory creds = registry.getIssuerCredentials(DID_HASH_1);
        assertEq(creds.length, 1);
        assertEq(creds[0], CREDENTIAL_HASH_1);
    }

    function test_GetSubjectCredentials() public {
        _issueTestCredential();

        bytes32[] memory creds = registry.getSubjectCredentials(DID_HASH_2);
        assertEq(creds.length, 1);
        assertEq(creds[0], CREDENTIAL_HASH_1);
    }

    function test_BatchCheckValidity() public {
        _issueTestCredential();

        bytes32[] memory hashes = new bytes32[](2);
        hashes[0] = CREDENTIAL_HASH_1;
        hashes[1] = keccak256("nonexistent");

        bool[] memory results = registry.batchCheckValidity(hashes);
        assertTrue(results[0]);
        assertFalse(results[1]);
    }

    // ════════════════════════════════════════════════════════════════
    // Revocation Bitmap
    // ════════════════════════════════════════════════════════════════

    function test_IsRevokedInBitmap_AfterRevoke() public {
        _issueTestCredential();

        assertFalse(registry.isRevokedInBitmap(CREDENTIAL_HASH_1));

        vm.prank(alice);
        registry.revokeCredential(CREDENTIAL_HASH_1);

        assertTrue(registry.isRevokedInBitmap(CREDENTIAL_HASH_1));
    }

    function test_AdvanceRevocationEpoch() public {
        uint256 currentEpoch = registry.currentRevocationEpoch();

        vm.prank(admin);
        vm.expectEmit(false, false, false, true);
        emit CredentialRegistry.RevocationEpochAdvanced(currentEpoch, currentEpoch + 1);
        registry.advanceRevocationEpoch();

        assertEq(registry.currentRevocationEpoch(), currentEpoch + 1);
    }

    // ════════════════════════════════════════════════════════════════
    // Pause
    // ════════════════════════════════════════════════════════════════

    function test_Pause_BlocksIssuance() public {
        vm.prank(admin);
        registry.pause();

        uint64 expiry = uint64(block.timestamp + 365 days);
        vm.prank(alice);
        vm.expectRevert();
        registry.issueCredential(CREDENTIAL_HASH_1, SCHEMA_HASH_1, DID_HASH_2, expiry, MERKLE_ROOT_1);
    }

    function _approveGovernanceSchema(bytes32 schemaHash) internal {
        bytes32[] memory attrs = new bytes32[](1);
        attrs[0] = keccak256("attr:registry-test");

        vm.prank(admin);
        uint256 proposalId = governance.proposeSchema(schemaHash, "Registry Test Schema", attrs);
        _passAndExecuteGovernanceProposal(proposalId);
    }

    function _approveGovernanceIssuer(bytes32 issuerDid) internal {
        vm.prank(admin);
        uint256 proposalId = governance.proposeIssuer(issuerDid);
        _passAndExecuteGovernanceProposal(proposalId);
    }

    function _passAndExecuteGovernanceProposal(uint256 proposalId) internal {
        vm.prank(admin);
        governance.castVote(proposalId, true);

        vm.warp(block.timestamp + governance.votingPeriod() + 1);
        governance.queueProposal(proposalId);

        vm.warp(block.timestamp + governance.EXECUTION_TIMELOCK() + 1);
        vm.prank(admin);
        governance.executeProposal(proposalId);
    }
}
