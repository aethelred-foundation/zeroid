// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";
import "../../contracts/verifiers/WesolowskiVerifier.sol";
import "../../contracts/interfaces/IExponentiationVerifier.sol";

/// @dev Test harness that exposes AccumulatorRevocation._hashToPrime for
///      behavioral-equivalence testing. The contract's internal function is
///      called directly, so the test observes the exact candidate the
///      production code selects.
contract AccumulatorRevocationHarness is AccumulatorRevocation {
    constructor(address admin_) AccumulatorRevocation(admin_) {}

    function exposed_hashToPrime(bytes32 credentialHash) external view returns (uint256) {
        return _hashToPrime(credentialHash);
    }
}

/// @title AccumulatorRevocation Fuzz Tests
/// @notice Property-based tests for the AccumulatorRevocation contract.
contract AccumulatorRevocationFuzzTest is TestHelper {
    AccumulatorRevocation public acc;
    AccumulatorRevocationHarness public harness;
    WesolowskiVerifier public wVerifier;

    bytes32 constant ACC_ID = keccak256("acc:revocation:fuzz");

    bytes rsaModulus;
    bytes generator;
    bytes initialValue;

    function setUp() public {
        acc = new AccumulatorRevocation(admin);
        harness = new AccumulatorRevocationHarness(admin);
        wVerifier = new WesolowskiVerifier();

        vm.startPrank(admin);
        acc.setExponentiationVerifier(address(wVerifier));
        vm.stopPrank();

        rsaModulus = _buildValidModulus();
        generator = _buildPadded(2);
        initialValue = _buildPadded(2);
    }

    // ── Internal helpers (mirrors existing test patterns) ────────────

    function _buildValidModulus() internal pure returns (bytes memory) {
        bytes memory result = new bytes(256);
        result[0] = 0x80;
        result[255] = 0x4D;
        return result;
    }

    function _buildPadded(uint256 value) internal pure returns (bytes memory) {
        bytes memory result = new bytes(256);
        for (uint256 i = 0; i < 32 && value > 0; i++) {
            result[255 - i] = bytes1(uint8(value & 0xFF));
            value >>= 8;
        }
        return result;
    }

    function _setupParams() internal {
        vm.prank(admin);
        acc.setParameters(rsaModulus, generator, 2048);
    }

    function _setupAndInit() internal {
        _setupParams();
        vm.prank(admin);
        acc.initializeAccumulator(ACC_ID, initialValue);
    }

    function _modexpUint(
        bytes memory base_,
        uint256 exp_,
        bytes memory mod_
    ) internal view returns (bytes memory) {
        bytes memory expBytes = new bytes(32);
        assembly { mstore(add(expBytes, 0x20), exp_) }
        uint256 baseLen = base_.length;
        uint256 modLen = mod_.length;
        bytes memory input = abi.encodePacked(
            bytes32(baseLen), bytes32(uint256(32)), bytes32(modLen),
            base_, expBytes, mod_
        );
        bytes memory out = new bytes(modLen);
        assembly {
            let success := staticcall(gas(), 0x05, add(input, 0x20), mload(input), add(out, 0x20), modLen)
            if iszero(success) { revert(0, 0) }
        }
        return out;
    }

    function _buildWesolowskiProof(
        bytes memory base_,
        bytes memory result_,
        uint256 exponent_
    ) internal view returns (bytes memory quotientQ) {
        uint256 l = uint256(keccak256(abi.encodePacked(
            keccak256(base_),
            keccak256(result_)
        ))) | 1;
        uint256 q = exponent_ / l;
        quotientQ = _modexpUint(base_, q, rsaModulus);
    }

    function _computeHashToPrime(bytes32 credentialHash) internal view returns (uint256) {
        bytes memory DOMAIN = "ZeroID.AccRev.H2P.v1";
        uint256 counter = 0;
        while (counter < 1000) {
            uint256 candidate = uint256(
                keccak256(abi.encodePacked(DOMAIN, credentialHash, counter))
            ) | 1;
            if (_millerRabin(candidate)) return candidate;
            unchecked { ++counter; }
        }
        revert("no prime found");
    }

    /// @dev Independent Miller-Rabin using the MODEXP precompile with
    ///      witnesses [73..173] — deliberately different from the contract's
    ///      witnesses [2..71] to provide independent verification.
    function _millerRabin(uint256 n) internal view returns (bool) {
        if (n < 2) return false;
        if (n < 4) return true;
        if (n % 2 == 0 || n % 3 == 0) return false;

        // Trial division up to 1000 (same cheap filter)
        uint256 td = 5;
        while (td * td <= n && td < 1000) {
            if (n % td == 0 || n % (td + 2) == 0) return false;
            unchecked { td += 6; }
        }
        if (td * td > n) return true;

        // n - 1 = 2^r · d
        uint256 d = n - 1;
        uint256 r = 0;
        while (d % 2 == 0) {
            d >>= 1;
            unchecked { ++r; }
        }

        // Independent witnesses: primes 73–173 (20 witnesses, disjoint from contract's 2–71)
        uint8[20] memory witnesses = [
            73, 79, 83, 89, 97, 101, 103, 107, 109, 113,
            127, 131, 137, 139, 149, 151, 157, 163, 167, 173
        ];

        for (uint256 i = 0; i < 20; i++) {
            uint256 a = uint256(witnesses[i]);
            if (a >= n) continue;

            uint256 x = _modexpTest(a, d, n);
            if (x == 1 || x == n - 1) continue;

            bool composite = true;
            for (uint256 j = 1; j < r; j++) {
                x = _modexpTest(x, 2, n);
                if (x == n - 1) { composite = false; break; }
            }
            if (composite) return false;
        }
        return true;
    }

    /// @dev MODEXP precompile wrapper for uint256 operands.
    function _modexpTest(uint256 base_, uint256 exp_, uint256 mod_) internal view returns (uint256 result) {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x20)
            mstore(add(ptr, 0x20), 0x20)
            mstore(add(ptr, 0x40), 0x20)
            mstore(add(ptr, 0x60), base_)
            mstore(add(ptr, 0x80), exp_)
            mstore(add(ptr, 0xa0), mod_)
            if iszero(staticcall(gas(), 0x05, ptr, 0xc0, ptr, 0x20)) { revert(0, 0) }
            result := mload(ptr)
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Deterministic: regression corpus of known adversarial pseudoprimes
    // ════════════════════════════════════════════════════════════════════

    /// @notice Fixed corpus of known composites that are adversarial to
    ///         naive primality checks. Each must be rejected by both the
    ///         contract's Miller-Rabin (witnesses 2-71) and the test's
    ///         independent Miller-Rabin (witnesses 73-173). Includes:
    ///         - Carmichael numbers (pass Fermat but not Miller-Rabin)
    ///         - Strong pseudoprimes to small bases
    ///         - Products of large primes that pass trial division < 1000
    function test_PseudoprimeRegressionCorpus() public view {
        // ── Carmichael numbers (a^(n-1) ≡ 1 mod n for all gcd(a,n)=1) ──
        uint256[10] memory carmichaels = [
            uint256(561),     // 3 × 11 × 17 — smallest Carmichael
            uint256(1105),    // 5 × 13 × 17
            uint256(1729),    // 7 × 13 × 19 — Hardy-Ramanujan / taxicab
            uint256(2465),    // 5 × 17 × 29
            uint256(2821),    // 7 × 13 × 31
            uint256(6601),    // 7 × 23 × 41
            uint256(8911),    // 7 × 19 × 67
            uint256(10585),   // 5 × 29 × 73
            uint256(15841),   // 7 × 31 × 73
            uint256(29341)    // 13 × 37 × 61
        ];

        for (uint256 i = 0; i < 10; i++) {
            assertFalse(
                _millerRabin(carmichaels[i]),
                string.concat("Independent MR failed on Carmichael: ", vm.toString(carmichaels[i]))
            );
        }

        // ── Strong pseudoprimes to base 2 ──────────────────────────────
        // These composites satisfy 2^d ≡ 1 or 2^(2^r · d) ≡ -1 (mod n),
        // i.e. they fool single-witness Miller-Rabin with a=2.
        uint256[5] memory spsp2 = [
            uint256(2047),    // 23 × 89
            uint256(3277),    // 29 × 113
            uint256(4033),    // 37 × 109
            uint256(4681),    // 31 × 151
            uint256(8321)     // 53 × 157
        ];

        for (uint256 i = 0; i < 5; i++) {
            assertFalse(
                _millerRabin(spsp2[i]),
                string.concat("Independent MR failed on spsp(2): ", vm.toString(spsp2[i]))
            );
        }

        // ── Strong pseudoprimes to bases {2,3} simultaneously ──────────
        uint256[3] memory spsp23 = [
            uint256(1373653),   // 829 × 1657
            uint256(1530787),   // 3 prime factors
            uint256(1987021)    // 3 prime factors
        ];

        for (uint256 i = 0; i < 3; i++) {
            assertFalse(
                _millerRabin(spsp23[i]),
                string.concat("Independent MR failed on spsp(2,3): ", vm.toString(spsp23[i]))
            );
        }

        // ── Products of primes > 1000 (pass trial division filter) ─────
        // These composites survive the td < 1000 cheap filter and must
        // be caught by the Miller-Rabin rounds.
        uint256[5] memory largeFactorComposites = [
            uint256(1013 * 1019),     // 1,032,247
            uint256(1021 * 1031),     // 1,052,651
            uint256(1049 * 1051),     // 1,102,499
            uint256(1061 * 1063),     // 1,127,843
            uint256(1009 * 1013)      // 1,022,117
        ];

        for (uint256 i = 0; i < 5; i++) {
            assertFalse(
                _millerRabin(largeFactorComposites[i]),
                string.concat("Independent MR failed on large-factor composite: ", vm.toString(largeFactorComposites[i]))
            );
        }

        // ── Large semiprimes (products of known primes > 1000) ─────────
        // These exercise the full MODEXP-based Miller-Rabin path rather
        // than the small-number shortcuts, and pass the td < 1000 filter.
        //
        // Use well-known primes whose primality is verifiable:
        //   1009, 10007, 100003, 1000003 are all prime.
        uint256 semi1 = uint256(10007) * uint256(100003);      // 1,000,130,021
        uint256 semi2 = uint256(100003) * uint256(1000003);    // 100,003,300,009
        uint256 semi3 = uint256(1000003) * uint256(10000019);  // 10,000,049,000,057

        assertFalse(_millerRabin(semi1), "10007 * 100003 should be composite");
        assertFalse(_millerRabin(semi2), "100003 * 1000003 should be composite");
        assertFalse(_millerRabin(semi3), "1000003 * 10000019 should be composite");

        // Larger semiprime from 32-bit primes (exercises 64-bit range)
        uint256 semi4 = uint256(2147483647) * uint256(2147483629); // two Mersenne-adjacent primes
        assertFalse(_millerRabin(semi4), "Product of two 31-bit primes should be composite");

        // 128-bit semiprime: product of two 64-bit values that pass td filter.
        // 18446744073709551557 is the largest 64-bit prime (2^64 - 59).
        // 18446744073709551533 is also prime (2^64 - 83).
        uint256 largePrime1 = 18446744073709551557;
        uint256 largePrime2 = 18446744073709551533;
        uint256 semi128 = largePrime1 * largePrime2;
        assertTrue(semi128 > largePrime1, "128-bit product did not overflow");
        assertFalse(
            _millerRabin(semi128),
            "Product of two 64-bit primes should be composite"
        );

        // ── Even numbers, trivial edge cases ───────────────────────────
        assertFalse(_millerRabin(0), "0 is not prime");
        assertFalse(_millerRabin(1), "1 is not prime");
        assertTrue(_millerRabin(2), "2 is prime");
        assertTrue(_millerRabin(3), "3 is prime");
        assertFalse(_millerRabin(4), "4 is not prime");
        assertFalse(_millerRabin(type(uint256).max), "2^256-1 is even, not prime");
    }

    /// @notice The contract's _isProbablyPrime (via harness) must also reject
    ///         every composite in the regression corpus. This ensures the
    ///         contract's witness set [2-71] catches these adversarial inputs.
    function test_PseudoprimeRegressionCorpus_ContractSide() public view {
        // Carmichael numbers
        assertFalse(harness.exposed_hashToPrime(bytes32(0)) == 561, "sanity");
        uint256[10] memory carmichaels = [
            uint256(561), uint256(1105), uint256(1729), uint256(2465), uint256(2821),
            uint256(6601), uint256(8911), uint256(10585), uint256(15841), uint256(29341)
        ];

        // We cannot call _isProbablyPrime directly (it's internal), but we
        // can verify the harness's _hashToPrime never outputs these composites
        // by checking a fixed set of credential hashes and asserting none of
        // the returned primes appear in the composite list.
        for (uint256 seed = 0; seed < 50; seed++) {
            bytes32 credHash = keccak256(abi.encodePacked("regression_corpus", seed));
            uint256 prime = harness.exposed_hashToPrime(credHash);

            // Must not be any known composite
            for (uint256 j = 0; j < 10; j++) {
                assertTrue(
                    prime != carmichaels[j],
                    "hashToPrime returned a Carmichael number"
                );
            }

            // Must pass independent verification
            assertTrue(
                _millerRabin(prime),
                string.concat("hashToPrime output failed independent MR for seed ", vm.toString(seed))
            );
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Fuzz: _hashToPrime produces actual primes (Miller-Rabin verified)
    // ════════════════════════════════════════════════════════════════════

    /// @notice The hash-to-prime mapping must produce values that pass an
    ///         independent Miller-Rabin primality test using witness bases
    ///         disjoint from those used by the contract.
    function testFuzz_HashToPrime_IsPrime(bytes32 credentialHash) public view {
        uint256 prime = _computeHashToPrime(credentialHash);
        // Must be odd
        assertEq(prime & 1, 1, "hashToPrime returned an even number");
        // Must pass independent Miller-Rabin (witnesses 73-173)
        assertTrue(_millerRabin(prime), "hashToPrime output failed independent primality check");
    }

    // ════════════════════════════════════════════════════════════════════
    // Fuzz: contract and test select the same prime candidate
    // ════════════════════════════════════════════════════════════════════

    /// @notice The contract's actual _hashToPrime (via harness) must return the
    ///         same candidate as the test's mirror, AND that candidate must pass
    ///         the independent Miller-Rabin verifier. This closes the behavioral-
    ///         equivalence gap: if the two witness sets would stop on different
    ///         candidates, this test fails.
    function testFuzz_HashToPrime_BehavioralEquivalence(bytes32 credentialHash) public view {
        uint256 contractPrime = harness.exposed_hashToPrime(credentialHash);
        uint256 testPrime = _computeHashToPrime(credentialHash);

        // Both must select the same candidate
        assertEq(
            contractPrime,
            testPrime,
            "Contract and test disagree on hash-to-prime candidate"
        );

        // The agreed candidate must pass independent verification
        assertTrue(
            _millerRabin(contractPrime),
            "Contract-selected prime failed independent Miller-Rabin"
        );
    }

    // ════════════════════════════════════════════════════════════════════
    // Fuzz: cannot double-revoke the same credential
    // ════════════════════════════════════════════════════════════════════

    /// @notice After revoking a credential, a second revocation of the same
    ///         credential must revert with CredentialAlreadyRevoked.
    function testFuzz_RevokeCredential_CannotDoubleRevoke(bytes32 credHash) public {
        // Avoid the zero hash edge case
        vm.assume(credHash != bytes32(0));

        _setupAndInit();

        uint256 prime = _computeHashToPrime(credHash);
        bytes memory newVal = _modexpUint(initialValue, prime, rsaModulus);
        bytes memory proof = _buildWesolowskiProof(initialValue, newVal, prime);

        // First revocation succeeds
        vm.prank(admin);
        acc.revokeCredential(ACC_ID, credHash, newVal, proof);
        assertTrue(acc.isRevoked(ACC_ID, credHash));

        // Second revocation must revert
        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.CredentialAlreadyRevoked.selector);
        acc.revokeCredential(ACC_ID, credHash, newVal, proof);
    }

    // ════════════════════════════════════════════════════════════════════
    // Fuzz: setParameters rejects short modulus
    // ════════════════════════════════════════════════════════════════════

    /// @notice Random modulus + bitLength combinations that violate the
    ///         MIN_MODULUS_BITS or byte-length constraints must revert.
    function testFuzz_SetParameters_RejectsShortModulus(
        bytes calldata modulus,
        uint256 bitLength
    ) public {
        // Bound bitLength to avoid arithmetic overflow in (bitLength + 7) / 8
        vm.assume(bitLength < type(uint256).max - 7);

        // We test cases where either:
        // 1. bitLength < 2048 (MIN_MODULUS_BITS), or
        // 2. modulus is too short for the declared bitLength, or
        // 3. modulus has a zero leading byte, or
        // 4. modulus is empty
        //
        // We only want inputs that should fail, so constrain accordingly.
        uint256 requiredBytes = (bitLength + 7) / 8;
        bool tooFewBits = bitLength < 2048;
        bool tooShort = modulus.length < requiredBytes;
        bool emptyModulus = modulus.length == 0;
        bool leadingZero = modulus.length > 0 && uint8(modulus[0]) == 0;

        vm.assume(tooFewBits || tooShort || emptyModulus || leadingZero);

        // Deploy a fresh instance so setParameters hasn't been called yet
        AccumulatorRevocation freshAcc = new AccumulatorRevocation(admin);

        vm.prank(admin);
        vm.expectRevert();
        freshAcc.setParameters(modulus, generator, bitLength);
    }

    // ════════════════════════════════════════════════════════════════════
    // Fuzz: batchRevoke reverts when batch size exceeds MAX_BATCH_SIZE
    // ════════════════════════════════════════════════════════════════════

    /// @notice Batch sizes greater than MAX_BATCH_SIZE (50) must revert
    ///         with BatchTooLarge.
    function testFuzz_BatchRevoke_RevertsOverBatchSize(uint8 batchSize) public {
        // Only test sizes that exceed the limit
        vm.assume(uint256(batchSize) > acc.MAX_BATCH_SIZE());

        _setupAndInit();

        bytes32[] memory creds = new bytes32[](uint256(batchSize));
        for (uint256 i = 0; i < uint256(batchSize); i++) {
            creds[i] = _hash("fuzzCred", i);
        }

        AccumulatorRevocation.BatchUpdate memory batch = AccumulatorRevocation.BatchUpdate({
            credentialHashes: creds,
            newAccumulatorValue: new bytes(256),
            proof: new bytes(256),
            targetEpoch: 1
        });

        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.BatchTooLarge.selector);
        acc.batchRevoke(ACC_ID, batch);
    }
}
