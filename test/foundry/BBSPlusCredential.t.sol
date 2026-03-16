// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";

contract BBSPlusCredentialTest is TestHelper {
    BBSPlusCredential public bbs;

    bytes32 constant ISSUER_ID = keccak256("issuer:bbs:1");
    bytes32 constant DOMAIN_TAG = keccak256("domain:zeroid:kyc");
    bytes32 constant ACC_ID = keccak256("acc:bbs:1");

    function setUp() public {
        bbs = new BBSPlusCredential(admin);
    }

    function _g1() internal pure returns (BN254.G1Point memory) {
        return BN254.G1Point(1, 2);
    }

    function _g2() internal pure returns (BN254.G2Point memory) {
        return BN254.G2Point(
            [uint256(10857046999023057135944570762232829481370756359578518086990519993285655852781),
             uint256(11559732032986387107991004021392285783925812861821192530917403151452391805634)],
            [uint256(8495653923123431417604973247489272438418190587263600148770280649306958101930),
             uint256(4082367875863433681332203403145435568316851327593401208105741076214120093531)]
        );
    }

    function _registerKey() internal {
        BN254.G1Point[] memory h = new BN254.G1Point[](3);
        h[0] = _g1();
        h[1] = _g1();
        h[2] = _g1();

        vm.prank(admin);
        bbs.registerIssuerKey(ISSUER_ID, _g2(), _g1(), h, DOMAIN_TAG);
    }

    // ════════════════════════════════════════════════════════════════
    // Deployment
    // ════════════════════════════════════════════════════════════════

    function test_Constructor_SetsRoles() public view {
        assertTrue(bbs.hasRole(bbs.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(bbs.hasRole(bbs.ISSUER_ROLE(), admin));
        assertTrue(bbs.hasRole(bbs.ACCUMULATOR_MANAGER_ROLE(), admin));
    }

    function test_InitialState() public view {
        assertEq(bbs.totalCredentialsIssued(), 0);
        assertEq(bbs.totalProofsVerified(), 0);
    }

    // ════════════════════════════════════════════════════════════════
    // Issuer Key Management
    // ════════════════════════════════════════════════════════════════

    function test_RegisterIssuerKey_Success() public {
        BN254.G1Point[] memory h = new BN254.G1Point[](3);
        h[0] = _g1();
        h[1] = _g1();
        h[2] = _g1();

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit BBSPlusCredential.IssuerKeyRegistered(ISSUER_ID, 3, DOMAIN_TAG);
        bbs.registerIssuerKey(ISSUER_ID, _g2(), _g1(), h, DOMAIN_TAG);

        (uint256 maxMessages, bytes32 domainTag, bool active, uint256 registeredAt) = bbs.getIssuerKeyInfo(ISSUER_ID);
        assertEq(maxMessages, 3);
        assertEq(domainTag, DOMAIN_TAG);
        assertTrue(active);
        assertGt(registeredAt, 0);
    }

    function test_RegisterIssuerKey_RevertsEmptyH() public {
        BN254.G1Point[] memory h = new BN254.G1Point[](0);

        vm.prank(admin);
        vm.expectRevert(BBSPlusCredential.InvalidPublicKeyLength.selector);
        bbs.registerIssuerKey(ISSUER_ID, _g2(), _g1(), h, DOMAIN_TAG);
    }

    function test_RegisterIssuerKey_RevertsDuplicate() public {
        _registerKey();

        BN254.G1Point[] memory h = new BN254.G1Point[](1);
        h[0] = _g1();

        vm.prank(admin);
        vm.expectRevert(BBSPlusCredential.PublicKeyAlreadyRegistered.selector);
        bbs.registerIssuerKey(ISSUER_ID, _g2(), _g1(), h, DOMAIN_TAG);
    }

    function test_RegisterIssuerKey_RevertsInvalidDomainTag() public {
        BN254.G1Point[] memory h = new BN254.G1Point[](1);
        h[0] = _g1();

        vm.prank(admin);
        vm.expectRevert(BBSPlusCredential.InvalidDomainTag.selector);
        bbs.registerIssuerKey(ISSUER_ID, _g2(), _g1(), h, bytes32(0));
    }

    function test_RevokeIssuerKey() public {
        _registerKey();

        vm.prank(admin);
        vm.expectEmit(true, false, false, false);
        emit BBSPlusCredential.IssuerKeyRevoked(ISSUER_ID);
        bbs.revokeIssuerKey(ISSUER_ID);

        (, , bool active, ) = bbs.getIssuerKeyInfo(ISSUER_ID);
        assertFalse(active);
    }

    function test_RevokeIssuerKey_RevertsNotRegistered() public {
        vm.prank(admin);
        vm.expectRevert(BBSPlusCredential.PublicKeyNotRegistered.selector);
        bbs.revokeIssuerKey(keccak256("nonexistent"));
    }

    // ════════════════════════════════════════════════════════════════
    // Domain Registration
    // ════════════════════════════════════════════════════════════════

    function test_IsDomainRegistered() public {
        _registerKey();
        assertTrue(bbs.isDomainRegistered(DOMAIN_TAG));
        assertFalse(bbs.isDomainRegistered(keccak256("unknown")));
    }

    // ════════════════════════════════════════════════════════════════
    // Accumulator
    // ════════════════════════════════════════════════════════════════

    function test_InitializeAccumulator_Success() public {
        bytes32 initialRoot = keccak256("acc_root_initial");

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit BBSPlusCredential.AccumulatorUpdated(ACC_ID, initialRoot, 1, 0);
        bbs.initializeAccumulator(ACC_ID, initialRoot);

        BBSPlusCredential.AccumulatorState memory state = bbs.getAccumulatorState(ACC_ID);
        assertTrue(state.initialized);
        assertEq(state.root, initialRoot);
        assertEq(state.epoch, 1);
    }

    function test_InitializeAccumulator_RevertsDuplicate() public {
        vm.prank(admin);
        bbs.initializeAccumulator(ACC_ID, keccak256("root"));

        vm.prank(admin);
        vm.expectRevert(BBSPlusCredential.InvalidAccumulatorUpdate.selector);
        bbs.initializeAccumulator(ACC_ID, keccak256("root2"));
    }

    function test_UpdateAccumulator_Success() public {
        bytes32 root1 = keccak256("root1");
        vm.prank(admin);
        bbs.initializeAccumulator(ACC_ID, root1);

        bytes32 root2 = keccak256("root2");
        uint256 revokedCount = 5;
        uint256 currentEpoch = 1;

        // Build valid proof: raw preimage whose keccak256 == keccak256(abi.encodePacked(oldRoot, newRoot, revokedCount, epoch))
        bytes memory proof = abi.encodePacked(root1, root2, revokedCount, currentEpoch);

        vm.prank(admin);
        bbs.updateAccumulator(ACC_ID, root2, revokedCount, proof);

        BBSPlusCredential.AccumulatorState memory state = bbs.getAccumulatorState(ACC_ID);
        assertEq(state.root, root2);
        assertEq(state.epoch, 2);
        assertEq(state.revokedCount, 5);
    }

    function test_UpdateAccumulator_RevertsNotInitialized() public {
        vm.prank(admin);
        vm.expectRevert(BBSPlusCredential.AccumulatorNotInitialized.selector);
        bbs.updateAccumulator(ACC_ID, keccak256("r"), 1, "");
    }

    function test_GetHistoricalRoot() public {
        bytes32 root1 = keccak256("root1");
        vm.prank(admin);
        bbs.initializeAccumulator(ACC_ID, root1);

        assertEq(bbs.getHistoricalRoot(ACC_ID, 1), root1);
        assertEq(bbs.getHistoricalRoot(ACC_ID, 0), bytes32(0));
    }

    // ════════════════════════════════════════════════════════════════
    // Credential Issuance Check
    // ════════════════════════════════════════════════════════════════

    function test_IsCredentialIssued_FalseInitially() public view {
        assertFalse(bbs.isCredentialIssued(keccak256("c1")));
    }

    // ════════════════════════════════════════════════════════════════
    // Pause
    // ════════════════════════════════════════════════════════════════

    function test_Pause_Unpause() public {
        vm.prank(admin);
        bbs.pause();

        BN254.G1Point[] memory h = new BN254.G1Point[](1);
        h[0] = _g1();

        vm.prank(admin);
        vm.expectRevert();
        bbs.registerIssuerKey(ISSUER_ID, _g2(), _g1(), h, DOMAIN_TAG);

        vm.prank(admin);
        bbs.unpause();
    }

    function test_Pause_RevertsWithoutRole() public {
        vm.prank(alice);
        vm.expectRevert();
        bbs.pause();
    }
}
