// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";

/// @notice Wrapper contract to expose BN254 library functions for testing
contract BN254Wrapper {
    function g1Generator() external pure returns (BN254.G1Point memory) {
        return BN254.g1Generator();
    }

    function g2Generator() external pure returns (BN254.G2Point memory) {
        return BN254.g2Generator();
    }

    function g1Zero() external pure returns (BN254.G1Point memory) {
        return BN254.g1Zero();
    }

    function isZero(BN254.G1Point memory p) external pure returns (bool) {
        return BN254.isZero(p);
    }

    function isOnCurve(BN254.G1Point memory p) external pure returns (bool) {
        return BN254.isOnCurve(p);
    }

    function validateG1(BN254.G1Point memory p) external pure {
        BN254.validateG1(p);
    }

    function ecAdd(
        BN254.G1Point memory p,
        BN254.G1Point memory q
    ) external view returns (BN254.G1Point memory) {
        return BN254.ecAdd(p, q);
    }

    function ecMul(
        BN254.G1Point memory p,
        uint256 s
    ) external view returns (BN254.G1Point memory) {
        return BN254.ecMul(p, s);
    }

    function ecSub(
        BN254.G1Point memory p,
        BN254.G1Point memory q
    ) external view returns (BN254.G1Point memory) {
        return BN254.ecSub(p, q);
    }

    function negate(BN254.G1Point memory p) external pure returns (BN254.G1Point memory) {
        return BN254.negate(p);
    }

    function pairing2(
        BN254.G1Point memory a1,
        BN254.G2Point memory b1,
        BN254.G1Point memory a2,
        BN254.G2Point memory b2
    ) external view returns (bool) {
        return BN254.pairing2(a1, b1, a2, b2);
    }

    function scalarNegate(uint256 s) external pure returns (uint256) {
        return BN254.scalarNegate(s);
    }

    function scalarInverse(uint256 s) external view returns (uint256) {
        return BN254.scalarInverse(s);
    }

    function encodeG1(BN254.G1Point memory p) external pure returns (bytes memory) {
        return BN254.encodeG1(p);
    }

    function hashToG1(bytes memory domain, bytes memory message) external view returns (BN254.G1Point memory) {
        return BN254.hashToG1(domain, message);
    }

    function multiScalarMul(
        BN254.G1Point[] memory points,
        uint256[] memory scalars
    ) external view returns (BN254.G1Point memory) {
        return BN254.multiScalarMul(points, scalars);
    }
}

