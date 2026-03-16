// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract CrossChainIdentityBridgeTest is TestHelper {
    CrossChainIdentityBridge public bridge;

    uint256 constant CHAIN_A = 42161; // Arbitrum
    uint256 constant CHAIN_B = 137;   // Polygon
    bytes32 constant GENESIS_ROOT = keccak256("genesis:chainA");
    bytes32 constant CRED_HASH = keccak256("cred:bridge:1");

    // Private key for alice so we can produce ECDSA signatures in revocation tests
    uint256 internal constant ALICE_PK = 0xA11CE;

    function setUp() public {
        // Override alice with an address derived from ALICE_PK so vm.sign works
        alice = vm.addr(ALICE_PK);
        bridge = new CrossChainIdentityBridge(admin);
    }

    function _registerChain() internal {
        vm.prank(admin);
        bridge.registerChain(CHAIN_A, GENESIS_ROOT, 1 hours, 50, 1 hours);
    }

    function _registerChainB() internal {
        vm.prank(admin);
        bridge.registerChain(CHAIN_B, keccak256("genesis:chainB"), 1 hours, 50, 1 hours);
    }

    function _registerOperator(address op) internal {
        vm.deal(op, 3 ether);
        vm.prank(op);
        bridge.registerOperator{value: 1 ether}();
    }

    function _grantRevocationSyncRole(address target) internal {
        bytes32 syncRole = bridge.REVOCATION_SYNC_ROLE();
        vm.prank(admin);
        bridge.grantRole(syncRole, target);
    }

    // ════════════════════════════════════════════════════════════════
    // Deployment
    // ════════════════════════════════════════════════════════════════

    function test_Constructor_SetsRoles() public view {
        assertTrue(bridge.hasRole(bridge.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(bridge.hasRole(bridge.SLASHER_ROLE(), admin));
    }

    function test_InitialState() public view {
        assertEq(bridge.messageNonce(), 0);
    }

    function test_Constants() public view {
        assertEq(bridge.MIN_OPERATOR_STAKE(), 1 ether);
        assertEq(bridge.DEFAULT_FRAUD_PROOF_WINDOW(), 1 hours);
        assertEq(bridge.SLASH_PERCENTAGE(), 50);
        assertEq(bridge.MAX_MESSAGE_AGE(), 24 hours);
        assertEq(bridge.STAKE_LOCK_PERIOD(), 7 days);
    }

    // ════════════════════════════════════════════════════════════════
    // Chain Management
    // ════════════════════════════════════════════════════════════════

    function test_RegisterChain_Success() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit CrossChainIdentityBridge.ChainRegistered(CHAIN_A, GENESIS_ROOT, block.timestamp);
        bridge.registerChain(CHAIN_A, GENESIS_ROOT, 1 hours, 50, 1 hours);

        CrossChainIdentityBridge.ChainConfig memory config = bridge.getChainConfig(CHAIN_A);
        assertEq(config.chainId, CHAIN_A);
        assertTrue(config.active);
        assertEq(config.latestStateRoot, GENESIS_ROOT);
    }

    function test_RegisterChain_RevertsDuplicate() public {
        _registerChain();

        vm.prank(admin);
        vm.expectRevert(CrossChainIdentityBridge.ChainAlreadyRegistered.selector);
        bridge.registerChain(CHAIN_A, GENESIS_ROOT, 1 hours, 50, 1 hours);
    }

    function test_RegisterChain_DefaultFraudWindow() public {
        vm.prank(admin);
        bridge.registerChain(CHAIN_A, GENESIS_ROOT, 0, 0, 0); // zeros = use defaults

        CrossChainIdentityBridge.ChainConfig memory config = bridge.getChainConfig(CHAIN_A);
        assertEq(config.fraudProofWindow, 1 hours);
    }

    // ════════════════════════════════════════════════════════════════
    // Light Client
    // ════════════════════════════════════════════════════════════════

    function test_UpdateLightClient_Success() public {
        _registerChain();

        // Grant LIGHT_CLIENT_UPDATER_ROLE and VERIFIED_PROOF_SUBMITTER_ROLE to alice
        bytes32 updaterRole = bridge.LIGHT_CLIENT_UPDATER_ROLE();
        bytes32 proofSubmitterRole = bridge.VERIFIED_PROOF_SUBMITTER_ROLE();
        vm.prank(admin);
        bridge.grantRole(updaterRole, alice);
        vm.prank(admin);
        bridge.grantRole(proofSubmitterRole, alice);

        bytes32 newRoot = keccak256("state:2");
        bytes memory proof = new bytes(96); // minimum proof length
        proof[0] = 0x01;

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit CrossChainIdentityBridge.LightClientUpdated(CHAIN_A, newRoot, 1, block.timestamp);
        bridge.updateLightClient(CHAIN_A, newRoot, 1, proof);

        CrossChainIdentityBridge.ChainConfig memory config = bridge.getChainConfig(CHAIN_A);
        assertEq(config.latestStateRoot, newRoot);
        assertEq(config.latestBlockNumber, 1);
    }

    function test_UpdateLightClient_RevertsChainNotSupported() public {
        bytes32 updaterRole = bridge.LIGHT_CLIENT_UPDATER_ROLE();
        vm.prank(admin);
        bridge.grantRole(updaterRole, alice);

        vm.prank(alice);
        vm.expectRevert(CrossChainIdentityBridge.ChainNotSupported.selector);
        bridge.updateLightClient(999, keccak256("root"), 1, new bytes(96));
    }

    function test_UpdateLightClient_RevertsInvalidProof() public {
        _registerChain();

        bytes32 updaterRole = bridge.LIGHT_CLIENT_UPDATER_ROLE();
        vm.prank(admin);
        bridge.grantRole(updaterRole, alice);

        // proof too short
        vm.prank(alice);
        vm.expectRevert(CrossChainIdentityBridge.InvalidLightClientUpdate.selector);
        bridge.updateLightClient(CHAIN_A, keccak256("root"), 1, new bytes(32));
    }

    // ════════════════════════════════════════════════════════════════
    // Operator Management
    // ════════════════════════════════════════════════════════════════

    function test_RegisterOperator_Success() public {
        vm.deal(alice, 2 ether);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit CrossChainIdentityBridge.OperatorStaked(alice, 1 ether, block.timestamp);
        bridge.registerOperator{value: 1 ether}();

        CrossChainIdentityBridge.OperatorInfo memory info = bridge.getOperatorInfo(alice);
        assertEq(info.stakedAmount, 1 ether);
        assertTrue(info.active);
        assertTrue(bridge.hasRole(bridge.BRIDGE_OPERATOR_ROLE(), alice));
    }

    function test_RegisterOperator_RevertsInsufficientStake() public {
        vm.deal(alice, 1 ether);

        vm.prank(alice);
        vm.expectRevert(CrossChainIdentityBridge.InsufficientStake.selector);
        bridge.registerOperator{value: 0.5 ether}();
    }

    function test_RegisterOperator_RevertsDuplicate() public {
        _registerOperator(alice);

        vm.prank(alice);
        vm.expectRevert(CrossChainIdentityBridge.OperatorAlreadyRegistered.selector);
        bridge.registerOperator{value: 1 ether}();
    }

    function test_AddStake() public {
        _registerOperator(alice);

        vm.prank(alice);
        bridge.addStake{value: 1 ether}();

        CrossChainIdentityBridge.OperatorInfo memory info = bridge.getOperatorInfo(alice);
        assertEq(info.stakedAmount, 2 ether);
    }

    function test_AddStake_RevertsNotRegistered() public {
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        vm.expectRevert(CrossChainIdentityBridge.OperatorNotRegistered.selector);
        bridge.addStake{value: 1 ether}();
    }

    function test_WithdrawStake_Success() public {
        _registerOperator(alice);

        // Add extra stake
        vm.prank(alice);
        bridge.addStake{value: 1 ether}();

        // Wait for lock period
        vm.warp(block.timestamp + 7 days + 1);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        bridge.withdrawStake(0.5 ether);

        assertGt(alice.balance, balBefore);
    }

    function test_WithdrawStake_RevertsLocked() public {
        _registerOperator(alice);

        vm.prank(alice);
        vm.expectRevert(CrossChainIdentityBridge.StakeWithdrawalLocked.selector);
        bridge.withdrawStake(0.5 ether);
    }

    function test_WithdrawStake_DeactivatesIfBelowMin() public {
        _registerOperator(alice);

        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(alice);
        bridge.withdrawStake(1 ether);

        CrossChainIdentityBridge.OperatorInfo memory info = bridge.getOperatorInfo(alice);
        assertFalse(info.active);
    }

    // ════════════════════════════════════════════════════════════════
    // Credential Bridging
    // ════════════════════════════════════════════════════════════════

    function test_BridgeCredential_RevertsChainNotSupported() public {
        _registerOperator(alice);

        vm.prank(alice);
        vm.expectRevert(CrossChainIdentityBridge.ChainNotSupported.selector);
        bridge.bridgeCredential(CRED_HASH, 999, "proof", keccak256("acc_root"));
    }

    function test_BridgeCredential_RevertsCircuitBreaker() public {
        _registerChain();
        _registerOperator(alice);

        vm.prank(admin);
        bridge.tripCircuitBreaker(CHAIN_A, "suspicious activity");

        vm.prank(alice);
        vm.expectRevert(CrossChainIdentityBridge.CircuitBreakerTripped.selector);
        bridge.bridgeCredential(CRED_HASH, CHAIN_A, "proof", keccak256("acc_root"));
    }

    // ════════════════════════════════════════════════════════════════
    // Circuit Breaker
    // ════════════════════════════════════════════════════════════════

    function test_TripCircuitBreaker() public {
        _registerChain();

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit CrossChainIdentityBridge.CircuitBreakerTriggered(CHAIN_A, "test", block.timestamp);
        bridge.tripCircuitBreaker(CHAIN_A, "test");

        CrossChainIdentityBridge.ChainConfig memory config = bridge.getChainConfig(CHAIN_A);
        assertTrue(config.circuitBreakerActive);
    }

    function test_ResetCircuitBreaker() public {
        _registerChain();

        vm.prank(admin);
        bridge.tripCircuitBreaker(CHAIN_A, "test");

        vm.prank(admin);
        bridge.resetCircuitBreaker(CHAIN_A);

        CrossChainIdentityBridge.ChainConfig memory config = bridge.getChainConfig(CHAIN_A);
        assertFalse(config.circuitBreakerActive);
    }

    // ════════════════════════════════════════════════════════════════
    // DID Resolution
    // ════════════════════════════════════════════════════════════════

    function test_RegisterDID_Success() public {
        bytes32 didHash = keccak256("did:zeroid:alice");
        bytes32 docHash = keccak256("doc:alice");

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit CrossChainIdentityBridge.DIDResolved(didHash, block.chainid, docHash, block.timestamp);
        bridge.registerDID(didHash, docHash);

        CrossChainIdentityBridge.DIDReference memory ref = bridge.resolveDID(didHash);
        assertTrue(ref.active);
        assertEq(ref.documentHash, docHash);
    }

    function test_ResolveDID_RevertsNotFound() public {
        vm.expectRevert(CrossChainIdentityBridge.InvalidDIDMethod.selector);
        bridge.resolveDID(keccak256("unknown"));
    }

    function test_RegisterDIDMethod() public {
        _registerChain();

        vm.prank(admin);
        bridge.registerDIDMethod(keccak256("did:zeroid"), CHAIN_A);
    }

    function test_RegisterDIDMethod_RevertsChainNotSupported() public {
        vm.prank(admin);
        vm.expectRevert(CrossChainIdentityBridge.ChainNotSupported.selector);
        bridge.registerDIDMethod(keccak256("did:zeroid"), 999);
    }

    // ════════════════════════════════════════════════════════════════
    // View Functions
    // ════════════════════════════════════════════════════════════════

    function test_GetSupportedChains() public {
        _registerChain();
        _registerChainB();

        uint256[] memory chains = bridge.getSupportedChains();
        assertEq(chains.length, 2);
    }

    function test_IsCredentialBridged_FalseByDefault() public view {
        assertFalse(bridge.isCredentialBridged(CRED_HASH, CHAIN_A));
    }

    // ════════════════════════════════════════════════════════════════
    // Revocation Sync
    // ════════════════════════════════════════════════════════════════

    function test_SyncRevocation_RevertsChainNotSupported() public {
        _registerOperator(alice);

        // Grant REVOCATION_SYNC_ROLE to alice
        bytes32 syncRole = bridge.REVOCATION_SYNC_ROLE();
        vm.prank(admin);
        bridge.grantRole(syncRole, alice);

        bytes32 prevRoot = keccak256("prev");
        bytes32 newRoot = keccak256("new");

        CrossChainIdentityBridge.RevocationSync memory sync = CrossChainIdentityBridge.RevocationSync({
            sourceChain: 999,
            accumulatorRoot: newRoot,
            epoch: 1,
            previousRoot: prevRoot,
            updateProof: "",
            timestamp: block.timestamp
        });

        vm.prank(alice);
        vm.expectRevert(CrossChainIdentityBridge.ChainNotSupported.selector);
        bridge.syncRevocation(sync);
    }

    // ════════════════════════════════════════════════════════════════
    // Pause
    // ════════════════════════════════════════════════════════════════

    function test_Pause_BlocksRegistration() public {
        vm.prank(admin);
        bridge.pause();

        vm.deal(alice, 2 ether);
        vm.prank(alice);
        vm.expectRevert();
        bridge.registerOperator{value: 1 ether}();
    }

    function test_ReceiveEth() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool sent, ) = address(bridge).call{value: 0.5 ether}("");
        assertTrue(sent);
    }

    // ════════════════════════════════════════════════════════════════
    // ZID-005: Verified Proof Submitter Role
    // ════════════════════════════════════════════════════════════════

    function test_UpdateLightClient_RevertsWithoutProofSubmitterRole() public {
        _registerChain();

        // Grant LIGHT_CLIENT_UPDATER_ROLE but NOT VERIFIED_PROOF_SUBMITTER_ROLE
        bytes32 updaterRole = bridge.LIGHT_CLIENT_UPDATER_ROLE();
        vm.prank(admin);
        bridge.grantRole(updaterRole, alice);

        bytes32 newRoot = keccak256("state:2");
        bytes memory proof = new bytes(96);
        proof[0] = 0x01;

        vm.prank(alice);
        vm.expectRevert("Caller not authorized as verified proof submitter");
        bridge.updateLightClient(CHAIN_A, newRoot, 1, proof);
    }

    // ════════════════════════════════════════════════════════════════
    // ZID-006: Revocation Sync Timelock
    // ════════════════════════════════════════════════════════════════

    function _prepareSyncData() internal returns (
        CrossChainIdentityBridge.RevocationSync memory sync,
        bytes32 syncKey
    ) {
        bytes32 prevRoot = bytes32(0);
        bytes32 newRoot = keccak256("accumulator:new");
        uint256 epoch = 1;

        // Build the same message hash the contract computes in syncRevocation():
        // keccak256(abi.encodePacked(previousRoot, accumulatorRoot, epoch, sourceChain, block.chainid))
        bytes32 messageHash = keccak256(
            abi.encodePacked(prevRoot, newRoot, epoch, CHAIN_A, block.chainid)
        );
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ALICE_PK, ethSignedHash);
        bytes memory updateProof = abi.encodePacked(r, s, v);

        sync = CrossChainIdentityBridge.RevocationSync({
            sourceChain: CHAIN_A,
            accumulatorRoot: newRoot,
            epoch: epoch,
            previousRoot: prevRoot,
            updateProof: updateProof,
            timestamp: block.timestamp
        });

        syncKey = keccak256(abi.encodePacked(CHAIN_A, newRoot, epoch));
    }

    function test_SyncRevocation_QueuesWithTimelock() public {
        _registerChain();
        _registerOperator(alice);
        _grantRevocationSyncRole(alice);

        (CrossChainIdentityBridge.RevocationSync memory sync, bytes32 syncKey) = _prepareSyncData();

        vm.prank(alice);
        bridge.syncRevocation(sync);

        CrossChainIdentityBridge.PendingRevocationSync memory pending = bridge.getPendingRevocationSync(syncKey);
        assertTrue(pending.exists);
        assertFalse(pending.cancelled);
        assertEq(pending.readyAt, block.timestamp + 1 hours);
    }

    function test_FinalizeRevocationSync_Success() public {
        _registerChain();
        _registerOperator(alice);
        _grantRevocationSyncRole(alice);

        (CrossChainIdentityBridge.RevocationSync memory sync, bytes32 syncKey) = _prepareSyncData();

        vm.prank(alice);
        bridge.syncRevocation(sync);

        // Warp past delay
        vm.warp(block.timestamp + 1 hours + 1);

        bridge.finalizeRevocationSync(syncKey);

        assertEq(bridge.getCrossChainAccumulatorRoot(CHAIN_A), sync.accumulatorRoot);
    }

    function test_FinalizeRevocationSync_RevertsBeforeDelay() public {
        _registerChain();
        _registerOperator(alice);
        _grantRevocationSyncRole(alice);

        (CrossChainIdentityBridge.RevocationSync memory sync, bytes32 syncKey) = _prepareSyncData();

        vm.prank(alice);
        bridge.syncRevocation(sync);

        vm.expectRevert("Sync delay not elapsed");
        bridge.finalizeRevocationSync(syncKey);
    }

    function test_CancelRevocationSync_Success() public {
        _registerChain();
        _registerOperator(alice);
        _grantRevocationSyncRole(alice);

        (CrossChainIdentityBridge.RevocationSync memory sync, bytes32 syncKey) = _prepareSyncData();

        vm.prank(alice);
        bridge.syncRevocation(sync);

        vm.prank(admin);
        bridge.cancelRevocationSync(syncKey);

        CrossChainIdentityBridge.PendingRevocationSync memory pending = bridge.getPendingRevocationSync(syncKey);
        assertTrue(pending.cancelled);
    }

    function test_FinalizeRevocationSync_RevertsCancelled() public {
        _registerChain();
        _registerOperator(alice);
        _grantRevocationSyncRole(alice);

        (CrossChainIdentityBridge.RevocationSync memory sync, bytes32 syncKey) = _prepareSyncData();

        vm.prank(alice);
        bridge.syncRevocation(sync);

        vm.prank(admin);
        bridge.cancelRevocationSync(syncKey);

        vm.warp(block.timestamp + 2 hours);

        vm.expectRevert("Sync was cancelled");
        bridge.finalizeRevocationSync(syncKey);
    }

    function test_SyncRevocation_RevertsWithoutRole() public {
        _registerChain();
        _registerOperator(alice);

        (CrossChainIdentityBridge.RevocationSync memory sync, ) = _prepareSyncData();

        // alice has BRIDGE_OPERATOR_ROLE but not REVOCATION_SYNC_ROLE
        vm.prank(alice);
        vm.expectRevert();
        bridge.syncRevocation(sync);
    }

    // ════════════════════════════════════════════════════════════════
    // ZID-007: DID Controller Binding
    // ════════════════════════════════════════════════════════════════

    function test_RegisterDID_BindsController() public {
        bytes32 didHash = keccak256("did:zeroid:alice");
        bytes32 docHash = keccak256("doc:alice");

        vm.prank(alice);
        bridge.registerDID(didHash, docHash);

        // alice can update
        bytes32 newDocHash = keccak256("doc:alice:v2");
        vm.prank(alice);
        bridge.registerDID(didHash, newDocHash);

        CrossChainIdentityBridge.DIDReference memory ref = bridge.resolveDID(didHash);
        assertEq(ref.documentHash, newDocHash);
    }

    function test_RegisterDID_RevertsNonController() public {
        bytes32 didHash = keccak256("did:zeroid:alice");

        vm.prank(alice);
        bridge.registerDID(didHash, keccak256("doc:alice"));

        // bob cannot update alice's DID
        vm.prank(bob);
        vm.expectRevert("Only DID controller can update");
        bridge.registerDID(didHash, keccak256("doc:hijacked"));
    }
}
