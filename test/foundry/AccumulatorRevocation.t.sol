// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";
import "../../contracts/verifiers/WesolowskiVerifier.sol";
import "../../contracts/interfaces/IExponentiationVerifier.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Mock ZK verifier — returns true only for pre-registered valid proofs.
// ─────────────────────────────────────────────────────────────────────────────

contract MockZKVerifier is IZKVerifier {
    mapping(bytes32 => bool) private _registeredCircuits;
    mapping(bytes32 => bool) private _validProofs;

    function registerCircuit(bytes32 circuitId) external {
        _registeredCircuits[circuitId] = true;
    }

    function registerValidProof(
        bytes32 circuitId,
        Groth16Proof calldata proof,
        uint256[] calldata publicInputs
    ) external {
        bytes32 key = keccak256(abi.encode(circuitId, proof, publicInputs));
        _validProofs[key] = true;
    }

    function verifyProof(
        bytes32 circuitId,
        Groth16Proof calldata proof,
        uint256[] calldata publicInputs
    ) external view override returns (bool) {
        if (!_registeredCircuits[circuitId]) return false;
        bytes32 key = keccak256(abi.encode(circuitId, proof, publicInputs));
        return _validProofs[key];
    }

    function setVerificationKey(
        bytes32, uint256[2] calldata, uint256[2][2] calldata,
        uint256[2][2] calldata, uint256[2][2] calldata, uint256[2][] calldata
    ) external override {}

    function isCircuitRegistered(bytes32 circuitId) external view override returns (bool) {
        return _registeredCircuits[circuitId];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

contract AccumulatorRevocationTest is TestHelper {
    AccumulatorRevocation public acc;
    WesolowskiVerifier public wVerifier;
    MockZKVerifier public mockZK;

    bytes32 constant ACC_ID = keccak256("acc:revocation:1");
    bytes32 constant CRED_1 = keccak256("cred:1");
    bytes32 constant CRED_2 = keccak256("cred:2");
    bytes32 constant CRED_3 = keccak256("cred:3");

    bytes rsaModulus;
    bytes generator;
    bytes initialValue;

    function setUp() public {
        acc = new AccumulatorRevocation(admin);
        wVerifier = new WesolowskiVerifier();
        mockZK = new MockZKVerifier();

        vm.startPrank(admin);
        acc.setExponentiationVerifier(address(wVerifier));
        acc.setZKVerifier(address(mockZK), acc.NON_MEMBERSHIP_CIRCUIT_ID());
        vm.stopPrank();

        // Build 256-byte RSA parameters with non-zero leading byte.
        // The numeric modulus is 0x80_00...00_4D (a large number ≈ 2^2047 + 77).
        rsaModulus = _buildValidModulus();
        generator = _buildPadded(2);
        initialValue = _buildPadded(2); // V_0 = g = 2
    }

    function _buildValidModulus() internal pure returns (bytes memory) {
        bytes memory result = new bytes(256);
        result[0] = 0x80; // Non-zero leading byte → numerically ≈ 2^2047
        result[255] = 0x4D; // + 77
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

    // ── MODEXP helper (calls precompile) ─────────────────────────────

    function _modexp(
        bytes memory base_,
        bytes memory exp_,
        bytes memory mod_
    ) internal view returns (bytes memory) {
        uint256 baseLen = base_.length;
        uint256 expLen = exp_.length;
        uint256 modLen = mod_.length;

        bytes memory input = abi.encodePacked(
            bytes32(baseLen), bytes32(expLen), bytes32(modLen),
            base_, exp_, mod_
        );

        bytes memory out = new bytes(modLen);
        assembly {
            let success := staticcall(gas(), 0x05, add(input, 0x20), mload(input), add(out, 0x20), modLen)
            if iszero(success) { revert(0, 0) }
        }
        return out;
    }

    function _modexpUint(
        bytes memory base_,
        uint256 exp_,
        bytes memory mod_
    ) internal view returns (bytes memory) {
        bytes memory expBytes = new bytes(32);
        assembly { mstore(add(expBytes, 0x20), exp_) }
        return _modexp(base_, expBytes, mod_);
    }

    /// @dev Compute floor(a * b / d) using 512-bit intermediate product.
    ///      Based on Uniswap V3 FullMath.mulDiv. Requires d > 0 and result fits uint256.
    function _mulDiv(uint256 a, uint256 b, uint256 d) internal pure returns (uint256 result) {
        // Full 512-bit multiplication and division — all wrapping arithmetic
        // Based on Uniswap V3 FullMath.mulDiv (MIT license)
        unchecked {
            uint256 prod0; // low 256 bits of a*b
            uint256 prod1; // high 256 bits of a*b
            assembly {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) return prod0 / d;

            uint256 remainder;
            assembly { remainder := mulmod(a, b, d) }
            prod1 -= (remainder > prod0 ? 1 : 0);
            prod0 -= remainder;

            uint256 twos = d & (~d + 1);
            assembly {
                d := div(d, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
                prod0 := or(prod0, mul(prod1, twos))
            }

            uint256 inv = (3 * d) ^ 2;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            result = prod0 * inv;
        }
    }

    /// @dev Modular multiplication (a * b) mod n using big-endian byte concatenation + MODEXP(product, 1, n)
    function _modmulBytes(
        bytes memory a,
        bytes memory b,
        bytes memory n
    ) internal view returns (bytes memory) {
        // Simple approach: use MODEXP to reduce. Compute a*b via schoolbook on bytes,
        // or just use two MODEXP calls: result = MODEXP(a, 1, n) is just a mod n...
        // Instead, encode product as concat and reduce: product = a * b (big-int),
        // then MODEXP(product, 1, n) = product mod n.
        // For simplicity, use the EVM: a and b are already mod n (256 bytes each).
        // Use the MODEXP precompile with exponent=1 on (a*b) represented as 512 bytes.
        // But we need actual big-integer multiplication. Use limb approach:
        uint256 modLen = n.length;
        uint256 aLen = a.length;
        uint256 bLen = b.length;
        uint256 prodLen = aLen + bLen;

        // Schoolbook multiply (byte-level is fine for test code, not gas-critical)
        bytes memory product = new bytes(prodLen);
        for (uint256 i = 0; i < aLen; i++) {
            uint256 carry = 0;
            uint256 aVal = uint256(uint8(a[aLen - 1 - i]));
            for (uint256 j = 0; j < bLen; j++) {
                uint256 pIdx = prodLen - 1 - i - j;
                uint256 sum = aVal * uint256(uint8(b[bLen - 1 - j])) + uint256(uint8(product[pIdx])) + carry;
                product[pIdx] = bytes1(uint8(sum & 0xFF));
                carry = sum >> 8;
            }
            // Propagate remaining carry through higher bytes
            uint256 k = prodLen - 1 - i - bLen;
            while (carry > 0) {
                uint256 sum2 = uint256(uint8(product[k])) + carry;
                product[k] = bytes1(uint8(sum2 & 0xFF));
                carry = sum2 >> 8;
                if (k == 0) break;
                k--;
            }
        }

        // Reduce: MODEXP(product, 1, n)
        bytes memory one = new bytes(1);
        one[0] = 0x01;
        bytes memory input = abi.encodePacked(
            bytes32(prodLen), bytes32(uint256(1)), bytes32(modLen),
            product, one, n
        );
        bytes memory out = new bytes(modLen);
        assembly {
            let success := staticcall(gas(), 0x05, add(input, 0x20), mload(input), add(out, 0x20), modLen)
            if iszero(success) { revert(0, 0) }
        }
        return out;
    }

    // ── Wesolowski proof construction ────────────────────────────────
    // Uses the MODEXP precompile — NOT a tautological hash replay.
    //
    // Per Wesolowski's protocol:
    //   l = H(V, V') | 1  (Fiat-Shamir, does NOT include Q)
    //   q = floor(x / l)
    //   r = x mod l
    //   Q = V^q mod N
    //   Verification: Q^l · V^r ≡ V' (mod N)

    function _buildWesolowskiProof(
        bytes memory base_,
        bytes memory result_,
        uint256 exponent_
    ) internal view returns (bytes memory quotientQ) {
        // 1. Derive l = H(V, V') | 1 — same as contract & verifier
        uint256 l = uint256(keccak256(abi.encodePacked(
            keccak256(base_),
            keccak256(result_)
        ))) | 1;

        // 2. Compute q = floor(exponent / l)
        uint256 q = exponent_ / l;

        // 3. Compute Q = V^q mod N using the MODEXP precompile
        quotientQ = _modexpUint(base_, q, rsaModulus);
    }

    // ════════════════════════════════════════════════════════════════
    // Deployment & Constants
    // ════════════════════════════════════════════════════════════════

    function test_Constructor_SetsRoles() public view {
        assertTrue(acc.hasRole(acc.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(acc.hasRole(acc.REVOCATION_AUTHORITY_ROLE(), admin));
        assertTrue(acc.hasRole(acc.WITNESS_UPDATER_ROLE(), admin));
    }

    function test_InitialState() public view {
        assertEq(acc.totalRevocations(), 0);
    }

    function test_Constants() public view {
        assertEq(acc.MIN_MODULUS_BITS(), 2048);
        assertEq(acc.MAX_BATCH_SIZE(), 2);
        assertEq(acc.SNAPSHOT_RETENTION(), 365 days);
    }

    function test_VerifierConfiguration() public view {
        assertEq(address(acc.exponentiationVerifier()), address(wVerifier));
        assertEq(address(acc.zkVerifier()), address(mockZK));
    }

    // ════════════════════════════════════════════════════════════════
    // Verifier setup
    // ════════════════════════════════════════════════════════════════

    function test_SetExponentiationVerifier_RevertsZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.ZeroValueNotAllowed.selector);
        acc.setExponentiationVerifier(address(0));
    }

    function test_SetExponentiationVerifier_RevertsWithoutRole() public {
        vm.prank(alice);
        vm.expectRevert();
        acc.setExponentiationVerifier(address(wVerifier));
    }

    function test_SetZKVerifier_RevertsZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.ZeroValueNotAllowed.selector);
        acc.setZKVerifier(address(0), bytes32(0));
    }

    // ════════════════════════════════════════════════════════════════
    // Parameters — modulus validation
    // ════════════════════════════════════════════════════════════════

    function test_SetParameters_Success() public {
        vm.prank(admin);
        acc.setParameters(rsaModulus, generator, 2048);

        (uint256 modulusBitLength, uint256 modLen, uint256 genLen) = acc.getParameters();
        assertEq(modulusBitLength, 2048);
        assertEq(modLen, 256);
        assertEq(genLen, 256);
    }

    function test_SetParameters_RevertsAlreadyInitialized() public {
        _setupParams();
        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.AccumulatorAlreadyInitialized.selector);
        acc.setParameters(rsaModulus, generator, 2048);
    }

    function test_SetParameters_RevertsInvalidModulus() public {
        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.InvalidRSAModulus.selector);
        acc.setParameters(rsaModulus, generator, 1024);
    }

    function test_SetParameters_RevertsEmptyModulus() public {
        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.ZeroValueNotAllowed.selector);
        acc.setParameters("", generator, 2048);
    }

    function test_SetParameters_RevertsEmptyGenerator() public {
        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.ZeroValueNotAllowed.selector);
        acc.setParameters(rsaModulus, "", 2048);
    }

    function test_SetParameters_RevertsWithoutRole() public {
        vm.prank(alice);
        vm.expectRevert();
        acc.setParameters(rsaModulus, generator, 2048);
    }

    function test_SetParameters_RevertsLeadingZeroByte() public {
        bytes memory weakModulus = new bytes(256);
        weakModulus[255] = 0x4D;
        // Leading byte is 0x00 — rejected!

        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.InvalidRSAModulus.selector);
        acc.setParameters(weakModulus, generator, 2048);
    }

    function test_SetParameters_RevertsTooShortForDeclaredBits() public {
        bytes memory shortModulus = new bytes(128);
        shortModulus[0] = 0x80;

        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.InvalidRSAModulus.selector);
        acc.setParameters(shortModulus, generator, 2048);
    }

    // ════════════════════════════════════════════════════════════════
    // Initialize Accumulator
    // ════════════════════════════════════════════════════════════════

    function test_InitializeAccumulator_Success() public {
        _setupParams();

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit AccumulatorRevocation.AccumulatorInitialized(ACC_ID, 2048, block.timestamp);
        acc.initializeAccumulator(ACC_ID, initialValue);

        (bytes32 valueHash, uint256 epoch, uint256 memberCount, uint256 lastUpdated) = acc.getCurrentState(ACC_ID);
        assertEq(valueHash, keccak256(initialValue));
        assertEq(epoch, 0);
        assertEq(memberCount, 0);
        assertGt(lastUpdated, 0);
    }

    function test_InitializeAccumulator_RevertsParamsNotSet() public {
        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.AccumulatorNotInitialized.selector);
        acc.initializeAccumulator(ACC_ID, initialValue);
    }

    function test_InitializeAccumulator_RevertsDuplicate() public {
        _setupAndInit();
        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.AccumulatorAlreadyInitialized.selector);
        acc.initializeAccumulator(ACC_ID, initialValue);
    }

    function test_InitializeAccumulator_RevertsEmptyValue() public {
        _setupParams();
        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.ZeroValueNotAllowed.selector);
        acc.initializeAccumulator(ACC_ID, "");
    }

    // ════════════════════════════════════════════════════════════════
    // Link Registry
    // ════════════════════════════════════════════════════════════════

    function test_LinkRegistry_Success() public {
        _setupAndInit();
        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit AccumulatorRevocation.RegistryLinked(ACC_ID, alice, block.timestamp);
        acc.linkRegistry(ACC_ID, alice);
    }

    function test_LinkRegistry_RevertsNotInitialized() public {
        _setupParams();
        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.AccumulatorNotInitialized.selector);
        acc.linkRegistry(keccak256("bad"), alice);
    }

    // ════════════════════════════════════════════════════════════════
    // Revocation with REAL Wesolowski proof (MODEXP precompile)
    // ════════════════════════════════════════════════════════════════

    function test_RevokeCredential_WithRealModExp() public {
        _setupAndInit();

        uint256 prime = _computeHashToPrime(CRED_1);

        // V' = V^prime mod N (real MODEXP)
        bytes memory newVal = _modexpUint(initialValue, prime, rsaModulus);

        // Q = V^{floor(prime/l)} mod N (real MODEXP)
        bytes memory proof = _buildWesolowskiProof(initialValue, newVal, prime);

        vm.prank(admin);
        acc.revokeCredential(ACC_ID, CRED_1, newVal, proof);

        assertTrue(acc.isRevoked(ACC_ID, CRED_1));
        assertEq(acc.totalRevocations(), 1);

        (bytes32 valueHash, uint256 epoch, uint256 memberCount, ) = acc.getCurrentState(ACC_ID);
        assertEq(valueHash, keccak256(newVal));
        assertEq(epoch, 1);
        assertEq(memberCount, 1);
    }

    function test_RevokeCredential_RejectsForgedProof() public {
        _setupAndInit();

        uint256 prime = _computeHashToPrime(CRED_1);
        bytes memory newVal = _modexpUint(initialValue, prime, rsaModulus);

        // Forged proof: arbitrary quotient
        bytes memory forgedProof = _buildPadded(42);

        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.InvalidAccumulatorValue.selector);
        acc.revokeCredential(ACC_ID, CRED_1, newVal, forgedProof);
    }

    function test_RevokeCredential_RejectsWrongNewValue() public {
        _setupAndInit();

        uint256 prime = _computeHashToPrime(CRED_1);
        bytes memory correctNewVal = _modexpUint(initialValue, prime, rsaModulus);
        bytes memory proof = _buildWesolowskiProof(initialValue, correctNewVal, prime);

        // Submit with wrong V'
        bytes memory wrongNewVal = _buildPadded(42);

        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.InvalidAccumulatorValue.selector);
        acc.revokeCredential(ACC_ID, CRED_1, wrongNewVal, proof);
    }

    function test_RevokeCredential_RevertsAlreadyRevoked() public {
        _setupAndInit();

        uint256 prime = _computeHashToPrime(CRED_1);
        bytes memory newVal = _modexpUint(initialValue, prime, rsaModulus);
        bytes memory proof = _buildWesolowskiProof(initialValue, newVal, prime);

        vm.prank(admin);
        acc.revokeCredential(ACC_ID, CRED_1, newVal, proof);

        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.CredentialAlreadyRevoked.selector);
        acc.revokeCredential(ACC_ID, CRED_1, newVal, proof);
    }

    function test_RevokeCredential_RevertsNotInitialized() public {
        _setupParams();
        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.AccumulatorNotInitialized.selector);
        acc.revokeCredential(keccak256("bad"), CRED_1, new bytes(256), new bytes(256));
    }

    function test_RevokeCredential_RevertsWhenPaused() public {
        _setupAndInit();
        vm.prank(admin);
        acc.pause();
        vm.prank(admin);
        vm.expectRevert();
        acc.revokeCredential(ACC_ID, CRED_1, new bytes(256), new bytes(256));
    }

    function test_RevokeCredential_RevertsWithoutVerifier() public {
        AccumulatorRevocation acc2 = new AccumulatorRevocation(admin);
        vm.startPrank(admin);
        acc2.setParameters(rsaModulus, generator, 2048);
        acc2.initializeAccumulator(ACC_ID, initialValue);
        vm.stopPrank();

        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.ExponentiationVerifierNotSet.selector);
        acc2.revokeCredential(ACC_ID, CRED_1, new bytes(256), new bytes(256));
    }

    // ════════════════════════════════════════════════════════════════
    // Batch Revocation
    // ════════════════════════════════════════════════════════════════

    function test_BatchRevoke_Success() public {
        _setupAndInit();

        bytes32[] memory creds = new bytes32[](2);
        creds[0] = CRED_1;
        creds[1] = CRED_2;

        // V' = V^(p1*p2) mod N = (V^p1)^p2 mod N
        uint256 p1 = _computeHashToPrime(CRED_1);
        uint256 p2 = _computeHashToPrime(CRED_2);
        bytes memory vAfterP1 = _modexpUint(initialValue, p1, rsaModulus);
        bytes memory newVal = _modexpUint(vAfterP1, p2, rsaModulus);

        // Derive l = H(V, V') | 1
        uint256 l = uint256(keccak256(abi.encodePacked(
            keccak256(initialValue),
            keccak256(newVal)
        ))) | 1;

        // Compute Q = V^q mod N where q = floor(p1*p2 / l).
        // Since p1*p2 overflows uint256, decompose into sequential MODEXP calls:
        //   q = p1*(p2/l) + floor(p1*(p2%l) / l)
        //   Q = V^{p1*(p2/l)} * V^{floor(p1*(p2%l)/l)} mod N
        //   Q = Q1 * Q2 mod N
        //   Q1 = (V^p1)^{p2/l} mod N  — two sequential MODEXP, no overflow
        //   Q2 = V^{mulDiv(p1, p2%l, l)} mod N  — mulDiv uses 512-bit intermediate
        uint256 p2DivL = p2 / l;
        uint256 p2ModL = p2 % l;

        // Q1 = (V^p1)^{p2/l} mod N
        bytes memory q1 = _modexpUint(vAfterP1, p2DivL, rsaModulus);

        // Q2 = V^{mulDiv(p1, p2ModL, l)} mod N
        uint256 qPart2 = _mulDiv(p1, p2ModL, l);
        bytes memory q2 = _modexpUint(initialValue, qPart2, rsaModulus);

        // Q = Q1 * Q2 mod N via MODEXP(Q1*Q2, 1, N)
        bytes memory proof = _modmulBytes(q1, q2, rsaModulus);

        AccumulatorRevocation.BatchUpdate memory batch = AccumulatorRevocation.BatchUpdate({
            credentialHashes: creds,
            newAccumulatorValue: newVal,
            proof: proof,
            targetEpoch: 1
        });

        vm.prank(admin);
        acc.batchRevoke(ACC_ID, batch);

        assertTrue(acc.isRevoked(ACC_ID, CRED_1));
        assertTrue(acc.isRevoked(ACC_ID, CRED_2));
        assertEq(acc.totalRevocations(), 2);
    }

    function test_BatchRevoke_SingleCred_Success() public {
        _setupAndInit();

        bytes32[] memory creds = new bytes32[](1);
        creds[0] = CRED_1;

        uint256 prime = _computeHashToPrime(CRED_1);
        bytes memory newVal = _modexpUint(initialValue, prime, rsaModulus);
        bytes memory proof = _buildWesolowskiProof(initialValue, newVal, prime);

        AccumulatorRevocation.BatchUpdate memory batch = AccumulatorRevocation.BatchUpdate({
            credentialHashes: creds,
            newAccumulatorValue: newVal,
            proof: proof,
            targetEpoch: 1
        });

        vm.prank(admin);
        acc.batchRevoke(ACC_ID, batch);

        assertTrue(acc.isRevoked(ACC_ID, CRED_1));
        assertEq(acc.totalRevocations(), 1);
    }

    /// @notice Gas budget regression test: assert that per-credential and fixed
    ///         costs stay within the budget assumed by MAX_BATCH_SIZE = 2.
    ///
    ///         Methodology (adversarial regression benchmark):
    ///         1. Scan for adversarial credential hashes with the highest
    ///            _hashToPrime iteration counts (worst-case Miller-Rabin gas).
    ///         2. Deploy a FRESH AccumulatorRevocation + WesolowskiVerifier for
    ///            each measurement, isolating per-measurement state.
    ///         3. Measure 1-credential batch gas on fresh instance #1.
    ///         4. Measure 2-credential batch gas on fresh instance #2.
    ///         5. Derive marginalCost = gasUsed2 - gasUsed1, extrapolate to
    ///            MAX_BATCH_SIZE, assert under 80% of 30M block gas limit.
    ///
    ///         NOTE: Setup calls (setExponentiationVerifier, setParameters,
    ///         initializeAccumulator) happen in the same transaction as the
    ///         measured batchRevoke, so EIP-2929 warms ~6-8 storage slots
    ///         before measurement. This underestimates true cold-start gas
    ///         by roughly (slots × 2000) ≈ 12-16K gas — negligible vs the
    ///         7-8M marginal cost, but this benchmark should be understood
    ///         as regression coverage, not a strict cold-start proof.
    function test_BatchRevoke_GasBudget() public {
        // ── Select adversarial credential hashes ──
        bytes32 worstHash1;
        bytes32 worstHash2;
        uint256 worstIter1 = 0;
        uint256 worstIter2 = 0;

        bytes memory DOMAIN = "ZeroID.AccRev.H2P.v1";
        for (uint256 seed = 0; seed < 200; seed++) {
            bytes32 h = keccak256(abi.encodePacked("gasBudgetScan", seed));
            uint256 iters = _countHashToPrimeIterations(h, DOMAIN);
            if (iters > worstIter1) {
                worstIter2 = worstIter1;
                worstHash2 = worstHash1;
                worstIter1 = iters;
                worstHash1 = h;
            } else if (iters > worstIter2) {
                worstIter2 = iters;
                worstHash2 = h;
            }
        }
        require(worstIter1 > 0 && worstIter2 > 0, "Failed to find adversarial samples");

        // ── Measure 1-credential batch on fresh (cold) contract ──
        uint256 gasUsed1 = _measureBatchGas_Cold(worstHash1, bytes32(0), false);

        // ── Measure 2-credential batch on fresh (cold) contract ──
        uint256 gasUsed2 = _measureBatchGas_Cold(worstHash1, worstHash2, true);

        // ── Extrapolate and assert budget ──
        uint256 BLOCK_GAS_LIMIT = 30_000_000;
        uint256 maxBatch = acc.MAX_BATCH_SIZE();

        require(gasUsed2 > gasUsed1, "2-cred batch should cost more than 1-cred");
        uint256 marginalCost = gasUsed2 - gasUsed1;

        // Add EIP-2929 cold-access surcharge: setup calls warm ~8 storage
        // slots before the measured batchRevoke. Each warm SLOAD saves 2000
        // gas vs cold. Add 8 × 2000 = 16000 gas to account for this.
        uint256 COLD_ACCESS_SURCHARGE = 16_000;
        uint256 worstCase = gasUsed1 + (maxBatch - 1) * marginalCost + COLD_ACCESS_SURCHARGE;

        assertLt(
            worstCase,
            (BLOCK_GAS_LIMIT * 80) / 100,
            string.concat(
                "Worst-case batch gas exceeds 80% of block limit. ",
                "worstCase=", vm.toString(worstCase),
                " marginal=", vm.toString(marginalCost),
                " gasUsed1=", vm.toString(gasUsed1),
                " gasUsed2=", vm.toString(gasUsed2),
                " iters1=", vm.toString(worstIter1),
                " iters2=", vm.toString(worstIter2)
            )
        );
    }

    /// @dev Deploy a fresh AccumulatorRevocation + WesolowskiVerifier, initialize,
    ///      then measure batchRevoke gas. Fresh deploy isolates state between
    ///      measurements. Setup calls warm ~6-8 slots in the same tx (see
    ///      NOTE in test_BatchRevoke_GasBudget); the delta is <16K gas.
    function _measureBatchGas_Cold(
        bytes32 hash1,
        bytes32 hash2,
        bool twoCreds
    ) internal returns (uint256 gasUsed) {
        // Fresh deploy — all slots cold
        AccumulatorRevocation freshAcc = new AccumulatorRevocation(admin);
        WesolowskiVerifier freshVerifier = new WesolowskiVerifier();

        vm.startPrank(admin);
        freshAcc.setExponentiationVerifier(address(freshVerifier));
        freshAcc.setParameters(rsaModulus, generator, 2048);
        freshAcc.initializeAccumulator(ACC_ID, initialValue);
        vm.stopPrank();

        if (!twoCreds) {
            // 1-credential batch
            bytes32[] memory creds = new bytes32[](1);
            creds[0] = hash1;
            uint256 prime = _computeHashToPrime(hash1);
            bytes memory newVal = _modexpUint(initialValue, prime, rsaModulus);
            bytes memory proof = _buildWesolowskiProof(initialValue, newVal, prime);

            AccumulatorRevocation.BatchUpdate memory batch = AccumulatorRevocation.BatchUpdate({
                credentialHashes: creds,
                newAccumulatorValue: newVal,
                proof: proof,
                targetEpoch: 1
            });

            vm.prank(admin);
            uint256 gasBefore = gasleft();
            freshAcc.batchRevoke(ACC_ID, batch);
            gasUsed = gasBefore - gasleft();
        } else {
            // 2-credential batch
            bytes32[] memory creds = new bytes32[](2);
            creds[0] = hash1;
            creds[1] = hash2;

            uint256 p1 = _computeHashToPrime(hash1);
            uint256 p2 = _computeHashToPrime(hash2);
            bytes memory vAfterP1 = _modexpUint(initialValue, p1, rsaModulus);
            bytes memory newVal = _modexpUint(vAfterP1, p2, rsaModulus);

            uint256 l = uint256(keccak256(abi.encodePacked(
                keccak256(initialValue), keccak256(newVal)
            ))) | 1;

            uint256 p2DivL = p2 / l;
            uint256 p2ModL = p2 % l;
            bytes memory q1 = _modexpUint(vAfterP1, p2DivL, rsaModulus);
            uint256 qPart2 = _mulDiv(p1, p2ModL, l);
            bytes memory q2 = _modexpUint(initialValue, qPart2, rsaModulus);
            bytes memory proof = _modmulBytes(q1, q2, rsaModulus);

            AccumulatorRevocation.BatchUpdate memory batch = AccumulatorRevocation.BatchUpdate({
                credentialHashes: creds,
                newAccumulatorValue: newVal,
                proof: proof,
                targetEpoch: 1
            });

            vm.prank(admin);
            uint256 gasBefore = gasleft();
            freshAcc.batchRevoke(ACC_ID, batch);
            gasUsed = gasBefore - gasleft();
        }
    }

    /// @dev Count how many iterations _hashToPrime needs for a given credential hash.
    function _countHashToPrimeIterations(
        bytes32 credentialHash,
        bytes memory domain
    ) internal view returns (uint256) {
        for (uint256 counter = 0; counter < 1000; counter++) {
            uint256 candidate = uint256(
                keccak256(abi.encodePacked(domain, credentialHash, counter))
            ) | 1;
            if (_millerRabinCheck(candidate)) return counter;
        }
        return 1000;
    }

    function test_BatchRevoke_RevertsNotInitialized() public {
        _setupParams();
        bytes32[] memory creds = new bytes32[](1);
        creds[0] = CRED_1;

        AccumulatorRevocation.BatchUpdate memory batch = AccumulatorRevocation.BatchUpdate({
            credentialHashes: creds,
            newAccumulatorValue: new bytes(256),
            proof: new bytes(256),
            targetEpoch: 1
        });

        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.AccumulatorNotInitialized.selector);
        acc.batchRevoke(keccak256("bad"), batch);
    }

    function test_BatchRevoke_RevertsEmptyBatch() public {
        _setupAndInit();
        bytes32[] memory creds = new bytes32[](0);
        AccumulatorRevocation.BatchUpdate memory batch = AccumulatorRevocation.BatchUpdate({
            credentialHashes: creds,
            newAccumulatorValue: new bytes(256),
            proof: new bytes(256),
            targetEpoch: 1
        });

        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.ZeroValueNotAllowed.selector);
        acc.batchRevoke(ACC_ID, batch);
    }

    function test_BatchRevoke_RevertsBatchTooLarge() public {
        _setupAndInit();
        bytes32[] memory creds = new bytes32[](3);
        for (uint256 i = 0; i < 3; i++) creds[i] = _hash("cred", i);

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

    function test_BatchRevoke_RejectsForgedProof() public {
        _setupAndInit();
        bytes32[] memory creds = new bytes32[](1);
        creds[0] = CRED_1;

        uint256 prime = _computeHashToPrime(CRED_1);
        bytes memory newVal = _modexpUint(initialValue, prime, rsaModulus);
        bytes memory forgedProof = _buildPadded(99);

        AccumulatorRevocation.BatchUpdate memory batch = AccumulatorRevocation.BatchUpdate({
            credentialHashes: creds,
            newAccumulatorValue: newVal,
            proof: forgedProof,
            targetEpoch: 1
        });

        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.InvalidBatchUpdate.selector);
        acc.batchRevoke(ACC_ID, batch);
    }

    // ════════════════════════════════════════════════════════════════
    // Non-membership ZK verification (via mock)
    // ════════════════════════════════════════════════════════════════

    function test_VerifyNonMembership_WithRegisteredProof() public {
        _setupAndInit();

        bytes32 circuitId = acc.nonMembershipCircuitId();
        mockZK.registerCircuit(circuitId);

        (bytes32 valueHash, , , ) = acc.getCurrentState(ACC_ID);
        uint256[] memory publicInputs = new uint256[](3);
        publicInputs[0] = uint256(keccak256(abi.encodePacked(valueHash, CRED_1)));
        publicInputs[1] = uint256(keccak256(generator));
        publicInputs[2] = 0;

        Groth16Proof memory proof = _dummyProof();
        mockZK.registerValidProof(circuitId, proof, publicInputs);

        AccumulatorRevocation.NonMembershipWitness memory witness = AccumulatorRevocation.NonMembershipWitness({
            d: new bytes(256), b: new bytes(256), credentialHash: CRED_1, epoch: 0
        });

        assertTrue(acc.verifyNonMembership(ACC_ID, witness, abi.encode(proof)));
    }

    function test_VerifyNonMembership_RejectsUnregisteredProof() public {
        _setupAndInit();
        mockZK.registerCircuit(acc.nonMembershipCircuitId());

        AccumulatorRevocation.NonMembershipWitness memory witness = AccumulatorRevocation.NonMembershipWitness({
            d: new bytes(256), b: new bytes(256), credentialHash: CRED_1, epoch: 0
        });

        assertFalse(acc.verifyNonMembership(ACC_ID, witness, abi.encode(_dummyProof())));
    }

    function test_VerifyNonMembership_RejectsRevokedCredential() public {
        _setupAndInit();

        // Revoke CRED_1
        uint256 prime = _computeHashToPrime(CRED_1);
        bytes memory newVal = _modexpUint(initialValue, prime, rsaModulus);
        bytes memory proof = _buildWesolowskiProof(initialValue, newVal, prime);
        vm.prank(admin);
        acc.revokeCredential(ACC_ID, CRED_1, newVal, proof);

        AccumulatorRevocation.NonMembershipWitness memory witness = AccumulatorRevocation.NonMembershipWitness({
            d: new bytes(256), b: new bytes(256), credentialHash: CRED_1, epoch: 1
        });

        // Defense-in-depth: false for known-revoked
        assertFalse(acc.verifyNonMembership(ACC_ID, witness, abi.encode(_dummyProof())));
    }

    function test_VerifyNonMembership_RevertsWithoutZKVerifier() public {
        AccumulatorRevocation acc2 = new AccumulatorRevocation(admin);
        vm.startPrank(admin);
        acc2.setExponentiationVerifier(address(wVerifier));
        acc2.setParameters(rsaModulus, generator, 2048);
        acc2.initializeAccumulator(ACC_ID, initialValue);
        vm.stopPrank();

        AccumulatorRevocation.NonMembershipWitness memory witness = AccumulatorRevocation.NonMembershipWitness({
            d: new bytes(256), b: new bytes(256), credentialHash: CRED_1, epoch: 0
        });

        vm.expectRevert(AccumulatorRevocation.ZKVerifierNotSet.selector);
        acc2.verifyNonMembership(ACC_ID, witness, abi.encode(_dummyProof()));
    }

    function test_VerifyNonMembership_RevertsEpochMismatch() public {
        _setupAndInit();

        AccumulatorRevocation.NonMembershipWitness memory witness = AccumulatorRevocation.NonMembershipWitness({
            d: new bytes(256), b: new bytes(256), credentialHash: CRED_1, epoch: 5
        });

        vm.expectRevert(AccumulatorRevocation.EpochMismatch.selector);
        acc.verifyNonMembership(ACC_ID, witness, abi.encode(_dummyProof()));
    }

    // ════════════════════════════════════════════════════════════════
    // Historical non-membership
    // ════════════════════════════════════════════════════════════════

    function test_VerifyNonMembershipAtEpoch_Success() public {
        _setupAndInit();

        bytes32 circuitId = acc.nonMembershipCircuitId();
        mockZK.registerCircuit(circuitId);

        (bytes32 valueHash, , , ) = acc.getCurrentState(ACC_ID);
        uint256[] memory publicInputs = new uint256[](3);
        publicInputs[0] = uint256(keccak256(abi.encodePacked(valueHash, CRED_1)));
        publicInputs[1] = uint256(keccak256(generator));
        publicInputs[2] = 0;

        Groth16Proof memory proof = _dummyProof();
        mockZK.registerValidProof(circuitId, proof, publicInputs);

        AccumulatorRevocation.NonMembershipWitness memory witness = AccumulatorRevocation.NonMembershipWitness({
            d: new bytes(256), b: new bytes(256), credentialHash: CRED_1, epoch: 0
        });

        assertTrue(acc.verifyNonMembershipAtEpoch(ACC_ID, witness, 0, abi.encode(proof)));
    }

    function test_VerifyNonMembershipAtEpoch_RevertsSnapshotNotFound() public {
        _setupAndInit();

        AccumulatorRevocation.NonMembershipWitness memory witness = AccumulatorRevocation.NonMembershipWitness({
            d: new bytes(256), b: new bytes(256), credentialHash: CRED_1, epoch: 99
        });

        vm.expectRevert(AccumulatorRevocation.SnapshotNotFound.selector);
        acc.verifyNonMembershipAtEpoch(ACC_ID, witness, 99, abi.encode(_dummyProof()));
    }

    // ════════════════════════════════════════════════════════════════
    // View functions
    // ════════════════════════════════════════════════════════════════

    function test_IsRevoked_FalseByDefault() public view {
        assertFalse(acc.isRevoked(ACC_ID, CRED_1));
    }

    function test_GetSnapshot() public {
        _setupAndInit();
        AccumulatorRevocation.Snapshot memory snap = acc.getSnapshot(ACC_ID, 0);
        assertEq(snap.valueHash, keccak256(initialValue));
        assertEq(snap.memberCount, 0);
        assertGt(snap.timestamp, 0);
    }

    // ════════════════════════════════════════════════════════════════
    // Witness Update
    // ════════════════════════════════════════════════════════════════

    function test_PublishWitnessUpdate_RevertsNotInitialized() public {
        _setupParams();
        AccumulatorRevocation.WitnessUpdateDelta memory delta = AccumulatorRevocation.WitnessUpdateDelta({
            fromEpoch: 0, toEpoch: 0, productOfRevoked: "",
            accumulatorAtFrom: initialValue, accumulatorAtTo: initialValue
        });
        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.AccumulatorNotInitialized.selector);
        acc.publishWitnessUpdate(keccak256("bad"), delta);
    }

    function test_PublishWitnessUpdate_Success() public {
        _setupAndInit();
        AccumulatorRevocation.WitnessUpdateDelta memory delta = AccumulatorRevocation.WitnessUpdateDelta({
            fromEpoch: 0, toEpoch: 0, productOfRevoked: "dummy",
            accumulatorAtFrom: initialValue, accumulatorAtTo: initialValue
        });
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit AccumulatorRevocation.WitnessUpdatePublished(ACC_ID, 0, 0, block.timestamp);
        acc.publishWitnessUpdate(ACC_ID, delta);
    }

    function test_PublishWitnessUpdate_RevertsEpochMismatch() public {
        _setupAndInit();
        AccumulatorRevocation.WitnessUpdateDelta memory delta = AccumulatorRevocation.WitnessUpdateDelta({
            fromEpoch: 0, toEpoch: 5, productOfRevoked: "dummy",
            accumulatorAtFrom: initialValue, accumulatorAtTo: initialValue
        });
        vm.prank(admin);
        vm.expectRevert(AccumulatorRevocation.EpochMismatch.selector);
        acc.publishWitnessUpdate(ACC_ID, delta);
    }

    // ════════════════════════════════════════════════════════════════
    // Pause
    // ════════════════════════════════════════════════════════════════

    function test_Pause_Unpause() public {
        vm.prank(admin);
        acc.pause();
        vm.prank(admin);
        acc.unpause();
    }

    // ════════════════════════════════════════════════════════════════
    // Helpers — hash-to-prime (mirrors contract logic)
    // ════════════════════════════════════════════════════════════════

    function _computeHashToPrime(bytes32 credentialHash) internal view returns (uint256) {
        bytes memory DOMAIN = "ZeroID.AccRev.H2P.v1";
        uint256 counter = 0;
        while (counter < 1000) {
            uint256 candidate = uint256(
                keccak256(abi.encodePacked(DOMAIN, credentialHash, counter))
            ) | 1;
            if (_millerRabinCheck(candidate)) return candidate;
            unchecked { ++counter; }
        }
        revert("no prime found");
    }

    function _millerRabinCheck(uint256 n) internal view returns (bool) {
        if (n < 2) return false;
        if (n < 4) return true;
        if (n % 2 == 0 || n % 3 == 0) return false;
        uint256 td = 5;
        while (td * td <= n && td < 1000) {
            if (n % td == 0 || n % (td + 2) == 0) return false;
            unchecked { td += 6; }
        }
        if (td * td > n) return true;

        uint256 d = n - 1;
        uint256 r = 0;
        while (d % 2 == 0) { d >>= 1; unchecked { ++r; } }

        uint8[20] memory witnesses = [
            2, 3, 5, 7, 11, 13, 17, 19, 23, 29,
            31, 37, 41, 43, 47, 53, 59, 61, 67, 71
        ];
        for (uint256 i = 0; i < 20; i++) {
            uint256 a = uint256(witnesses[i]);
            if (a >= n) continue;
            uint256 x = _modexpSmall(a, d, n);
            if (x == 1 || x == n - 1) continue;
            bool composite = true;
            for (uint256 j = 1; j < r; j++) {
                x = _modexpSmall(x, 2, n);
                if (x == n - 1) { composite = false; break; }
            }
            if (composite) return false;
        }
        return true;
    }

    function _modexpSmall(uint256 base_, uint256 exp_, uint256 mod_) internal view returns (uint256 result) {
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
}