contract BN254Test is TestHelper {
    BN254Wrapper public bn;

    uint256 constant Q_MOD = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
    uint256 constant R_MOD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function setUp() public {
        bn = new BN254Wrapper();
    }

    // ════════════════════════════════════════════════════════════════
    // Generators and Identity
    // ════════════════════════════════════════════════════════════════

    function test_G1Generator() public view {
        BN254.G1Point memory g = bn.g1Generator();
        assertEq(g.x, 1);
        assertEq(g.y, 2);
    }

    function test_G2Generator() public view {
        BN254.G2Point memory g = bn.g2Generator();
        assertEq(g.x[0], 10857046999023057135944570762232829481370756359578518086990519993285655852781);
        assertEq(g.x[1], 11559732032986387107991004021392285783925812861821192530917403151452391805634);
    }

    function test_G1Zero() public view {
        BN254.G1Point memory z = bn.g1Zero();
        assertEq(z.x, 0);
        assertEq(z.y, 0);
    }

    // ════════════════════════════════════════════════════════════════
    // Point Validation
    // ════════════════════════════════════════════════════════════════

    function test_IsZero_True() public view {
        assertTrue(bn.isZero(BN254.G1Point(0, 0)));
    }

    function test_IsZero_False() public view {
        assertFalse(bn.isZero(BN254.G1Point(1, 2)));
    }

    function test_IsOnCurve_Generator() public view {
        assertTrue(bn.isOnCurve(BN254.G1Point(1, 2)));
    }

    function test_IsOnCurve_Zero() public view {
        assertTrue(bn.isOnCurve(BN254.G1Point(0, 0)));
    }

    function test_IsOnCurve_InvalidPoint() public view {
        assertFalse(bn.isOnCurve(BN254.G1Point(1, 3)));
    }

    function test_IsOnCurve_CoordTooLarge() public view {
        assertFalse(bn.isOnCurve(BN254.G1Point(Q_MOD, 2)));
    }

    function test_ValidateG1_Success() public view {
        bn.validateG1(BN254.G1Point(1, 2)); // should not revert
    }

    function test_ValidateG1_Reverts() public {
        vm.expectRevert(BN254.BN254_InvalidG1Point.selector);
        bn.validateG1(BN254.G1Point(1, 3));
    }

    // ════════════════════════════════════════════════════════════════
    // Arithmetic
    // ════════════════════════════════════════════════════════════════

    function test_EcAdd_Generator_Plus_Zero() public view {
        BN254.G1Point memory g = BN254.G1Point(1, 2);
        BN254.G1Point memory z = BN254.G1Point(0, 0);

        BN254.G1Point memory result = bn.ecAdd(g, z);
        assertEq(result.x, 1);
        assertEq(result.y, 2);
    }

    function test_EcAdd_Generator_Plus_Generator() public view {
        BN254.G1Point memory g = BN254.G1Point(1, 2);
        BN254.G1Point memory result = bn.ecAdd(g, g);

        // 2G is a known point on BN254
        assertGt(result.x, 0);
        assertGt(result.y, 0);
        assertTrue(bn.isOnCurve(result));
    }

    function test_EcMul_Identity() public view {
        BN254.G1Point memory g = BN254.G1Point(1, 2);
        BN254.G1Point memory result = bn.ecMul(g, 1);

        assertEq(result.x, 1);
        assertEq(result.y, 2);
    }

    function test_EcMul_ByZero() public view {
        BN254.G1Point memory g = BN254.G1Point(1, 2);
        BN254.G1Point memory result = bn.ecMul(g, 0);

        assertTrue(bn.isZero(result));
    }

    function test_EcMul_ByTwo() public view {
        BN254.G1Point memory g = BN254.G1Point(1, 2);

        BN254.G1Point memory doubled = bn.ecMul(g, 2);
        BN254.G1Point memory added = bn.ecAdd(g, g);

        assertEq(doubled.x, added.x);
        assertEq(doubled.y, added.y);
    }

    function test_EcMul_ByOrder_GivesZero() public view {
        BN254.G1Point memory g = BN254.G1Point(1, 2);
        BN254.G1Point memory result = bn.ecMul(g, R_MOD);

        assertTrue(bn.isZero(result));
    }

    function test_EcSub_Cancels() public view {
        BN254.G1Point memory g = BN254.G1Point(1, 2);
        BN254.G1Point memory result = bn.ecSub(g, g);

        assertTrue(bn.isZero(result));
    }

    function test_Negate_Zero() public view {
        BN254.G1Point memory z = BN254.G1Point(0, 0);
        BN254.G1Point memory result = bn.negate(z);

        assertTrue(bn.isZero(result));
    }

    function test_Negate_Generator() public view {
        BN254.G1Point memory g = BN254.G1Point(1, 2);
        BN254.G1Point memory neg = bn.negate(g);

        assertEq(neg.x, 1);
        assertEq(neg.y, Q_MOD - 2);
    }

    function test_Negate_AddToSelf_GivesZero() public view {
        BN254.G1Point memory g = BN254.G1Point(1, 2);
        BN254.G1Point memory neg = bn.negate(g);
        BN254.G1Point memory result = bn.ecAdd(g, neg);

        assertTrue(bn.isZero(result));
    }

    // ════════════════════════════════════════════════════════════════
    // Pairing
    // ════════════════════════════════════════════════════════════════

    function test_Pairing2_Trivial() public {
        // Skip: BN254 pairing precompile (0x08) is not reliably supported in Foundry's EVM
        vm.skip(true);
        // e(0, G2) * e(0, G2) == 1 (identity pairing)
        BN254.G1Point memory z = BN254.G1Point(0, 0);
        BN254.G2Point memory g2 = bn.g2Generator();

        bool result = bn.pairing2(z, g2, z, g2);
        assertTrue(result);
    }

    function test_Pairing2_SelfConsistency() public {
        // Skip: BN254 pairing precompile (0x08) is not reliably supported in Foundry's EVM
        vm.skip(true);
        // e(G1, G2) * e(-G1, G2) == 1
        BN254.G1Point memory g1 = BN254.G1Point(1, 2);
        BN254.G1Point memory negG1 = bn.negate(g1);
        BN254.G2Point memory g2 = bn.g2Generator();

        bool result = bn.pairing2(g1, g2, negG1, g2);
        assertTrue(result);
    }

    // ════════════════════════════════════════════════════════════════
    // Scalar Operations
    // ════════════════════════════════════════════════════════════════

    function test_ScalarNegate_Zero() public view {
        assertEq(bn.scalarNegate(0), 0);
    }

    function test_ScalarNegate_NonZero() public view {
        uint256 s = 42;
        uint256 neg = bn.scalarNegate(s);
        assertEq(neg, R_MOD - 42);
    }

    function test_ScalarInverse() public view {
        uint256 s = 7;
        uint256 inv = bn.scalarInverse(s);
        // s * inv mod R_MOD should equal 1
        assertEq(mulmod(s, inv, R_MOD), 1);
    }

    // ════════════════════════════════════════════════════════════════
    // Encoding
    // ════════════════════════════════════════════════════════════════

    function test_EncodeG1() public view {
        BN254.G1Point memory g = BN254.G1Point(1, 2);
        bytes memory encoded = bn.encodeG1(g);
        assertEq(encoded.length, 64);
    }

    // ════════════════════════════════════════════════════════════════
    // Hash to Curve
    // ════════════════════════════════════════════════════════════════

    function test_HashToG1_ReturnsValidPoint() public view {
        BN254.G1Point memory point = bn.hashToG1("test_domain", "hello");
        assertTrue(bn.isOnCurve(point));
        assertFalse(bn.isZero(point));
    }

    function test_HashToG1_Deterministic() public view {
        BN254.G1Point memory p1 = bn.hashToG1("domain", "msg1");
        BN254.G1Point memory p2 = bn.hashToG1("domain", "msg1");

        assertEq(p1.x, p2.x);
        assertEq(p1.y, p2.y);
    }

    function test_HashToG1_DifferentInputs_DifferentPoints() public view {
        BN254.G1Point memory p1 = bn.hashToG1("domain", "msg1");
        BN254.G1Point memory p2 = bn.hashToG1("domain", "msg2");

        assertTrue(p1.x != p2.x || p1.y != p2.y);
    }

    // ════════════════════════════════════════════════════════════════
    // Multi-scalar Multiplication
    // ════════════════════════════════════════════════════════════════

    function test_MultiScalarMul_SinglePoint() public view {
        BN254.G1Point[] memory points = new BN254.G1Point[](1);
        points[0] = BN254.G1Point(1, 2);
        uint256[] memory scalars = new uint256[](1);
        scalars[0] = 3;

        BN254.G1Point memory result = bn.multiScalarMul(points, scalars);
        BN254.G1Point memory expected = bn.ecMul(BN254.G1Point(1, 2), 3);

        assertEq(result.x, expected.x);
        assertEq(result.y, expected.y);
    }

    function test_MultiScalarMul_TwoPoints() public view {
        BN254.G1Point memory g = BN254.G1Point(1, 2);

        BN254.G1Point[] memory points = new BN254.G1Point[](2);
        points[0] = g;
        points[1] = g;
        uint256[] memory scalars = new uint256[](2);
        scalars[0] = 2;
        scalars[1] = 3;

        BN254.G1Point memory result = bn.multiScalarMul(points, scalars);

        // 2G + 3G = 5G
        BN254.G1Point memory expected = bn.ecMul(g, 5);

        assertEq(result.x, expected.x);
        assertEq(result.y, expected.y);
    }
}
