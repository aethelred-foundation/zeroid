// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IExponentiationVerifier} from "../interfaces/IExponentiationVerifier.sol";

/**
 * @title WesolowskiVerifier
 * @author ZeroID Cryptography Team
 * @notice On-chain verification of Wesolowski proofs of exponentiation using the
 *         EVM MODEXP precompile (address 0x05).
 *
 * @dev Given a claim V' = V^x mod N, the prover supplies quotient Q where:
 *        Q = V^{floor(x / l)} mod N
 *      and l = H(V, V') | 1 is a Fiat-Shamir challenge derived from the claim
 *      only (base and result), NOT from Q, avoiding a circular dependency.
 *
 *      The verifier checks:
 *        Q^l · V^r ≡ V' (mod N)
 *      where r = x mod l (pre-computed by the caller and validated here).
 *
 *      Computation steps:
 *        1. Re-derive l = H(V, V') | 1 (Fiat-Shamir, independent of caller and Q)
 *        2. MODEXP: Q^l mod N
 *        3. MODEXP: V^r mod N
 *        4. Modular multiplication: (Q^l · V^r) mod N, using 128-bit limb
 *           schoolbook multiplication followed by MODEXP reduction
 *        5. Compare with V'
 *
 *      The 128-bit limb multiplication reduces a 256×256-byte multiply from
 *      65,536 byte-level iterations to 256 limb-level iterations (16×16 limbs),
 *      keeping gas under typical block limits.
 */
