// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract TEEAttestationRegistryTest is TestHelper {
    TEEAttestationRegistry public teeRegistry;

    bytes32 constant ENCLAVE_HASH = keccak256("mrenclave:v1");
    bytes32 constant REPORT_DATA_HASH = keccak256("report_data:1");
    bytes32 constant MEASUREMENT_HASH = keccak256("measurement:sgx:v1");

    uint256 internal signerPk = 0xDEAD;
    address internal signerAddr;

    function setUp() public {
        teeRegistry = new TEEAttestationRegistry(admin);
        signerAddr = vm.addr(signerPk);

        // Set platform policy for IntelSGX
        vm.prank(admin);
        teeRegistry.setPlatformPolicy(
            TEEPlatform.IntelSGX,
            1 hours,
            30 days,
            signerAddr
        );

        // Allow measurement
        vm.prank(admin);
        teeRegistry.allowMeasurement(MEASUREMENT_HASH, TEEPlatform.IntelSGX);
    }

    function _signAttestation(
        bytes32 enclaveHash,
        TEEPlatform platform,
        bytes32 reportDataHash,
        address nodeOp,
        uint64 validityDuration
    ) internal view returns (bytes memory) {
        bytes32 messageHash = keccak256(abi.encodePacked(
            enclaveHash, platform, reportDataHash, nodeOp, validityDuration
        ));
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }

    function _registerAndSubmit() internal {
        // Register node operator
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        teeRegistry.registerNodeOperator{value: 1 ether}();

        // Use MEASUREMENT_HASH as enclaveHash (it's in the allowlist)
        uint64 validity = 1 hours;
        bytes memory sig = _signAttestation(MEASUREMENT_HASH, TEEPlatform.IntelSGX, REPORT_DATA_HASH, alice, validity);

        vm.prank(alice);
        teeRegistry.submitAttestation(MEASUREMENT_HASH, TEEPlatform.IntelSGX, REPORT_DATA_HASH, sig, validity);
    }

    // ════════════════════════════════════════════════════════════════
    // Deployment
    // ════════════════════════════════════════════════════════════════

    function test_Constructor_SetsRoles() public view {
        assertTrue(teeRegistry.hasRole(teeRegistry.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(teeRegistry.hasRole(teeRegistry.ADMIN_ROLE(), admin));
        assertTrue(teeRegistry.hasRole(teeRegistry.GOVERNANCE_ROLE(), admin));
        assertTrue(teeRegistry.hasRole(teeRegistry.SLASHER_ROLE(), admin));
    }

    function test_Constructor_RevertsZeroAdmin() public {
        vm.expectRevert("Zero admin");
        new TEEAttestationRegistry(address(0));
    }

    function test_InitialState() public view {
        assertEq(teeRegistry.totalActiveAttestations(), 0);
        assertEq(teeRegistry.totalStaked(), 0);
    }

    // ════════════════════════════════════════════════════════════════
    // Platform Policy
    // ════════════════════════════════════════════════════════════════

    function test_SetPlatformPolicy_RevertsUnknownPlatform() public {
        vm.prank(admin);
        vm.expectRevert("Invalid platform");
        teeRegistry.setPlatformPolicy(TEEPlatform.Unknown, 1 hours, 30 days, signerAddr);
    }

    function test_SetPlatformPolicy_RevertsZeroSigningKey() public {
        vm.prank(admin);
        vm.expectRevert("Zero signing key");
        teeRegistry.setPlatformPolicy(TEEPlatform.AMDSEV, 1 hours, 30 days, address(0));
    }

    function test_DisablePlatform() public {
        vm.prank(admin);
        teeRegistry.disablePlatform(TEEPlatform.IntelSGX);
    }

    // ════════════════════════════════════════════════════════════════
    // Measurement Allowlist
    // ════════════════════════════════════════════════════════════════

    function test_AllowMeasurement() public view {
        assertTrue(teeRegistry.isMeasurementAllowed(MEASUREMENT_HASH));
    }

    function test_RevokeMeasurement() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, false);
        emit TEEAttestationRegistry.MeasurementRevoked(MEASUREMENT_HASH);
        teeRegistry.revokeMeasurement(MEASUREMENT_HASH);

        assertFalse(teeRegistry.isMeasurementAllowed(MEASUREMENT_HASH));
    }

    // ════════════════════════════════════════════════════════════════
    // Node Operator
    // ════════════════════════════════════════════════════════════════

    function test_RegisterNodeOperator_Success() public {
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit TEEAttestationRegistry.NodeOperatorRegistered(alice, 1 ether);
        teeRegistry.registerNodeOperator{value: 1 ether}();

        assertEq(teeRegistry.totalStaked(), 1 ether);
        assertTrue(teeRegistry.hasRole(teeRegistry.TEE_NODE_ROLE(), alice));
    }

    function test_RegisterNodeOperator_RevertsInsufficientStake() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            TEEAttestationRegistry.InsufficientStake.selector, 1 ether, 0.5 ether
        ));
        teeRegistry.registerNodeOperator{value: 0.5 ether}();
    }

    function test_RegisterNodeOperator_RevertsAlreadyRegistered() public {
        vm.deal(alice, 3 ether);
        vm.prank(alice);
        teeRegistry.registerNodeOperator{value: 1 ether}();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TEEAttestationRegistry.NodeAlreadyRegistered.selector, alice));
        teeRegistry.registerNodeOperator{value: 1 ether}();
    }

    function test_AddStake() public {
        vm.deal(alice, 3 ether);
        vm.prank(alice);
        teeRegistry.registerNodeOperator{value: 1 ether}();

        vm.prank(alice);
        teeRegistry.addStake{value: 1 ether}();

        assertEq(teeRegistry.totalStaked(), 2 ether);
    }

    function test_SlashOperator() public {
        vm.deal(alice, 3 ether);
        vm.prank(alice);
        teeRegistry.registerNodeOperator{value: 2 ether}();

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit TEEAttestationRegistry.NodeOperatorSlashed(alice, 1 ether, keccak256("misconduct"));
        teeRegistry.slashOperator(alice, 1 ether, keccak256("misconduct"));

        assertEq(teeRegistry.totalStaked(), 1 ether);
    }

    function test_SlashOperator_DeactivatesIfBelowMin() public {
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        teeRegistry.registerNodeOperator{value: 1 ether}();

        vm.prank(admin);
        teeRegistry.slashOperator(alice, 1 ether, keccak256("misconduct"));

        // Should be deactivated
        TEEAttestationRegistry.NodeOperator memory node = teeRegistry.getNodeOperator(alice);
        assertFalse(node.isActive);
    }

    function test_WithdrawStake() public {
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        teeRegistry.registerNodeOperator{value: 1 ether}();

        // Deactivate by slashing below minimum
        vm.prank(admin);
        teeRegistry.slashOperator(alice, 1 ether, keccak256("reason"));

        // Top up balance for gas
        vm.deal(alice, 0.1 ether);

        // Withdraw (stake is 0 now)
        vm.prank(alice);
        vm.expectRevert(TEEAttestationRegistry.NothingToWithdraw.selector);
        teeRegistry.withdrawStake();
    }

    function test_WithdrawStake_RevertsIfActive() public {
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        teeRegistry.registerNodeOperator{value: 1 ether}();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TEEAttestationRegistry.NodeNotActive.selector, alice));
        teeRegistry.withdrawStake();
    }

    // ════════════════════════════════════════════════════════════════
    // Attestation Submission
    // ════════════════════════════════════════════════════════════════

    function test_SubmitAttestation_Success() public {
        _registerAndSubmit();

        assertTrue(teeRegistry.isAttestationValid(MEASUREMENT_HASH));
        assertEq(teeRegistry.totalActiveAttestations(), 1);
        assertEq(teeRegistry.getAttestationHistoryLength(MEASUREMENT_HASH), 1);
    }

    function test_SubmitAttestation_RevertsPlatformNotEnabled() public {
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        teeRegistry.registerNodeOperator{value: 1 ether}();

        bytes32 sevEnclave = keccak256("sev_enclave");
        vm.prank(admin);
        teeRegistry.allowMeasurement(sevEnclave, TEEPlatform.AMDSEV);

        uint64 validity = 1 hours;
        bytes memory sig = _signAttestation(sevEnclave, TEEPlatform.AMDSEV, REPORT_DATA_HASH, alice, validity);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TEEAttestationRegistry.PlatformNotEnabled.selector, TEEPlatform.AMDSEV));
        teeRegistry.submitAttestation(sevEnclave, TEEPlatform.AMDSEV, REPORT_DATA_HASH, sig, validity);
    }

    function test_SubmitAttestation_RevertsMeasurementNotAllowed() public {
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        teeRegistry.registerNodeOperator{value: 1 ether}();

        bytes32 badEnclave = keccak256("bad_enclave");
        uint64 validity = 1 hours;
        bytes memory sig = _signAttestation(badEnclave, TEEPlatform.IntelSGX, REPORT_DATA_HASH, alice, validity);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TEEAttestationRegistry.MeasurementNotAllowed.selector, badEnclave));
        teeRegistry.submitAttestation(badEnclave, TEEPlatform.IntelSGX, REPORT_DATA_HASH, sig, validity);
    }

    // ════════════════════════════════════════════════════════════════
    // Attestation Revocation & Expiry
    // ════════════════════════════════════════════════════════════════

    function test_RevokeAttestation_ByOperator() public {
        _registerAndSubmit();

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit ITEEAttestation.AttestationRevoked(MEASUREMENT_HASH, uint64(block.timestamp));
        teeRegistry.revokeAttestation(MEASUREMENT_HASH);

        assertFalse(teeRegistry.isAttestationValid(MEASUREMENT_HASH));
    }

    function test_RevokeAttestation_ByGovernance() public {
        _registerAndSubmit();

        vm.prank(admin);
        teeRegistry.revokeAttestation(MEASUREMENT_HASH);

        assertFalse(teeRegistry.isAttestationValid(MEASUREMENT_HASH));
    }

    function test_RevokeAttestation_RevertsNotFound() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(TEEAttestationRegistry.AttestationNotFound.selector, ENCLAVE_HASH));
        teeRegistry.revokeAttestation(ENCLAVE_HASH);
    }

    function test_IsAttestationValid_FalseWhenExpired() public {
        _registerAndSubmit();

        vm.warp(block.timestamp + 2 hours);
        assertFalse(teeRegistry.isAttestationValid(MEASUREMENT_HASH));
    }

    // ════════════════════════════════════════════════════════════════
    // Pause
    // ════════════════════════════════════════════════════════════════

    function test_Pause_BlocksSubmission() public {
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        teeRegistry.registerNodeOperator{value: 1 ether}();

        vm.prank(admin);
        teeRegistry.pause();

        uint64 validity = 1 hours;
        bytes memory sig = _signAttestation(MEASUREMENT_HASH, TEEPlatform.IntelSGX, REPORT_DATA_HASH, alice, validity);

        vm.prank(alice);
        vm.expectRevert();
        teeRegistry.submitAttestation(MEASUREMENT_HASH, TEEPlatform.IntelSGX, REPORT_DATA_HASH, sig, validity);
    }

    function test_ReceiveEth() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool sent, ) = address(teeRegistry).call{value: 0.5 ether}("");
        assertTrue(sent);
    }

    // ════════════════════════════════════════════════════════════════
    // ZID-012: Double Revocation Prevention
    // ════════════════════════════════════════════════════════════════

    function test_RevokeAttestation_RevertsDoubleRevocation() public {
        _registerAndSubmit();

        // First revocation should succeed
        vm.prank(alice);
        teeRegistry.revokeAttestation(MEASUREMENT_HASH);

        assertFalse(teeRegistry.isAttestationValid(MEASUREMENT_HASH));
        assertEq(teeRegistry.totalActiveAttestations(), 0);

        // Second revocation should revert (prevents counter underflow)
        vm.prank(alice);
        vm.expectRevert("Attestation already revoked");
        teeRegistry.revokeAttestation(MEASUREMENT_HASH);

        // Counter should still be 0, not underflowed
        assertEq(teeRegistry.totalActiveAttestations(), 0);
    }

    function test_RevokeAttestation_GovernanceDoubleRevocation() public {
        _registerAndSubmit();

        vm.prank(admin);
        teeRegistry.revokeAttestation(MEASUREMENT_HASH);

        vm.prank(admin);
        vm.expectRevert("Attestation already revoked");
        teeRegistry.revokeAttestation(MEASUREMENT_HASH);
    }
}
