// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";

contract ThresholdCredentialTest is TestHelper {
    ThresholdCredential public tc;

    bytes32 constant CONFIG_ID = keccak256("config:threshold:1");
    bytes32 constant CONFIG_ID_2 = keccak256("config:threshold:2");
    bytes32 constant CRED_HASH = keccak256("cred:threshold:1");

    function setUp() public {
        tc = new ThresholdCredential(admin);
    }

    function _g1() internal pure returns (BN254.G1Point memory) {
        return BN254.G1Point(1, 2);
    }

    function _g2() internal pure returns (BN254.G2Point memory) {
        return BN254.g2Generator();
    }

    function _createConfig() internal {
        vm.prank(admin);
        tc.createConfig(CONFIG_ID, 2, 3, _g1());
    }

    function _createConfig2() internal {
        vm.prank(admin);
        tc.createConfig(CONFIG_ID_2, 2, 3, _g1());
    }

    // ════════════════════════════════════════════════════════════════
    // Deployment
    // ════════════════════════════════════════════════════════════════

    function test_Constructor_SetsRoles() public view {
        assertTrue(tc.hasRole(tc.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(tc.hasRole(tc.CONFIG_MANAGER_ROLE(), admin));
    }

    function test_InitialState() public view {
        assertEq(tc.totalCredentialsIssued(), 0);
    }

    function test_Constants() public view {
        assertEq(tc.REQUEST_DEFAULT_TTL(), 24 hours);
        assertEq(tc.KEY_ROTATION_WINDOW(), 7 days);
        assertEq(tc.RECOVERY_COOLDOWN(), 48 hours);
        assertEq(tc.MAX_SIGNERS(), 100);
    }

    // ════════════════════════════════════════════════════════════════
    // Configuration
    // ════════════════════════════════════════════════════════════════

    function test_CreateConfig_Success() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit ThresholdCredential.ThresholdConfigCreated(CONFIG_ID, 2, 3, block.timestamp);
        tc.createConfig(CONFIG_ID, 2, 3, _g1());

        (uint256 threshold, uint256 totalSigners, bool active, uint256 createdAt) = tc.getConfig(CONFIG_ID);
        assertEq(threshold, 2);
        assertEq(totalSigners, 3);
        assertTrue(active);
        assertGt(createdAt, 0);
    }

    function test_CreateConfig_RevertsInvalidThreshold_Zero() public {
        vm.prank(admin);
        vm.expectRevert(ThresholdCredential.InvalidThreshold.selector);
        tc.createConfig(CONFIG_ID, 0, 3, _g1());
    }

    function test_CreateConfig_RevertsInvalidThreshold_TGreaterThanN() public {
        vm.prank(admin);
        vm.expectRevert(ThresholdCredential.InvalidThreshold.selector);
        tc.createConfig(CONFIG_ID, 5, 3, _g1());
    }

    function test_CreateConfig_RevertsInvalidThreshold_TooManySigners() public {
        vm.prank(admin);
        vm.expectRevert(ThresholdCredential.InvalidThreshold.selector);
        tc.createConfig(CONFIG_ID, 2, 101, _g1());
    }

    function test_CreateConfig_RevertsDuplicate() public {
        _createConfig();

        vm.prank(admin);
        vm.expectRevert(ThresholdCredential.ConfigurationAlreadyExists.selector);
        tc.createConfig(CONFIG_ID, 2, 3, _g1());
    }

    // ════════════════════════════════════════════════════════════════
    // Signer Registration
    // ════════════════════════════════════════════════════════════════

    function test_RegisterSigner_Success() public {
        _createConfig();

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit ThresholdCredential.SignerRegistered(CONFIG_ID, alice, 1, block.timestamp);
        tc.registerSigner(CONFIG_ID, alice, 1, _g1(), _g2());

        (address signerAddr, bool active, ) = tc.getSigner(CONFIG_ID, 1);
        assertEq(signerAddr, alice);
        assertTrue(active);
        assertTrue(tc.hasRole(tc.SIGNER_ROLE(), alice));
    }

    function test_RegisterSigner_RevertsInvalidIndex_Zero() public {
        _createConfig();

        vm.prank(admin);
        vm.expectRevert(ThresholdCredential.InvalidSignerIndex.selector);
        tc.registerSigner(CONFIG_ID, alice, 0, _g1(), _g2());
    }

    function test_RegisterSigner_RevertsInvalidIndex_TooHigh() public {
        _createConfig();

        vm.prank(admin);
        vm.expectRevert(ThresholdCredential.InvalidSignerIndex.selector);
        tc.registerSigner(CONFIG_ID, alice, 4, _g1(), _g2()); // n=3, so max index is 3
    }

    function test_RegisterSigner_RevertsDuplicate() public {
        _createConfig();

        vm.prank(admin);
        tc.registerSigner(CONFIG_ID, alice, 1, _g1(), _g2());

        vm.prank(admin);
        vm.expectRevert(ThresholdCredential.SignerAlreadyRegistered.selector);
        tc.registerSigner(CONFIG_ID, bob, 1, _g1(), _g2());
    }

    function test_RegisterSigner_RevertsConfigNotFound() public {
        vm.prank(admin);
        vm.expectRevert(ThresholdCredential.ConfigurationNotFound.selector);
        tc.registerSigner(keccak256("nonexistent"), alice, 1, _g1(), _g2());
    }

    // ════════════════════════════════════════════════════════════════
    // Credential Request
    // ════════════════════════════════════════════════════════════════

    function test_RequestCredential_Success() public {
        _createConfig();

        uint256[] memory msgs = new uint256[](2);
        msgs[0] = 123;
        msgs[1] = 456;

        vm.prank(alice);
        bytes32 requestId = tc.requestCredential(CONFIG_ID, CRED_HASH, msgs, 0);

        (bytes32 configId, bytes32 credHash, uint256 partialSigCount, bool finalized, uint256 expiresAt) = tc.getRequestStatus(requestId);
        assertEq(configId, CONFIG_ID);
        assertEq(credHash, CRED_HASH);
        assertEq(partialSigCount, 0);
        assertFalse(finalized);
        assertGt(expiresAt, block.timestamp);
    }

    function test_RequestCredential_RevertsConfigNotActive() public {
        vm.prank(alice);
        vm.expectRevert(ThresholdCredential.ConfigurationNotActive.selector);
        tc.requestCredential(keccak256("bad"), CRED_HASH, new uint256[](0), 0);
    }

    // ════════════════════════════════════════════════════════════════
    // Key Rotation
    // ════════════════════════════════════════════════════════════════

    function test_KeyRotation_Lifecycle() public {
        _createConfig();
        _createConfig2();

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit ThresholdCredential.KeyRotationInitiated(CONFIG_ID, CONFIG_ID_2, block.timestamp);
        tc.initiateKeyRotation(CONFIG_ID, CONFIG_ID_2);

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit ThresholdCredential.KeyRotationCompleted(CONFIG_ID, CONFIG_ID_2, block.timestamp);
        tc.completeKeyRotation(CONFIG_ID);

        // Old config should be inactive
        (, , bool active, ) = tc.getConfig(CONFIG_ID);
        assertFalse(active);
    }

    function test_InitiateKeyRotation_RevertsConfigNotActive() public {
        _createConfig();

        vm.prank(admin);
        vm.expectRevert(ThresholdCredential.ConfigurationNotFound.selector);
        tc.initiateKeyRotation(CONFIG_ID, keccak256("nonexistent"));
    }

    function test_InitiateKeyRotation_RevertsAlreadyInProgress() public {
        _createConfig();
        _createConfig2();

        vm.prank(admin);
        tc.initiateKeyRotation(CONFIG_ID, CONFIG_ID_2);

        bytes32 config3 = keccak256("config3");
        vm.prank(admin);
        tc.createConfig(config3, 2, 3, _g1());

        vm.prank(admin);
        vm.expectRevert(ThresholdCredential.KeyRotationInProgress.selector);
        tc.initiateKeyRotation(CONFIG_ID, config3);
    }

    function test_CompleteKeyRotation_RevertsNotInProgress() public {
        _createConfig();

        vm.prank(admin);
        vm.expectRevert(ThresholdCredential.KeyRotationNotInProgress.selector);
        tc.completeKeyRotation(CONFIG_ID);
    }

    // ════════════════════════════════════════════════════════════════
    // Emergency Recovery
    // ════════════════════════════════════════════════════════════════

    function test_EmergencyRecovery_Lifecycle() public {
        _createConfig();
        _createConfig2();

        // Grant guardian role
        bytes32 guardianRole = tc.GUARDIAN_ROLE();
        vm.prank(admin);
        tc.grantRole(guardianRole, alice);
        vm.prank(admin);
        tc.grantRole(guardianRole, bob);

        // Initiate recovery
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit ThresholdCredential.EmergencyRecoveryInitiated(CONFIG_ID, alice, block.timestamp);
        tc.initiateEmergencyRecovery(CONFIG_ID, CONFIG_ID_2);

        // Second guardian approves
        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit ThresholdCredential.GuardianApproval(CONFIG_ID, bob, 2);
        tc.approveRecovery(CONFIG_ID);

        // Wait for cooldown
        vm.warp(block.timestamp + 48 hours + 1);

        // Execute recovery
        vm.prank(alice);
        tc.executeRecovery(CONFIG_ID, 2);

        (, , bool active, ) = tc.getConfig(CONFIG_ID);
        assertFalse(active);
    }

    function test_EmergencyRecovery_RevertsAlreadyInitiated() public {
        _createConfig();
        _createConfig2();

        bytes32 guardianRole = tc.GUARDIAN_ROLE();
        vm.prank(admin);
        tc.grantRole(guardianRole, alice);

        vm.prank(alice);
        tc.initiateEmergencyRecovery(CONFIG_ID, CONFIG_ID_2);

        vm.prank(alice);
        vm.expectRevert(ThresholdCredential.RecoveryAlreadyInitiated.selector);
        tc.initiateEmergencyRecovery(CONFIG_ID, CONFIG_ID_2);
    }

    function test_ExecuteRecovery_RevertsCooldownActive() public {
        _createConfig();
        _createConfig2();

        bytes32 guardianRole = tc.GUARDIAN_ROLE();
        vm.prank(admin);
        tc.grantRole(guardianRole, alice);

        vm.prank(alice);
        tc.initiateEmergencyRecovery(CONFIG_ID, CONFIG_ID_2);

        vm.prank(alice);
        vm.expectRevert(ThresholdCredential.RecoveryCooldownActive.selector);
        tc.executeRecovery(CONFIG_ID, 1);
    }

    // ════════════════════════════════════════════════════════════════
    // Pause
    // ════════════════════════════════════════════════════════════════

    function test_Pause_Unpause() public {
        vm.prank(admin);
        tc.pause();

        vm.prank(admin);
        vm.expectRevert();
        tc.createConfig(CONFIG_ID, 2, 3, _g1());

        vm.prank(admin);
        tc.unpause();

        vm.prank(admin);
        tc.createConfig(CONFIG_ID, 2, 3, _g1());
    }

    // ════════════════════════════════════════════════════════════════
    // ZID-009: G2 Key Registration
    // ════════════════════════════════════════════════════════════════

    function test_RegisterSigner_RevertsZeroG2Key() public {
        _createConfig();

        BN254.G2Point memory zeroG2 = BN254.G2Point([uint256(0), uint256(0)], [uint256(0), uint256(0)]);

        vm.prank(admin);
        vm.expectRevert("G2 key must not be zero");
        tc.registerSigner(CONFIG_ID, alice, 1, _g1(), zeroG2);
    }

    function test_RegisterSigner_WithG2Key_Success() public {
        _createConfig();

        vm.prank(admin);
        tc.registerSigner(CONFIG_ID, alice, 1, _g1(), _g2());

        (address signerAddr, bool active, ) = tc.getSigner(CONFIG_ID, 1);
        assertEq(signerAddr, alice);
        assertTrue(active);
    }
}