contract WesolowskiVerifier is IExponentiationVerifier {
    error ModexpCallFailed();

    uint256 private constant LIMB_MASK = type(uint128).max;
    uint256 private constant LIMB_SIZE = 16; // bytes per 128-bit limb

    /// @inheritdoc IExponentiationVerifier
    function verifyExponentiation(
        bytes calldata base,
        bytes calldata result,
        uint256 remainder,
        bytes calldata quotient,
        bytes calldata modulus
    ) external view override returns (bool valid) {
        uint256 modLen = modulus.length;
        if (modLen == 0) return false;
        if (base.length != modLen || result.length != modLen || quotient.length != modLen) {
            return false;
        }

        // 1. Re-derive Fiat-Shamir challenge: l = H(V, V') | 1
        //    Per Wesolowski's protocol, l is derived from the claim (base, result)
        //    BEFORE the quotient Q is known, avoiding a circular dependency.
        uint256 l = uint256(keccak256(abi.encodePacked(
            keccak256(base),
            keccak256(result)
        ))) | 1;

        // 2. Compute Q^l mod N  (MODEXP)
        bytes memory ql = _modexp(quotient, _toBytes32(l), modulus);

        // 3. Compute V^r mod N  (MODEXP)
        bytes memory vr = _modexp(base, _toBytes32(remainder), modulus);

        // 4. Compute (Q^l · V^r) mod N
        bytes memory lhs = _modmul(ql, vr, modulus);

        // 5. Compare: lhs == V'
        return keccak256(lhs) == keccak256(result);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Internal: MODEXP precompile wrapper
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @dev Call the MODEXP precompile: base^exp mod modulus.
     *      Input layout (EIP-198):
     *        [32 bytes] length of base
     *        [32 bytes] length of exponent
     *        [32 bytes] length of modulus
     *        [baseLen bytes] base
     *        [expLen bytes]  exponent
     *        [modLen bytes]  modulus
     */
    function _modexp(
        bytes memory base_,
        bytes memory exponent_,
        bytes calldata modulus_
    ) internal view returns (bytes memory out) {
        uint256 baseLen = base_.length;
        uint256 expLen = exponent_.length;
        uint256 modLen = modulus_.length;

        bytes memory input = abi.encodePacked(
            bytes32(baseLen),
            bytes32(expLen),
            bytes32(modLen),
            base_,
            exponent_,
            modulus_
        );

        out = new bytes(modLen);
        bool success;
        assembly {
            success := staticcall(
                gas(),
                0x05,
                add(input, 0x20),
                mload(input),
                add(out, 0x20),
                modLen
            )
        }
        if (!success) revert ModexpCallFailed();
    }

    // ──────────────────────────────────────────────────────────────────────
    // Internal: modular multiplication via 128-bit limb schoolbook multiply
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @dev Compute (a · b) mod n using:
     *      1. 128-bit limb schoolbook multiplication → double-width product
     *      2. MODEXP(product, 1, n) → reduction mod n
     *
     *      For 256-byte inputs: 16 limbs × 16 limbs = 256 iterations
     *      (vs 65,536 for byte-level), keeping gas practical.
     */
    function _modmul(
        bytes memory a,
        bytes memory b,
        bytes calldata n
    ) internal view returns (bytes memory) {
        bytes memory product = _bigMul(a, b);

        // Reduce: product mod n via MODEXP(product, 1, n)
        bytes memory one = new bytes(1);
        one[0] = 0x01;

        uint256 modLen = n.length;
        bytes memory input = abi.encodePacked(
            bytes32(product.length),
            bytes32(uint256(1)),
            bytes32(modLen),
            product,
            one,
            n
        );

        bytes memory out = new bytes(modLen);
        bool success;
        assembly {
            success := staticcall(
                gas(),
                0x05,
                add(input, 0x20),
                mload(input),
                add(out, 0x20),
                modLen
            )
        }
        if (!success) revert ModexpCallFailed();
        return out;
    }

    /**
     * @dev Schoolbook multiplication of two big-endian byte arrays using 128-bit
     *      (16-byte) limbs. Two 128-bit values multiply into at most 256 bits,
     *      which fits in a single uint256 without overflow.
     *
     *      Overflow safety proof:
     *        max(aLimb * bLimb + carry + current)
     *        = (2^128-1)^2 + (2^128-1) + (2^128-1)
     *        = 2^256 - 2^129 + 1 + 2^129 - 2
     *        = 2^256 - 1  ← fits in uint256
     */
    function _bigMul(bytes memory a, bytes memory b) internal pure returns (bytes memory) {
        uint256 aLen = a.length;
        uint256 bLen = b.length;
        uint256 rLen = aLen + bLen;

        // Pad to multiple of LIMB_SIZE
        uint256 aLimbs = (aLen + LIMB_SIZE - 1) / LIMB_SIZE;
        uint256 bLimbs = (bLen + LIMB_SIZE - 1) / LIMB_SIZE;
        uint256 rLimbs = aLimbs + bLimbs;

        // Work in limb space (LSB-first uint256 array, each holding 128 bits)
        uint256[] memory aL = _toLimbs(a);
        uint256[] memory bL = _toLimbs(b);
        uint256[] memory rL = new uint256[](rLimbs);

        for (uint256 i = 0; i < aLimbs; i++) {
            uint256 carry = 0;
            uint256 aVal = aL[i];
            for (uint256 j = 0; j < bLimbs; j++) {
                uint256 prod = aVal * bL[j] + rL[i + j] + carry;
                rL[i + j] = prod & LIMB_MASK;
                carry = prod >> 128;
            }
            rL[i + bLimbs] += carry;
        }

        return _fromLimbs(rL, rLen);
    }

    /**
     * @dev Convert big-endian bytes to LSB-first array of 128-bit limbs.
     *      Limb 0 is the least significant 16 bytes (end of array).
     */
    function _toLimbs(bytes memory data) internal pure returns (uint256[] memory limbs) {
        uint256 dataLen = data.length;
        uint256 numLimbs = (dataLen + LIMB_SIZE - 1) / LIMB_SIZE;
        limbs = new uint256[](numLimbs);

        // Read 16 bytes at a time from the end (LSB first)
        for (uint256 i = 0; i < numLimbs; i++) {
            uint256 limbValue;
            // Byte offset of the start of this limb (big-endian)
            // Limb i covers bytes [dataLen - 16*(i+1) .. dataLen - 16*i - 1]
            uint256 startByte;
            uint256 limbBytes = LIMB_SIZE;

            if (dataLen >= LIMB_SIZE * (i + 1)) {
                startByte = dataLen - LIMB_SIZE * (i + 1);
            } else {
                // Partial limb at the MSB end
                startByte = 0;
                limbBytes = dataLen - LIMB_SIZE * i;
            }

            // Load byte-by-byte (safe and clear for any alignment)
            for (uint256 b = 0; b < limbBytes; b++) {
                limbValue |= uint256(uint8(data[startByte + b])) << (8 * (limbBytes - 1 - b));
            }

            limbs[i] = limbValue;
        }
    }

    /**
     * @dev Convert LSB-first array of 128-bit limbs to big-endian bytes.
     */
    function _fromLimbs(uint256[] memory limbs, uint256 resultLen) internal pure returns (bytes memory out) {
        out = new bytes(resultLen);
        uint256 numLimbs = limbs.length;

        for (uint256 i = 0; i < numLimbs; i++) {
            uint256 val = limbs[i];
            // Write 16 bytes at the end for limb i (LSB first = end of array)
            uint256 startByte;
            uint256 limbBytes = LIMB_SIZE;

            if (resultLen >= LIMB_SIZE * (i + 1)) {
                startByte = resultLen - LIMB_SIZE * (i + 1);
            } else {
                startByte = 0;
                limbBytes = resultLen - LIMB_SIZE * i;
            }

            for (uint256 b = 0; b < limbBytes; b++) {
                out[startByte + b] = bytes1(uint8((val >> (8 * (limbBytes - 1 - b))) & 0xFF));
            }
        }
    }

    /**
     * @dev Convert a uint256 to a 32-byte big-endian byte array.
     */
    function _toBytes32(uint256 value) internal pure returns (bytes memory out) {
        out = new bytes(32);
        assembly {
            mstore(add(out, 0x20), value)
        }
    }
}
