// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";
import "../../contracts/verifiers/WesolowskiVerifier.sol";
import "../../contracts/interfaces/IExponentiationVerifier.sol";

/// @title AccumulatorRevocationHandler
/// @notice Handler contract for invariant testing. Performs random valid operations
///         on the AccumulatorRevocation contract and tracks ghost state for assertions.
contract AccumulatorRevocationHandler is Test {
    AccumulatorRevocation public acc;
    bytes32 public immutable accId;
    address public immutable admin;

    bytes internal rsaModulus;
    bytes internal initialValue;

    /// @notice Ghost variable: tracks the number of revocations performed by this handler
    uint256 public ghost_revokeCount;

    /// @notice Ghost variable: tracks the last observed epoch (for monotonicity check)
    uint256 public ghost_lastEpoch;

    /// @notice Counter used to generate unique credential hashes
    uint256 private _credCounter;

    /// @notice Track which credentials we have revoked
    bytes32[] public revokedCredentials;

    constructor(
        AccumulatorRevocation _acc,
        bytes32 _accId,
        address _admin,
        bytes memory _rsaModulus,
        bytes memory _initialValue
    ) {
        acc = _acc;
        accId = _accId;
        admin = _admin;
        rsaModulus = _rsaModulus;
        initialValue = _initialValue;
    }

    // ── Helper: mirror of hash-to-prime from the contract ────────────

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
    ) internal view returns (bytes memory) {
        uint256 l = uint256(keccak256(abi.encodePacked(
            keccak256(base_),
            keccak256(result_)
        ))) | 1;
        uint256 q = exponent_ / l;
        return _modexpUint(base_, q, rsaModulus);
    }

    /// @notice Get the current accumulator value from storage.
    ///         We track the currentValue by reading the state after operations.
    function _getCurrentValue() internal view returns (bytes memory) {
        // Read the currentValueHash and compare; but we need the actual bytes.
        // We recompute from the chain of exponentiations.
        // Simpler approach: track in a ghost variable.
        return _currentValue;
    }

    bytes internal _currentValue;

    function initCurrentValue() external {
        _currentValue = initialValue;
    }

    // ── Handler actions ──────────────────────────────────────────────

    /// @notice Revoke a single fresh credential with a valid proof.
    function revokeSingle(uint256 seed) external {
        bytes32 credHash = keccak256(abi.encodePacked("handler_cred", _credCounter));
        _credCounter++;

        uint256 prime = _computeHashToPrime(credHash);
        bytes memory currentVal = _currentValue;
        bytes memory newVal = _modexpUint(currentVal, prime, rsaModulus);
        bytes memory proof = _buildWesolowskiProof(currentVal, newVal, prime);

        vm.prank(admin);
        acc.revokeCredential(accId, credHash, newVal, proof);

        _currentValue = newVal;
        ghost_revokeCount++;
        revokedCredentials.push(credHash);

        // Track epoch monotonicity
        (, uint256 epoch, , ) = acc.getCurrentState(accId);
        ghost_lastEpoch = epoch;
    }

    /// @notice Publish a witness update delta (a simpler operation).
    function publishWitness(uint256 seed) external {
        (, uint256 epoch, , ) = acc.getCurrentState(accId);

        AccumulatorRevocation.WitnessUpdateDelta memory delta = AccumulatorRevocation.WitnessUpdateDelta({
            fromEpoch: 0,
            toEpoch: epoch,
            productOfRevoked: "handler_delta",
            accumulatorAtFrom: initialValue,
            accumulatorAtTo: _currentValue
        });

        // accumulatorAtFrom must match the snapshot at fromEpoch
        // For fromEpoch=0, the snapshot valueHash = keccak256(initialValue)
        // accumulatorAtTo must match the current value hash
        vm.prank(admin);
        try acc.publishWitnessUpdate(accId, delta) {} catch {}
    }

    /// @notice Get the count of revoked credentials tracked by this handler.
    function getRevokedCount() external view returns (uint256) {
        return revokedCredentials.length;
    }
}

/// @title AccumulatorRevocation Invariant Tests
/// @notice Invariant tests that verify system-wide properties hold after
///         arbitrary sequences of operations.
contract AccumulatorRevocationInvariantTest is TestHelper {
    AccumulatorRevocation public acc;
    WesolowskiVerifier public wVerifier;
    AccumulatorRevocationHandler public handler;

    bytes32 constant ACC_ID = keccak256("acc:revocation:invariant");

    bytes rsaModulus;
    bytes generator;
    bytes initialValue;

    function setUp() public {
        acc = new AccumulatorRevocation(admin);
        wVerifier = new WesolowskiVerifier();

        vm.startPrank(admin);
        acc.setExponentiationVerifier(address(wVerifier));
        vm.stopPrank();

        rsaModulus = _buildValidModulus();
        generator = _buildPadded(2);
        initialValue = _buildPadded(2);

        // Setup parameters and initialize accumulator
        vm.prank(admin);
        acc.setParameters(rsaModulus, generator, 2048);
        vm.prank(admin);
        acc.initializeAccumulator(ACC_ID, initialValue);

        // Create handler
        handler = new AccumulatorRevocationHandler(
            acc, ACC_ID, admin, rsaModulus, initialValue
        );
        handler.initCurrentValue();

        // Grant the handler's admin prank the revocation role (already granted to admin)
        // The handler uses vm.prank(admin) internally, so no extra role grants needed.

        // Target only the handler for invariant calls
        targetContract(address(handler));

        // Only target the action functions
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = AccumulatorRevocationHandler.revokeSingle.selector;
        selectors[1] = AccumulatorRevocationHandler.publishWitness.selector;
        targetSelector(FuzzSelector({
            addr: address(handler),
            selectors: selectors
        }));
    }

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

    // ════════════════════════════════════════════════════════════════════
    // Invariant: totalRevocations matches actual revocation count
    // ════════════════════════════════════════════════════════════════════

    /// @notice The contract's totalRevocations counter must always match
    ///         the number of revocations performed through the handler.
    function invariant_TotalRevocationsMatchesActualRevocations() public view {
        assertEq(
            acc.totalRevocations(),
            handler.ghost_revokeCount(),
            "totalRevocations diverged from actual revocation count"
        );
    }

    // ════════════════════════════════════════════════════════════════════
    // Invariant: initialized accumulator has non-zero value hash
    // ════════════════════════════════════════════════════════════════════

    /// @notice After initialization, the accumulator's currentValueHash
    ///         must never be bytes32(0).
    function invariant_InitializedAccumulatorHasNonZeroValue() public view {
        (bytes32 valueHash, , , ) = acc.getCurrentState(ACC_ID);
        assertTrue(
            valueHash != bytes32(0),
            "Initialized accumulator has zero value hash"
        );
    }

    // ════════════════════════════════════════════════════════════════════
    // Invariant: epoch monotonically increases
    // ════════════════════════════════════════════════════════════════════

    /// @notice The epoch counter must always equal the total number of
    ///         revocations for this accumulator (each revoke increments by 1).
    ///         Since we only do single revocations in the handler, epoch == revokeCount.
    function invariant_EpochMonotonicallyIncreases() public view {
        (, uint256 epoch, , ) = acc.getCurrentState(ACC_ID);
        // Epoch must match handler's revoke count (each revokeSingle increments epoch by 1)
        assertEq(
            epoch,
            handler.ghost_revokeCount(),
            "Epoch does not match revocation count - monotonicity violated"
        );
        // Also verify epoch >= last observed epoch (redundant but explicit)
        assertGe(
            epoch,
            handler.ghost_lastEpoch(),
            "Epoch decreased - monotonicity violated"
        );
    }
}
