// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IExponentiationVerifier
 * @author ZeroID Cryptography Team
 * @notice Interface for verifying Wesolowski proofs of exponentiation.
 *
 * @dev A Wesolowski proof demonstrates that `result = base^exponent mod modulus`
 *      without the verifier performing the full exponentiation. The prover supplies
 *      a quotient Q such that:
 *
 *        Q = base^{floor(exponent / l)} mod modulus
 *
 *      where l = H(base, result) | 1 is a Fiat-Shamir challenge derived from the
 *      claim alone (base and result), NOT from the quotient Q. This avoids a
 *      circular dependency during proof construction. The verifier checks:
 *
 *        Q^l · base^r ≡ result  (mod modulus)
 *
 *      where r = exponent mod l. This requires only two modular exponentiations
 *      (via the MODEXP precompile at 0x05) and one modular multiplication.
 *
 *      The caller (AccumulatorRevocation) pre-computes r = exponent mod l because:
 *        - For single credentials, exponent fits in uint256 and r = prime % l
 *        - For batch revocations, exponent is a product of primes that may exceed
 *          uint256; r is computed incrementally via mulmod(r, p_i, l) on-chain
 *
 *      The verifier independently re-derives l from (base, result) to prevent
 *      the caller from choosing a weak challenge.
 */
interface IExponentiationVerifier {
    /// @notice Verify a Wesolowski proof of exponentiation.
    /// @param base      The base value V (big-endian, modulus-sized)
    /// @param result    The claimed result V' = V^exponent mod modulus (big-endian)
    /// @param remainder Pre-computed r = exponent mod l, where l = H(base, result) | 1
    /// @param quotient  Wesolowski quotient Q (big-endian, modulus-sized)
    /// @param modulus   RSA modulus N (big-endian)
    /// @return valid    True if Q^l · V^r ≡ V' (mod N), with l re-derived internally
    function verifyExponentiation(
        bytes calldata base,
        bytes calldata result,
        uint256 remainder,
        bytes calldata quotient,
        bytes calldata modulus
    ) external view returns (bool valid);
}
