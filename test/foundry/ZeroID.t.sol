// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";

contract ZeroIDTest is TestHelper {
    ZeroID public zeroid;

    function setUp() public {
        zeroid = new ZeroID(admin);
    }

    // ════════════════════════════════════════════════════════════════
    // Deployment & Initialisation
    // ════════════════════════════════════════════════════════════════

    function test_Constructor_SetsRoles() public view {
        assertTrue(zeroid.hasRole(zeroid.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(zeroid.hasRole(zeroid.ADMIN_ROLE(), admin));
        assertTrue(zeroid.hasRole(zeroid.GOVERNANCE_ROLE(), admin));
    }

    function test_Constructor_RevertsZeroAddress() public {
        vm.expectRevert(ZeroID.ZeroAddress.selector);
        new ZeroID(address(0));
    }

    function test_InitialTotalIdentities() public view {
        assertEq(zeroid.totalIdentities(), 0);
    }

    function test_Constants() public view {
        assertEq(zeroid.RECOVERY_TIMELOCK(), 48 hours);
        assertEq(zeroid.MAX_AUTH_KEYS(), 16);
        assertEq(zeroid.MAX_BATCH_SIZE(), 50);
    }

    // ════════════════════════════════════════════════════════════════
    // Identity Registration
    // ════════════════════════════════════════════════════════════════

    function test_RegisterIdentity_Success() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit IIdentityRegistry.IdentityRegistered(DID_HASH_1, alice, uint64(block.timestamp));
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        assertEq(zeroid.totalIdentities(), 1);
        assertTrue(zeroid.isActiveIdentity(DID_HASH_1));
    }

    function test_RegisterIdentity_ResolvesCorrectly() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        Identity memory id = zeroid.resolveIdentity(DID_HASH_1);
        assertEq(id.didHash, DID_HASH_1);
        assertEq(id.controller, alice);
        assertEq(uint8(id.status), uint8(IdentityStatus.Active));
        assertEq(id.recoveryHash, RECOVERY_HASH_1);
        assertEq(id.credentialCount, 0);
        assertEq(id.nonce, 0);
    }

    function test_RegisterIdentity_RevertsZeroDidHash() public {
        vm.prank(alice);
        vm.expectRevert(ZeroID.ZeroHash.selector);
        zeroid.registerIdentity(bytes32(0), RECOVERY_HASH_1);
    }

    function test_RegisterIdentity_RevertsZeroRecoveryHash() public {
        vm.prank(alice);
        vm.expectRevert(ZeroID.ZeroHash.selector);
        zeroid.registerIdentity(DID_HASH_1, bytes32(0));
    }

    function test_RegisterIdentity_RevertsDuplicate() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.IdentityAlreadyExists.selector, DID_HASH_1));
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);
    }

    function test_RegisterIdentity_RevertsControllerAlreadyBound() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.ControllerAlreadyBound.selector, alice));
        zeroid.registerIdentity(DID_HASH_2, RECOVERY_HASH_1);
    }

    function test_ResolveByController() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        assertEq(zeroid.resolveByController(alice), DID_HASH_1);
        assertEq(zeroid.resolveByController(bob), bytes32(0));
    }

    function test_ResolveIdentity_RevertsNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(ZeroID.IdentityNotFound.selector, DID_HASH_1));
        zeroid.resolveIdentity(DID_HASH_1);
    }

    function test_IsActiveIdentity_FalseForNonexistent() public view {
        assertFalse(zeroid.isActiveIdentity(DID_HASH_1));
    }

    // ════════════════════════════════════════════════════════════════
    // Batch Registration
    // ════════════════════════════════════════════════════════════════

    function test_BatchRegister_Success() public {
        bytes32 operatorRole = zeroid.OPERATOR_ROLE();
        vm.prank(admin);
        zeroid.grantRole(operatorRole, operator);

        bytes32[] memory dids = new bytes32[](2);
        dids[0] = DID_HASH_1;
        dids[1] = DID_HASH_2;

        address[] memory controllers = new address[](2);
        controllers[0] = alice;
        controllers[1] = bob;

        bytes32[] memory recoveryHashes = new bytes32[](2);
        recoveryHashes[0] = RECOVERY_HASH_1;
        recoveryHashes[1] = keccak256(abi.encodePacked(bytes32(keccak256("recovery_2"))));

        vm.prank(operator);
        zeroid.batchRegister(dids, controllers, recoveryHashes);

        assertEq(zeroid.totalIdentities(), 2);
        assertTrue(zeroid.isActiveIdentity(DID_HASH_1));
        assertTrue(zeroid.isActiveIdentity(DID_HASH_2));
    }

    function test_BatchRegister_RevertsWithoutRole() public {
        bytes32[] memory dids = new bytes32[](1);
        dids[0] = DID_HASH_1;
        address[] memory controllers = new address[](1);
        controllers[0] = alice;
        bytes32[] memory recoveryHashes = new bytes32[](1);
        recoveryHashes[0] = RECOVERY_HASH_1;

        vm.prank(alice);
        vm.expectRevert();
        zeroid.batchRegister(dids, controllers, recoveryHashes);
    }

    function test_BatchRegister_RevertsBatchSizeExceeded() public {
        bytes32 operatorRole = zeroid.OPERATOR_ROLE();
        vm.prank(admin);
        zeroid.grantRole(operatorRole, operator);

        uint32 size = 51;
        bytes32[] memory dids = new bytes32[](size);
        address[] memory controllers = new address[](size);
        bytes32[] memory recoveryHashes = new bytes32[](size);

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.BatchSizeExceeded.selector, size));
        zeroid.batchRegister(dids, controllers, recoveryHashes);
    }

    // ════════════════════════════════════════════════════════════════
    // Controller Change
    // ════════════════════════════════════════════════════════════════

    function test_ChangeController_Success() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(alice);
        vm.expectEmit(true, true, true, false);
        emit IIdentityRegistry.ControllerChanged(DID_HASH_1, alice, bob);
        zeroid.changeController(DID_HASH_1, bob);

        Identity memory id = zeroid.resolveIdentity(DID_HASH_1);
        assertEq(id.controller, bob);
        assertEq(id.nonce, 1);
        assertEq(zeroid.resolveByController(bob), DID_HASH_1);
        assertEq(zeroid.resolveByController(alice), bytes32(0));
    }

    function test_ChangeController_RevertsNotController() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.NotController.selector, DID_HASH_1, bob));
        zeroid.changeController(DID_HASH_1, carol);
    }

    function test_ChangeController_RevertsZeroAddress() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(alice);
        vm.expectRevert(ZeroID.ZeroAddress.selector);
        zeroid.changeController(DID_HASH_1, address(0));
    }

    function test_ChangeController_RevertsControllerAlreadyBound() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);
        vm.prank(bob);
        zeroid.registerIdentity(DID_HASH_2, RECOVERY_HASH_1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.ControllerAlreadyBound.selector, bob));
        zeroid.changeController(DID_HASH_1, bob);
    }

    // ════════════════════════════════════════════════════════════════
    // Identity Lifecycle (suspend, reactivate, deactivate)
    // ════════════════════════════════════════════════════════════════

    function test_UpdateIdentityStatus_Suspend() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(admin);
        zeroid.updateIdentityStatus(DID_HASH_1, IdentityStatus.Suspended);

        Identity memory id = zeroid.resolveIdentity(DID_HASH_1);
        assertEq(uint8(id.status), uint8(IdentityStatus.Suspended));
        assertFalse(zeroid.isActiveIdentity(DID_HASH_1));
    }

    function test_UpdateIdentityStatus_Reactivate() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(admin);
        zeroid.updateIdentityStatus(DID_HASH_1, IdentityStatus.Suspended);

        vm.prank(admin);
        zeroid.updateIdentityStatus(DID_HASH_1, IdentityStatus.Active);

        assertTrue(zeroid.isActiveIdentity(DID_HASH_1));
    }

    function test_UpdateIdentityStatus_RevertsWithoutRole() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(bob);
        vm.expectRevert();
        zeroid.updateIdentityStatus(DID_HASH_1, IdentityStatus.Suspended);
    }

    function test_UpdateIdentityStatus_RevertsIdentityNotFound() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.IdentityNotFound.selector, DID_HASH_1));
        zeroid.updateIdentityStatus(DID_HASH_1, IdentityStatus.Suspended);
    }

    function test_UpdateIdentityStatus_EmitsEvent() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit IIdentityRegistry.IdentityUpdated(DID_HASH_1, IdentityStatus.Suspended, uint64(block.timestamp));
        zeroid.updateIdentityStatus(DID_HASH_1, IdentityStatus.Suspended);
    }

    // ════════════════════════════════════════════════════════════════
    // Recovery Flow
    // ════════════════════════════════════════════════════════════════

    function test_Recovery_FullFlow() public {
        // Register
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        // Initiate recovery (recoveryProof hashes to RECOVERY_HASH_1)
        vm.prank(carol);
        vm.expectEmit(true, true, false, false);
        emit IIdentityRegistry.RecoveryInitiated(DID_HASH_1, bob);
        zeroid.initiateRecovery(DID_HASH_1, RECOVERY_SECRET_1, bob);

        // Cannot execute before timelock
        vm.expectRevert();
        zeroid.executeRecovery(DID_HASH_1);

        // Warp past timelock
        vm.warp(block.timestamp + 48 hours + 1);

        // Execute recovery
        vm.expectEmit(true, true, false, false);
        emit ZeroID.RecoveryExecuted(DID_HASH_1, bob);
        zeroid.executeRecovery(DID_HASH_1);

        // Verify new controller
        Identity memory id = zeroid.resolveIdentity(DID_HASH_1);
        assertEq(id.controller, bob);
    }

    function test_Recovery_RevertsInvalidProof() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(carol);
        vm.expectRevert(ZeroID.InvalidRecoveryProof.selector);
        zeroid.initiateRecovery(DID_HASH_1, keccak256("wrong_secret"), bob);
    }

    function test_Recovery_RevertsAlreadyActive() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(carol);
        zeroid.initiateRecovery(DID_HASH_1, RECOVERY_SECRET_1, bob);

        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.RecoveryAlreadyActive.selector, DID_HASH_1));
        zeroid.initiateRecovery(DID_HASH_1, RECOVERY_SECRET_1, carol);
    }

    function test_Recovery_ContestByCancel() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(carol);
        zeroid.initiateRecovery(DID_HASH_1, RECOVERY_SECRET_1, bob);

        // Controller cancels
        vm.prank(alice);
        vm.expectEmit(true, false, false, false);
        emit ZeroID.RecoveryCancelled(DID_HASH_1);
        zeroid.cancelRecovery(DID_HASH_1);

        // Cannot execute after cancel
        vm.warp(block.timestamp + 48 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.RecoveryNotActive.selector, DID_HASH_1));
        zeroid.executeRecovery(DID_HASH_1);
    }

    function test_CancelRecovery_RevertsNotController() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(carol);
        zeroid.initiateRecovery(DID_HASH_1, RECOVERY_SECRET_1, bob);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.NotController.selector, DID_HASH_1, bob));
        zeroid.cancelRecovery(DID_HASH_1);
    }

    function test_CancelRecovery_RevertsNotActive() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.RecoveryNotActive.selector, DID_HASH_1));
        zeroid.cancelRecovery(DID_HASH_1);
    }

    function test_ExecuteRecovery_RevertsTimelockNotExpired() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(carol);
        zeroid.initiateRecovery(DID_HASH_1, RECOVERY_SECRET_1, bob);

        vm.warp(block.timestamp + 47 hours);
        vm.expectRevert();
        zeroid.executeRecovery(DID_HASH_1);
    }

    function test_ExecuteRecovery_RevertsNewControllerAlreadyBound() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);
        vm.prank(bob);
        zeroid.registerIdentity(DID_HASH_2, keccak256(abi.encodePacked(bytes32(keccak256("s2")))));

        vm.prank(carol);
        zeroid.initiateRecovery(DID_HASH_1, RECOVERY_SECRET_1, bob);

        vm.warp(block.timestamp + 48 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.ControllerAlreadyBound.selector, bob));
        zeroid.executeRecovery(DID_HASH_1);
    }

    // ════════════════════════════════════════════════════════════════
    // Delegation
    // ════════════════════════════════════════════════════════════════

    function test_AddDelegate_Success() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit ZeroID.DelegateAdded(DID_HASH_1, bob, uint64(block.timestamp + 1 days));
        zeroid.addDelegate(DID_HASH_1, bob, 1 days);

        assertTrue(zeroid.isValidDelegate(DID_HASH_1, bob));
    }

    function test_AddDelegate_RevertsZeroAddress() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(alice);
        vm.expectRevert(ZeroID.ZeroAddress.selector);
        zeroid.addDelegate(DID_HASH_1, address(0), 1 days);
    }

    function test_AddDelegate_RevertsInvalidDuration() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(alice);
        vm.expectRevert("Invalid duration");
        zeroid.addDelegate(DID_HASH_1, bob, 0);
    }

    function test_AddDelegate_RevertsNotController() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.NotController.selector, DID_HASH_1, bob));
        zeroid.addDelegate(DID_HASH_1, carol, 1 days);
    }

    function test_RevokeDelegate_Success() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(alice);
        zeroid.addDelegate(DID_HASH_1, bob, 1 days);

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit ZeroID.DelegateRevoked(DID_HASH_1, bob);
        zeroid.revokeDelegate(DID_HASH_1, bob);

        assertFalse(zeroid.isValidDelegate(DID_HASH_1, bob));
    }

    function test_IsValidDelegate_FalseWhenExpired() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(alice);
        zeroid.addDelegate(DID_HASH_1, bob, 1 hours);

        vm.warp(block.timestamp + 2 hours);
        assertFalse(zeroid.isValidDelegate(DID_HASH_1, bob));
    }

    // ════════════════════════════════════════════════════════════════
    // Auth Keys
    // ════════════════════════════════════════════════════════════════

    function test_AddAuthKey_Success() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        bytes32 keyHash = keccak256("key1");
        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit ZeroID.AuthKeyAdded(DID_HASH_1, keyHash);
        zeroid.addAuthKey(DID_HASH_1, keyHash);

        assertTrue(zeroid.isAuthKey(DID_HASH_1, keyHash));
    }

    function test_AddAuthKey_RevertsZeroHash() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(alice);
        vm.expectRevert(ZeroID.ZeroHash.selector);
        zeroid.addAuthKey(DID_HASH_1, bytes32(0));
    }

    function test_AddAuthKey_RevertsDuplicate() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        bytes32 keyHash = keccak256("key1");
        vm.prank(alice);
        zeroid.addAuthKey(DID_HASH_1, keyHash);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.AuthKeyAlreadyExists.selector, keyHash));
        zeroid.addAuthKey(DID_HASH_1, keyHash);
    }

    function test_AddAuthKey_RevertsMaxReached() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        for (uint256 i = 0; i < 16; i++) {
            vm.prank(alice);
            zeroid.addAuthKey(DID_HASH_1, _hash("key", i));
        }

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.MaxAuthKeysReached.selector, DID_HASH_1));
        zeroid.addAuthKey(DID_HASH_1, _hash("key", 16));
    }

    function test_RevokeAuthKey_Success() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        bytes32 keyHash = keccak256("key1");
        vm.prank(alice);
        zeroid.addAuthKey(DID_HASH_1, keyHash);

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit ZeroID.AuthKeyRevoked(DID_HASH_1, keyHash);
        zeroid.revokeAuthKey(DID_HASH_1, keyHash);

        assertFalse(zeroid.isAuthKey(DID_HASH_1, keyHash));
    }

    function test_RevokeAuthKey_RevertsNotFound() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        bytes32 keyHash = keccak256("nonexistent_key");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ZeroID.AuthKeyNotFound.selector, keyHash));
        zeroid.revokeAuthKey(DID_HASH_1, keyHash);
    }

    function test_AuthKey_RotateFlow() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        bytes32 oldKey = keccak256("oldKey");
        bytes32 newKey = keccak256("newKey");

        vm.prank(alice);
        zeroid.addAuthKey(DID_HASH_1, oldKey);
        assertTrue(zeroid.isAuthKey(DID_HASH_1, oldKey));

        vm.prank(alice);
        zeroid.revokeAuthKey(DID_HASH_1, oldKey);

        vm.prank(alice);
        zeroid.addAuthKey(DID_HASH_1, newKey);

        assertFalse(zeroid.isAuthKey(DID_HASH_1, oldKey));
        assertTrue(zeroid.isAuthKey(DID_HASH_1, newKey));
    }

    // ════════════════════════════════════════════════════════════════
    // Credential Count
    // ════════════════════════════════════════════════════════════════

    function test_IncrementCredentialCount() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        bytes32 operatorRole = zeroid.OPERATOR_ROLE();
        vm.prank(admin);
        zeroid.grantRole(operatorRole, operator);

        vm.prank(operator);
        zeroid.incrementCredentialCount(DID_HASH_1);

        Identity memory id = zeroid.resolveIdentity(DID_HASH_1);
        assertEq(id.credentialCount, 1);
    }

    function test_IncrementCredentialCount_RevertsWithoutRole() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(alice);
        vm.expectRevert();
        zeroid.incrementCredentialCount(DID_HASH_1);
    }

    // ════════════════════════════════════════════════════════════════
    // Pause / Unpause
    // ════════════════════════════════════════════════════════════════

    function test_Pause_BlocksRegistration() public {
        vm.prank(admin);
        zeroid.pause();

        vm.prank(alice);
        vm.expectRevert();
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);
    }

    function test_Unpause_AllowsRegistration() public {
        vm.prank(admin);
        zeroid.pause();

        vm.prank(admin);
        zeroid.unpause();

        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);
        assertTrue(zeroid.isActiveIdentity(DID_HASH_1));
    }

    function test_Pause_RevertsWithoutAdminRole() public {
        vm.prank(alice);
        vm.expectRevert();
        zeroid.pause();
    }

    function test_Pause_BlocksRecovery() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(admin);
        zeroid.pause();

        vm.prank(carol);
        vm.expectRevert();
        zeroid.initiateRecovery(DID_HASH_1, RECOVERY_SECRET_1, bob);
    }

    // ════════════════════════════════════════════════════════════════
    // Suspended identity cannot change controller
    // ════════════════════════════════════════════════════════════════

    function test_ChangeController_RevertsWhenSuspended() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(admin);
        zeroid.updateIdentityStatus(DID_HASH_1, IdentityStatus.Suspended);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            ZeroID.InvalidStatus.selector,
            IdentityStatus.Suspended,
            IdentityStatus.Active
        ));
        zeroid.changeController(DID_HASH_1, bob);
    }

    // ════════════════════════════════════════════════════════════════
    // Suspended identity cannot add delegate
    // ════════════════════════════════════════════════════════════════

    function test_AddDelegate_RevertsWhenSuspended() public {
        vm.prank(alice);
        zeroid.registerIdentity(DID_HASH_1, RECOVERY_HASH_1);

        vm.prank(admin);
        zeroid.updateIdentityStatus(DID_HASH_1, IdentityStatus.Suspended);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            ZeroID.InvalidStatus.selector,
            IdentityStatus.Suspended,
            IdentityStatus.Active
        ));
        zeroid.addDelegate(DID_HASH_1, bob, 1 days);
    }
}
