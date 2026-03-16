// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BN254
 * @author ZeroID Cryptography Team
 * @notice Library for BN254 (alt_bn128) elliptic curve operations used in
 *         pairing-based cryptography. Wraps the EVM precompiles at addresses
 *         0x06 (ecAdd), 0x07 (ecMul), and 0x08 (ecPairing).
 * @dev The BN254 curve is defined by y² = x³ + 3 over F_q where
 *      q = 21888242871839275222246405745257275088696311157297823662689037894645226208583.
 *      The curve has a subgroup of prime order
 *      r = 21888242871839275222246405745257275088548364400416034343698204186575808495617.
 *      G2 is defined over the extension field F_q² = F_q[u] / (u² + 1).
 */
library BN254 {
    // ──────────────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Prime field modulus q
    uint256 internal constant Q_MOD =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    /// @notice Scalar field order r (subgroup order)
    uint256 internal constant R_MOD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// @notice Generator point G1.x
    uint256 internal constant G1_X = 1;

    /// @notice Generator point G1.y
    uint256 internal constant G1_Y = 2;

    /// @notice Generator point G2.x (coefficients of the F_q² element)
    uint256 internal constant G2_X_IM =
        10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 internal constant G2_X_RE =
        11559732032986387107991004021392285783925812861821192530917403151452391805634;

    /// @notice Generator point G2.y (coefficients of the F_q² element)
    uint256 internal constant G2_Y_IM =
        8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 internal constant G2_Y_RE =
        4082367875863433681332203403145435568316851327593401208105741076214120093531;

    // ──────────────────────────────────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────────────────────────────────

    /// @notice A point on G1 (affine coordinates over F_q)
    struct G1Point {
        uint256 x;
        uint256 y;
    }

    /// @notice A point on G2 (affine coordinates over F_q²).
    ///         Each coordinate is represented as (imaginary, real) parts.
    struct G2Point {
        uint256[2] x; // [im, re]
        uint256[2] y; // [im, re]
    }

    // ──────────────────────────────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────────────────────────────

    error BN254_InvalidG1Point();
    error BN254_EcAddFailed();
    error BN254_EcMulFailed();
    error BN254_PairingFailed();
    error BN254_HashToCurveFailed();

    // ──────────────────────────────────────────────────────────────────────
    // G1 Generators
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Returns the G1 generator point
    function g1Generator() internal pure returns (G1Point memory) {
        return G1Point(G1_X, G1_Y);
    }

    /// @notice Returns the G2 generator point
    function g2Generator() internal pure returns (G2Point memory) {
        return G2Point([G2_X_IM, G2_X_RE], [G2_Y_IM, G2_Y_RE]);
    }

    /// @notice Returns the additive identity (point at infinity) for G1
    function g1Zero() internal pure returns (G1Point memory) {
        return G1Point(0, 0);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Point validation
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Returns true if the point is the identity (point at infinity)
    function isZero(G1Point memory p) internal pure returns (bool) {
        return p.x == 0 && p.y == 0;
    }

    /// @notice Validates that a G1 point lies on the curve y² = x³ + 3
    /// @dev Does NOT check subgroup membership (expensive). Use scalarMul by R_MOD for that.
    function isOnCurve(G1Point memory p) internal pure returns (bool) {
        if (isZero(p)) return true;
        if (p.x >= Q_MOD || p.y >= Q_MOD) return false;

        uint256 lhs = mulmod(p.y, p.y, Q_MOD);
        uint256 rhs = addmod(
            mulmod(p.x, mulmod(p.x, p.x, Q_MOD), Q_MOD),
            3,
            Q_MOD
        );
        return lhs == rhs;
    }

    /// @notice Validates a G1 point, reverting if invalid
    function validateG1(G1Point memory p) internal pure {
        if (!isOnCurve(p)) revert BN254_InvalidG1Point();
    }

    // ──────────────────────────────────────────────────────────────────────
    // Arithmetic – G1
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Computes P + Q on G1 using the ecAdd precompile (0x06)
    function ecAdd(
        G1Point memory p,
        G1Point memory q
    ) internal view returns (G1Point memory r) {
        uint256[4] memory input;
        input[0] = p.x;
        input[1] = p.y;
        input[2] = q.x;
        input[3] = q.y;

        bool success;
        assembly {
            success := staticcall(gas(), 0x06, input, 0x80, r, 0x40)
        }
        if (!success) revert BN254_EcAddFailed();
    }

    /// @notice Computes s * P on G1 using the ecMul precompile (0x07)
    function ecMul(
        G1Point memory p,
        uint256 s
    ) internal view returns (G1Point memory r) {
        uint256[3] memory input;
        input[0] = p.x;
        input[1] = p.y;
        input[2] = s;

        bool success;
        assembly {
            success := staticcall(gas(), 0x07, input, 0x60, r, 0x40)
        }
        if (!success) revert BN254_EcMulFailed();
    }

    /// @notice Computes P - Q on G1 (point subtraction via negation)
    function ecSub(
        G1Point memory p,
        G1Point memory q
    ) internal view returns (G1Point memory) {
        return ecAdd(p, negate(q));
    }

    /// @notice Negates a G1 point: -P = (x, q - y)
    function negate(G1Point memory p) internal pure returns (G1Point memory) {
        if (isZero(p)) return g1Zero();
        return G1Point(p.x, Q_MOD - (p.y % Q_MOD));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Pairing operations
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Checks e(a1, b1) * e(a2, b2) == 1 (product of pairings)
    /// @dev Uses the ecPairing precompile (0x08). Returns true iff the pairing
    ///      product equals the identity in G_T.
    function pairing2(
        G1Point memory a1,
        G2Point memory b1,
        G1Point memory a2,
        G2Point memory b2
    ) internal view returns (bool) {
        uint256[12] memory input;
        input[0] = a1.x;
        input[1] = a1.y;
        input[2] = b1.x[0];
        input[3] = b1.x[1];
        input[4] = b1.y[0];
        input[5] = b1.y[1];
        input[6] = a2.x;
        input[7] = a2.y;
        input[8] = b2.x[0];
        input[9] = b2.x[1];
        input[10] = b2.y[0];
        input[11] = b2.y[1];

        uint256[1] memory result;
        bool success;
        assembly {
            success := staticcall(gas(), 0x08, input, 0x180, result, 0x20)
        }
        if (!success) revert BN254_PairingFailed();
        return result[0] == 1;
    }

    /// @notice Batch pairing check for N pairs: ∏ e(ai, bi) == 1
    /// @param g1Points Array of G1 points
    /// @param g2Points Array of G2 points (must match length of g1Points)
    function pairingBatch(
        G1Point[] memory g1Points,
        G2Point[] memory g2Points
    ) internal view returns (bool) {
        require(g1Points.length == g2Points.length, "BN254: length mismatch");
        uint256 n = g1Points.length;
        uint256 inputLen = n * 6; // 6 uint256 words per pair

        uint256[] memory input = new uint256[](inputLen);
        for (uint256 i = 0; i < n; i++) {
            uint256 offset = i * 6;
            input[offset + 0] = g1Points[i].x;
            input[offset + 1] = g1Points[i].y;
            input[offset + 2] = g2Points[i].x[0];
            input[offset + 3] = g2Points[i].x[1];
            input[offset + 4] = g2Points[i].y[0];
            input[offset + 5] = g2Points[i].y[1];
        }

        uint256[1] memory result;
        bool success;
        uint256 inputBytes = inputLen * 32;
        assembly {
            // dynamic array data starts 32 bytes after the pointer
            let dataPtr := add(input, 0x20)
            success := staticcall(gas(), 0x08, dataPtr, inputBytes, result, 0x20)
        }
        if (!success) revert BN254_PairingFailed();
        return result[0] == 1;
    }

    /// @notice Simple pairing equality check: e(a, b) == e(c, d)
    ///         Implemented as e(a, b) * e(-c, d) == 1
    function pairingCheck(
        G1Point memory a,
        G2Point memory b,
        G1Point memory c,
        G2Point memory d
    ) internal view returns (bool) {
        return pairing2(a, b, negate(c), d);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Hash to curve (try-and-increment)
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Maps an arbitrary message to a G1 point using try-and-increment.
    /// @dev This is NOT constant-time in the number of iterations but is safe
    ///      for on-chain use where execution is deterministic and public.
    /// @param domain Domain separation tag
    /// @param message The message bytes to hash
    /// @return A valid G1 point on the BN254 curve
    function hashToG1(
        bytes memory domain,
        bytes memory message
    ) internal view returns (G1Point memory) {
        uint256 ctr = 0;
        while (ctr < 256) {
            // Hash (domain || message || counter) to get a candidate x
            uint256 candidateX = uint256(
                keccak256(abi.encodePacked(domain, message, uint8(ctr)))
            ) % Q_MOD;

            // Compute y² = x³ + 3
            uint256 x3 = mulmod(candidateX, mulmod(candidateX, candidateX, Q_MOD), Q_MOD);
            uint256 ySq = addmod(x3, 3, Q_MOD);

            // Attempt square root via Tonelli-Shanks shortcut for q ≡ 3 (mod 4)
            // y = ySq^((q+1)/4) mod q
            uint256 y = _modExp(ySq, (Q_MOD + 1) / 4, Q_MOD);

            if (mulmod(y, y, Q_MOD) == ySq) {
                // Canonicalize: pick the smaller of y and q - y
                if (y > Q_MOD / 2) {
                    y = Q_MOD - y;
                }
                G1Point memory candidate = G1Point(candidateX, y);
                // Multiply by cofactor (cofactor = 1 for BN254 G1, so this is identity)
                return candidate;
            }
            unchecked { ++ctr; }
        }
        revert BN254_HashToCurveFailed();
    }

    /// @notice Hash a uint256 value to G1 with a domain tag
    function hashUintToG1(
        bytes memory domain,
        uint256 value
    ) internal view returns (G1Point memory) {
        return hashToG1(domain, abi.encodePacked(value));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Multi-scalar multiplication (MSM) – naive but correct
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Computes ∑ scalars[i] * points[i]
    /// @dev O(n) ecMul + O(n) ecAdd. Use only for moderate n.
    function multiScalarMul(
        G1Point[] memory points,
        uint256[] memory scalars
    ) internal view returns (G1Point memory result) {
        require(points.length == scalars.length, "BN254: MSM length mismatch");
        result = g1Zero();
        for (uint256 i = 0; i < points.length; i++) {
            G1Point memory term = ecMul(points[i], scalars[i]);
            result = ecAdd(result, term);
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Modular exponentiation via the EVM precompile at 0x05
    function _modExp(
        uint256 base,
        uint256 exponent,
        uint256 modulus
    ) private view returns (uint256 result) {
        // The modexp precompile expects (Bsize, Esize, Msize, B, E, M)
        bytes memory input = abi.encodePacked(
            uint256(32), // base length
            uint256(32), // exponent length
            uint256(32), // modulus length
            base,
            exponent,
            modulus
        );
        bytes memory output = new bytes(32);
        bool success;
        assembly {
            success := staticcall(
                gas(),
                0x05,
                add(input, 0x20),
                mload(input),
                add(output, 0x20),
                0x20
            )
        }
        require(success, "BN254: modexp failed");
        result = abi.decode(output, (uint256));
    }

    /// @notice Compute the additive inverse of a scalar in F_r
    function scalarNegate(uint256 s) internal pure returns (uint256) {
        if (s == 0) return 0;
        return R_MOD - (s % R_MOD);
    }

    /// @notice Compute the multiplicative inverse of a scalar in F_r
    ///         via Fermat's little theorem: s^{r-2} mod r
    function scalarInverse(uint256 s) internal view returns (uint256) {
        require(s != 0, "BN254: zero has no inverse");
        return _modExp(s, R_MOD - 2, R_MOD);
    }

    /// @notice Encode a G1 point to bytes (64 bytes, big-endian)
    function encodeG1(G1Point memory p) internal pure returns (bytes memory) {
        return abi.encodePacked(p.x, p.y);
    }
}
