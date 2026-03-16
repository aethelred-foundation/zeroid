// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";

contract ZKCredentialVerifierTest is TestHelper {
    ZKCredentialVerifier public verifier;

    bytes32 constant CIRCUIT_ID = keccak256("circuit:age_check:v1");

    // Valid BN254 G1 generator: (1, 2)
    uint256[2] validAlpha = [uint256(1), uint256(2)];
    uint256[2][2] validBeta = [[uint256(1), uint256(2)], [uint256(3), uint256(4)]];
    uint256[2][2] validGamma = [[uint256(1), uint256(2)], [uint256(3), uint256(4)]];
    uint256[2][2] validDelta = [[uint256(1), uint256(2)], [uint256(3), uint256(4)]];

    function setUp() public {
        verifier = new ZKCredentialVerifier(admin);
    }

    function _makeIC(uint256 len) internal pure returns (uint256[2][] memory ic) {
        ic = new uint256[2][](len);
        for (uint256 i = 0; i < len; i++) {
            ic[i] = [uint256(1), uint256(2)]; // G1 generator
        }
    }

    // ════════════════════════════════════════════════════════════════
    // Deployment
    // ════════════════════════════════════════════════════════════════

    function test_Constructor_SetsRoles() public view {
        assertTrue(verifier.hasRole(verifier.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(verifier.hasRole(verifier.CIRCUIT_MANAGER_ROLE(), admin));
    }

    function test_Constructor_RevertsZeroAdmin() public {
        vm.expectRevert("Zero admin");
        new ZKCredentialVerifier(address(0));
    }

    function test_InitialState() public view {
        assertEq(verifier.totalVerifications(), 0);
        assertEq(verifier.circuitCount(), 0);
    }

    // ════════════════════════════════════════════════════════════════
    // Circuit Management
    // ════════════════════════════════════════════════════════════════

    function test_SetVerificationKey_Success() public {
        uint256[2][] memory ic = _makeIC(3);

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit IZKVerifier.VerificationKeyUpdated(CIRCUIT_ID, uint64(block.timestamp));
        verifier.setVerificationKey(CIRCUIT_ID, validAlpha, validBeta, validGamma, validDelta, ic);

        assertTrue(verifier.isCircuitRegistered(CIRCUIT_ID));
        assertEq(verifier.circuitCount(), 1);
    }

    function test_SetVerificationKey_RevertsWithoutRole() public {
        uint256[2][] memory ic = _makeIC(3);

        vm.prank(alice);
        vm.expectRevert();
        verifier.setVerificationKey(CIRCUIT_ID, validAlpha, validBeta, validGamma, validDelta, ic);
    }

    function test_SetVerificationKey_RevertsZeroCircuitId() public {
        uint256[2][] memory ic = _makeIC(3);

        vm.prank(admin);
        vm.expectRevert("Zero circuit ID");
        verifier.setVerificationKey(bytes32(0), validAlpha, validBeta, validGamma, validDelta, ic);
    }

    function test_SetVerificationKey_RevertsICTooShort() public {
        uint256[2][] memory ic = _makeIC(1);

        vm.prank(admin);
        vm.expectRevert("IC must have at least 2 points");
        verifier.setVerificationKey(CIRCUIT_ID, validAlpha, validBeta, validGamma, validDelta, ic);
    }

    function test_DeactivateCircuit() public {
        uint256[2][] memory ic = _makeIC(3);
        vm.prank(admin);
        verifier.setVerificationKey(CIRCUIT_ID, validAlpha, validBeta, validGamma, validDelta, ic);

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit ZKCredentialVerifier.CircuitDeactivated(CIRCUIT_ID, uint64(block.timestamp));
        verifier.deactivateCircuit(CIRCUIT_ID);

        assertFalse(verifier.isCircuitRegistered(CIRCUIT_ID));
    }

    function test_DeactivateCircuit_RevertsIfNotActive() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ZKCredentialVerifier.CircuitNotActive.selector, CIRCUIT_ID));
        verifier.deactivateCircuit(CIRCUIT_ID);
    }

    function test_GetCircuitStats() public {
        uint256[2][] memory ic = _makeIC(3);
        vm.prank(admin);
        verifier.setVerificationKey(CIRCUIT_ID, validAlpha, validBeta, validGamma, validDelta, ic);

        (bool isActive, uint64 registeredAt, , , uint256 icLength) = verifier.getCircuitStats(CIRCUIT_ID);
        assertTrue(isActive);
        assertEq(registeredAt, uint64(block.timestamp));
        assertEq(icLength, 3);
    }

    function test_UpdateVerificationKey() public {
        uint256[2][] memory ic = _makeIC(3);
        vm.prank(admin);
        verifier.setVerificationKey(CIRCUIT_ID, validAlpha, validBeta, validGamma, validDelta, ic);

        // Update with different IC length
        uint256[2][] memory ic2 = _makeIC(4);
        vm.warp(block.timestamp + 100);
        vm.prank(admin);
        verifier.setVerificationKey(CIRCUIT_ID, validAlpha, validBeta, validGamma, validDelta, ic2);

        (, , uint64 updatedAt, , uint256 icLength) = verifier.getCircuitStats(CIRCUIT_ID);
        assertEq(icLength, 4);
        assertEq(updatedAt, uint64(block.timestamp));
        // Still 1 circuit registered (update, not new)
        assertEq(verifier.circuitCount(), 1);
    }

    // ════════════════════════════════════════════════════════════════
    // Nullifier Tracking
    // ════════════════════════════════════════════════════════════════

    function test_IsNullifierUsed_InitiallyFalse() public view {
        assertFalse(verifier.isNullifierUsed(keccak256("nullifier1")));
    }

    // ════════════════════════════════════════════════════════════════
    // Pause
    // ════════════════════════════════════════════════════════════════

    function test_Pause_Unpause() public {
        vm.prank(admin);
        verifier.pause();

        vm.prank(admin);
        verifier.unpause();
    }

    function test_Pause_RevertsWithoutRole() public {
        vm.prank(alice);
        vm.expectRevert();
        verifier.pause();
    }
}
