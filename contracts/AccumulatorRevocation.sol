// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IExponentiationVerifier} from "./interfaces/IExponentiationVerifier.sol";
import {IZKVerifier} from "./interfaces/IZeroID.sol";
import {Groth16Proof} from "./interfaces/IZeroID.sol";

/**
 * @title AccumulatorRevocation
 * @author ZeroID Cryptography Team
 * @notice Privacy-preserving credential revocation using RSA-style cryptographic
 *         accumulators. Verifiers can check that a credential is NOT revoked without
 *         learning which credential is being checked.
 *
 * @dev An RSA accumulator is a single group element V that commits to a set S:
 *        V = g^{∏_{s∈S} H(s)} mod N
 *      where N is an RSA modulus, g is a generator of QR_N, and H maps members
 *      to primes. Non-membership witnesses prove element e ∉ S using Bézout's identity:
 *        Given GCD(H(e), ∏ H(s)) = 1, there exist a, b such that
 *        a·H(e) + b·∏H(s) = 1  →  d^{H(e)} · V^b = g  (non-membership witness d)
 *
 *      Accumulator updates (revocations) are verified on-chain via Wesolowski proofs
 *      of exponentiation, delegated to an external IExponentiationVerifier that uses
 *      the EVM MODEXP precompile (0x05).
 *
 *      Non-membership proofs are verified via an external IZKVerifier (Groth16) that
 *      uses the BN254 pairing precompile (0x08).
 */
contract AccumulatorRevocation is AccessControl, Pausable, ReentrancyGuard {
    // ──────────────────────────────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────────────────────────────

    bytes32 public constant REVOCATION_AUTHORITY_ROLE = keccak256("REVOCATION_AUTHORITY_ROLE");
    bytes32 public constant WITNESS_UPDATER_ROLE = keccak256("WITNESS_UPDATER_ROLE");

    // ──────────────────────────────────────────────────────────────────────
    // Custom errors
    // ──────────────────────────────────────────────────────────────────────

    error AccumulatorAlreadyInitialized();
    error AccumulatorNotInitialized();
    error InvalidRSAModulus();
    error InvalidAccumulatorValue();
    error InvalidBatchUpdate();
    error InvalidNonMembershipProof();
    error InvalidWitnessUpdate();
    error CredentialAlreadyRevoked();
    error EpochMismatch();
    error SnapshotNotFound();
    error BatchTooLarge();
    error InvalidProofStructure();
    error RegistryNotLinked();
    error ZeroValueNotAllowed();
    error ExponentiationVerifierNotSet();
    error ZKVerifierNotSet();

    // ──────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────

    event AccumulatorInitialized(
        bytes32 indexed accId,
        uint256 modulusBitLength,
        uint256 timestamp
    );

    event CredentialRevoked(
        bytes32 indexed accId,
        bytes32 indexed credentialHash,
        uint256 epoch,
        uint256 timestamp
    );

    event BatchRevocation(
        bytes32 indexed accId,
        uint256 count,
        uint256 epoch,
        uint256 timestamp
    );

    event AccumulatorUpdated(
        bytes32 indexed accId,
        bytes32 oldValueHash,
        bytes32 newValueHash,
        uint256 epoch,
        uint256 timestamp
    );

    event NonMembershipVerified(
        bytes32 indexed accId,
        bytes32 indexed credentialHash,
        uint256 epoch,
        uint256 timestamp
    );

    event WitnessUpdatePublished(
        bytes32 indexed accId,
        uint256 fromEpoch,
        uint256 toEpoch,
        uint256 timestamp
    );

    event SnapshotCreated(
        bytes32 indexed accId,
        uint256 epoch,
        bytes32 valueHash,
        uint256 timestamp
    );

    event RegistryLinked(
        bytes32 indexed accId,
        address indexed registry,
        uint256 timestamp
    );

    event ExponentiationVerifierUpdated(address indexed verifier);
    event ZKVerifierUpdated(address indexed verifier, bytes32 indexed circuitId);

    // ──────────────────────────────────────────────────────────────────────
    // Structs
    // ──────────────────────────────────────────────────────────────────────

    /// @notice RSA accumulator parameters
    struct AccumulatorParams {
        bytes rsaModulus;            // N = p·q (2048+ bits)
        bytes generator;             // g ∈ QR_N
        uint256 modulusBitLength;    // Bit length of N
    }

    /// @notice Accumulator state
    struct AccumulatorState {
        bytes32 id;                  // Unique accumulator identifier
        bytes currentValue;          // Current accumulator value V (big-endian)
        bytes32 currentValueHash;    // keccak256(currentValue) for cheap comparison
        uint256 epoch;               // Monotonically increasing counter
        uint256 memberCount;         // Total members in the accumulated set (revoked creds)
        uint256 lastUpdated;         // Timestamp
        bool initialized;            // Whether setup is complete
        address linkedRegistry;      // Optional credential registry contract
    }

    /// @notice Non-membership witness for a credential
    struct NonMembershipWitness {
        bytes d;                     // Witness value: d = g^{a} mod N
        bytes b;                     // Cofactor for Bézout identity
        bytes32 credentialHash;      // The credential this proves non-membership for
        uint256 epoch;               // Epoch this witness is valid for
    }

    /// @notice Batch revocation update
    struct BatchUpdate {
        bytes32[] credentialHashes;  // Credentials to revoke
        bytes newAccumulatorValue;   // New V after all revocations
        bytes proof;                 // ABI-encoded Wesolowski quotient Q (modulus-sized)
        uint256 targetEpoch;         // Expected new epoch
    }

    /// @notice Witness update delta (allows holders to update witnesses without
    ///         knowing which credentials were revoked)
    struct WitnessUpdateDelta {
        uint256 fromEpoch;           // Starting epoch
        uint256 toEpoch;             // Ending epoch
        bytes productOfRevoked;      // Product of H(revoked) values (blinded)
        bytes accumulatorAtFrom;     // Accumulator value at fromEpoch
        bytes accumulatorAtTo;       // Accumulator value at toEpoch
    }

    /// @notice Historical snapshot
    struct Snapshot {
        bytes32 valueHash;           // keccak256 of accumulator value
        uint256 memberCount;         // Members at this epoch
        uint256 timestamp;           // When snapshot was taken
    }

    // ──────────────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────────────

    uint256 public constant MIN_MODULUS_BITS = 2048;
    /// @dev Empirical gas profile (2048-bit RSA modulus, 20-round Miller-Rabin):
    ///      Adversarial worst-case: credential hashes requiring ~580 iterations
    ///      of the _hashToPrime search consume ~8.5M gas (single credential).
    ///      Marginal cost per additional worst-case credential: ~7.8M gas.
    ///      At 30M block gas limit with 20% safety margin (24M budget):
    ///        MAX_BATCH_SIZE = 1 + floor((24M - 8.5M) / 7.8M) = 2
    ///      Figures are from adversarial regression benchmarks with fresh-deploy
    ///      isolation. Warm-slot discount from same-tx setup is ~16K gas
    ///      (<0.1% of measured values), accounted for in the test assertion.
    ///      Larger batches should be split into multiple transactions.
    uint256 public constant MAX_BATCH_SIZE = 2;
    uint256 public constant SNAPSHOT_RETENTION = 365 days;

    /// @notice Domain separator for hashing credentials to primes
    bytes public constant HASH_TO_PRIME_DOMAIN = "ZeroID.AccRev.H2P.v1";

    /// @notice Circuit ID for the non-membership ZK proof circuit
    bytes32 public constant NON_MEMBERSHIP_CIRCUIT_ID = keccak256("zeroid.accumulator.non_membership.v1");

    // ──────────────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Accumulator parameters (shared across all accumulators in this contract)
    AccumulatorParams private _params;
    bool private _paramsSet;

    /// @notice External Wesolowski proof verifier (uses MODEXP precompile)
    IExponentiationVerifier public exponentiationVerifier;

    /// @notice External Groth16 ZK proof verifier (uses BN254 pairing precompile)
    IZKVerifier public zkVerifier;

    /// @notice Circuit ID for non-membership proofs (configurable)
    bytes32 public nonMembershipCircuitId;

    /// @notice Accumulator states by ID
    mapping(bytes32 => AccumulatorState) private _accumulators;

    /// @notice Revocation status: accId => credentialHash => revoked
    mapping(bytes32 => mapping(bytes32 => bool)) private _revoked;

    /// @notice Historical snapshots: accId => epoch => Snapshot
    mapping(bytes32 => mapping(uint256 => Snapshot)) private _snapshots;

    /// @notice Witness update deltas: accId => toEpoch => WitnessUpdateDelta
    mapping(bytes32 => mapping(uint256 => WitnessUpdateDelta)) private _witnessDeltas;

    /// @notice All accumulator IDs
    bytes32[] private _accumulatorIds;

    /// @notice Total revocations across all accumulators
    uint256 public totalRevocations;

    // ──────────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────────

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REVOCATION_AUTHORITY_ROLE, admin);
        _grantRole(WITNESS_UPDATER_ROLE, admin);
        nonMembershipCircuitId = NON_MEMBERSHIP_CIRCUIT_ID;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Verifier configuration
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Set the external Wesolowski exponentiation verifier.
     * @param verifier Address of a contract implementing IExponentiationVerifier
     */
    function setExponentiationVerifier(
        address verifier
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (verifier == address(0)) revert ZeroValueNotAllowed();
        exponentiationVerifier = IExponentiationVerifier(verifier);
        emit ExponentiationVerifierUpdated(verifier);
    }

    /**
     * @notice Set the external Groth16 ZK verifier for non-membership proofs.
     * @param verifier  Address of a contract implementing IZKVerifier
     * @param circuitId Circuit ID for the non-membership proof circuit
     */
    function setZKVerifier(
        address verifier,
        bytes32 circuitId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (verifier == address(0)) revert ZeroValueNotAllowed();
        zkVerifier = IZKVerifier(verifier);
        nonMembershipCircuitId = circuitId;
        emit ZKVerifierUpdated(verifier, circuitId);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Setup
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Set the RSA accumulator parameters (one-time setup).
     * @param rsaModulus      The RSA modulus N (must be ≥ 2048 bits)
     * @param generator       A generator g of the quadratic residues mod N
     * @param modulusBitLength Bit length of the modulus
     */
    function setParameters(
        bytes calldata rsaModulus,
        bytes calldata generator,
        uint256 modulusBitLength
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_paramsSet) revert AccumulatorAlreadyInitialized();
        if (modulusBitLength < MIN_MODULUS_BITS) revert InvalidRSAModulus();
        if (rsaModulus.length == 0 || generator.length == 0) revert ZeroValueNotAllowed();

        // Enforce that byte length matches declared bit length:
        // A 2048-bit modulus requires at least 256 bytes.
        uint256 requiredBytes = (modulusBitLength + 7) / 8;
        if (rsaModulus.length < requiredBytes) revert InvalidRSAModulus();

        // Enforce that the modulus is numerically strong: the leading byte must be
        // non-zero, proving the modulus actually occupies the declared bit space.
        // Without this, a caller could submit a tiny value (e.g. 77) padded with
        // leading zeros, completely collapsing accumulator security.
        if (uint8(rsaModulus[0]) == 0) revert InvalidRSAModulus();

        _params = AccumulatorParams({
            rsaModulus: rsaModulus,
            generator: generator,
            modulusBitLength: modulusBitLength
        });
        _paramsSet = true;
    }

    /**
     * @notice Initialize a new accumulator instance.
     * @param accId         Unique identifier
     * @param initialValue  Initial accumulator value (typically the generator g)
     */
    function initializeAccumulator(
        bytes32 accId,
        bytes calldata initialValue
    ) external onlyRole(REVOCATION_AUTHORITY_ROLE) {
        if (!_paramsSet) revert AccumulatorNotInitialized();
        if (_accumulators[accId].initialized) revert AccumulatorAlreadyInitialized();
        if (initialValue.length == 0) revert ZeroValueNotAllowed();

        bytes32 valueHash = keccak256(initialValue);

        _accumulators[accId] = AccumulatorState({
            id: accId,
            currentValue: initialValue,
            currentValueHash: valueHash,
            epoch: 0,
            memberCount: 0,
            lastUpdated: block.timestamp,
            initialized: true,
            linkedRegistry: address(0)
        });

        _snapshots[accId][0] = Snapshot({
            valueHash: valueHash,
            memberCount: 0,
            timestamp: block.timestamp
        });

        _accumulatorIds.push(accId);

        emit AccumulatorInitialized(accId, _params.modulusBitLength, block.timestamp);
        emit SnapshotCreated(accId, 0, valueHash, block.timestamp);
    }

    /**
     * @notice Link an accumulator to a credential registry contract.
     * @param accId    The accumulator
     * @param registry Address of the credential registry
     */
    function linkRegistry(
        bytes32 accId,
        address registry
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        AccumulatorState storage acc = _accumulators[accId];
        if (!acc.initialized) revert AccumulatorNotInitialized();

        acc.linkedRegistry = registry;
        emit RegistryLinked(accId, registry, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Revocation
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Revoke a single credential by adding it to the accumulator.
     * @param accId            Accumulator identifier
     * @param credentialHash   Hash of the credential to revoke
     * @param newValue         New accumulator value: V' = V^{H(credential)} mod N
     * @param proof            ABI-encoded Wesolowski quotient Q (modulus-sized bytes)
     */
    function revokeCredential(
        bytes32 accId,
        bytes32 credentialHash,
        bytes calldata newValue,
        bytes calldata proof
    ) external onlyRole(REVOCATION_AUTHORITY_ROLE) whenNotPaused nonReentrant {
        AccumulatorState storage acc = _accumulators[accId];
        if (!acc.initialized) revert AccumulatorNotInitialized();
        if (_revoked[accId][credentialHash]) revert CredentialAlreadyRevoked();

        // Verify the exponentiation proof: V' = V^{H(credentialHash)} mod N
        if (!_verifyExponentiationProof(acc, credentialHash, newValue, proof)) {
            revert InvalidAccumulatorValue();
        }

        bytes32 oldHash = acc.currentValueHash;
        acc.currentValue = newValue;
        acc.currentValueHash = keccak256(newValue);
        acc.epoch += 1;
        acc.memberCount += 1;
        acc.lastUpdated = block.timestamp;

        _revoked[accId][credentialHash] = true;

        // Create snapshot
        _snapshots[accId][acc.epoch] = Snapshot({
            valueHash: acc.currentValueHash,
            memberCount: acc.memberCount,
            timestamp: block.timestamp
        });

        unchecked { ++totalRevocations; }

        emit CredentialRevoked(accId, credentialHash, acc.epoch, block.timestamp);
        emit AccumulatorUpdated(accId, oldHash, acc.currentValueHash, acc.epoch, block.timestamp);
        emit SnapshotCreated(accId, acc.epoch, acc.currentValueHash, block.timestamp);
    }

    /**
     * @notice Batch revoke multiple credentials in a single transaction.
     * @dev More gas-efficient than individual revocations. The new accumulator value
     *      is V' = V^{∏ H(cred_i)} mod N.
     * @param accId  Accumulator identifier
     * @param batch  Batch update containing credentials and proof
     */
    function batchRevoke(
        bytes32 accId,
        BatchUpdate calldata batch
    ) external onlyRole(REVOCATION_AUTHORITY_ROLE) whenNotPaused nonReentrant {
        AccumulatorState storage acc = _accumulators[accId];
        if (!acc.initialized) revert AccumulatorNotInitialized();
        if (batch.credentialHashes.length == 0) revert ZeroValueNotAllowed();
        if (batch.credentialHashes.length > MAX_BATCH_SIZE) revert BatchTooLarge();

        // Verify no credential is already revoked
        for (uint256 i = 0; i < batch.credentialHashes.length; i++) {
            if (_revoked[accId][batch.credentialHashes[i]]) {
                revert CredentialAlreadyRevoked();
            }
        }

        // Verify the batch proof
        if (!_verifyBatchProof(acc, batch)) {
            revert InvalidBatchUpdate();
        }

        // Apply the batch update
        bytes32 oldHash = acc.currentValueHash;
        acc.currentValue = batch.newAccumulatorValue;
        acc.currentValueHash = keccak256(batch.newAccumulatorValue);
        acc.epoch += 1;
        acc.memberCount += batch.credentialHashes.length;
        acc.lastUpdated = block.timestamp;

        // Mark all as revoked
        for (uint256 i = 0; i < batch.credentialHashes.length; i++) {
            _revoked[accId][batch.credentialHashes[i]] = true;
        }

        // Create snapshot
        _snapshots[accId][acc.epoch] = Snapshot({
            valueHash: acc.currentValueHash,
            memberCount: acc.memberCount,
            timestamp: block.timestamp
        });

        totalRevocations += batch.credentialHashes.length;

        emit BatchRevocation(accId, batch.credentialHashes.length, acc.epoch, block.timestamp);
        emit AccumulatorUpdated(accId, oldHash, acc.currentValueHash, acc.epoch, block.timestamp);
        emit SnapshotCreated(accId, acc.epoch, acc.currentValueHash, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Non-membership verification
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Verify that a credential is NOT in the revocation accumulator.
     * @dev Delegates to the external IZKVerifier for Groth16 proof verification.
     *      The ZK circuit proves knowledge of a Bézout non-membership witness
     *      (d, b) such that d^{H(e)} · V^b ≡ g (mod N), without revealing d or b.
     * @param accId    Accumulator identifier
     * @param witness  Non-membership witness (used for public input derivation)
     * @param zkProof  ABI-encoded Groth16Proof
     * @return valid   True if the credential is confirmed non-revoked
     */
    function verifyNonMembership(
        bytes32 accId,
        NonMembershipWitness calldata witness,
        bytes calldata zkProof
    ) external view returns (bool valid) {
        AccumulatorState storage acc = _accumulators[accId];
        if (!acc.initialized) revert AccumulatorNotInitialized();

        // Witness must be for current epoch
        if (witness.epoch != acc.epoch) revert EpochMismatch();

        // Credential must not be known-revoked (defense in depth)
        if (_revoked[accId][witness.credentialHash]) return false;

        // Verify the ZK proof of non-membership
        valid = _verifyNonMembershipZKProof(
            acc,
            witness,
            zkProof
        );
    }

    /**
     * @notice Verify non-membership at a historical epoch (point-in-time check).
     * @param accId            Accumulator identifier
     * @param witness          Non-membership witness
     * @param historicalEpoch  The epoch to verify against
     * @param zkProof          ABI-encoded Groth16Proof
     * @return valid           True if non-revoked at the given epoch
     */
    function verifyNonMembershipAtEpoch(
        bytes32 accId,
        NonMembershipWitness calldata witness,
        uint256 historicalEpoch,
        bytes calldata zkProof
    ) external view returns (bool valid) {
        AccumulatorState storage acc = _accumulators[accId];
        if (!acc.initialized) revert AccumulatorNotInitialized();

        Snapshot storage snap = _snapshots[accId][historicalEpoch];
        if (snap.timestamp == 0) revert SnapshotNotFound();

        // Witness epoch must match the queried epoch
        if (witness.epoch != historicalEpoch) revert EpochMismatch();

        // Verify ZK proof against historical accumulator value hash
        valid = _verifyNonMembershipZKProofAtSnapshot(
            snap.valueHash,
            witness,
            zkProof
        );
    }

    // ──────────────────────────────────────────────────────────────────────
    // Witness updates
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Publish a witness update delta for holders.
     * @param accId  Accumulator identifier
     * @param delta  The witness update delta
     */
    function publishWitnessUpdate(
        bytes32 accId,
        WitnessUpdateDelta calldata delta
    ) external onlyRole(WITNESS_UPDATER_ROLE) whenNotPaused {
        AccumulatorState storage acc = _accumulators[accId];
        if (!acc.initialized) revert AccumulatorNotInitialized();

        // Verify consistency
        if (delta.toEpoch != acc.epoch) revert EpochMismatch();
        if (keccak256(delta.accumulatorAtTo) != acc.currentValueHash) {
            revert InvalidWitnessUpdate();
        }

        // Verify the from-epoch accumulator value
        Snapshot storage fromSnap = _snapshots[accId][delta.fromEpoch];
        if (fromSnap.timestamp == 0) revert SnapshotNotFound();
        if (keccak256(delta.accumulatorAtFrom) != fromSnap.valueHash) {
            revert InvalidWitnessUpdate();
        }

        _witnessDeltas[accId][delta.toEpoch] = delta;

        emit WitnessUpdatePublished(accId, delta.fromEpoch, delta.toEpoch, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // View functions
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Get the current accumulator value hash and epoch
    function getCurrentState(bytes32 accId) external view returns (
        bytes32 valueHash,
        uint256 epoch,
        uint256 memberCount,
        uint256 lastUpdated
    ) {
        AccumulatorState storage acc = _accumulators[accId];
        return (acc.currentValueHash, acc.epoch, acc.memberCount, acc.lastUpdated);
    }

    /// @notice Check if a credential is explicitly revoked
    function isRevoked(bytes32 accId, bytes32 credentialHash) external view returns (bool) {
        return _revoked[accId][credentialHash];
    }

    /// @notice Get a historical snapshot
    function getSnapshot(bytes32 accId, uint256 epoch) external view returns (Snapshot memory) {
        return _snapshots[accId][epoch];
    }

    /// @notice Get the witness update delta for an epoch
    function getWitnessUpdateDelta(
        bytes32 accId,
        uint256 toEpoch
    ) external view returns (WitnessUpdateDelta memory) {
        return _witnessDeltas[accId][toEpoch];
    }

    /// @notice Get accumulator parameters
    function getParameters() external view returns (
        uint256 modulusBitLength,
        uint256 modulusLength,
        uint256 generatorLength
    ) {
        return (_params.modulusBitLength, _params.rsaModulus.length, _params.generator.length);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ──────────────────────────────────────────────────────────────────────
    // Internal functions
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @dev Hash a credential hash to a prime number (deterministic).
     *      Uses iterative hashing with a counter until the result passes
     *      a Miller-Rabin primality test (20 rounds, first 20 prime witnesses).
     */
    function _hashToPrime(bytes32 credentialHash) internal view returns (uint256) {
        uint256 candidate;
        uint256 counter = 0;

        while (counter < 1000) {
            candidate = uint256(
                keccak256(abi.encodePacked(HASH_TO_PRIME_DOMAIN, credentialHash, counter))
            );
            // Ensure odd (necessary but not sufficient for primality)
            candidate = candidate | 1;
            if (_isProbablyPrime(candidate)) {
                return candidate;
            }
            unchecked { ++counter; }
        }
        revert("hashToPrime: no prime found in 1000 iterations");
    }

    /**
     * @dev Probabilistic primality test using Miller-Rabin with 20 deterministic
     *      prime witnesses and the MODEXP precompile (0x05) for modular exponentiation.
     *
     *      Trial division filters composites divisible by small primes cheaply.
     *      Miller-Rabin then tests the remaining candidates. With 20 independent
     *      witnesses, the false-positive probability is at most 4^{-20} ≈ 10^{-12}.
     */
    function _isProbablyPrime(uint256 n) internal view returns (bool) {
        if (n < 2) return false;
        if (n < 4) return true;
        if (n % 2 == 0 || n % 3 == 0) return false;

        // Trial division by small primes (cheap filter for most composites)
        uint256 td = 5;
        while (td * td <= n && td < 1000) {
            if (n % td == 0 || n % (td + 2) == 0) return false;
            unchecked { td += 6; }
        }
        // If trial division fully covered sqrt(n), the number is prime
        if (td * td > n) return true;

        // Miller-Rabin: write n - 1 = 2^r · d where d is odd
        uint256 d = n - 1;
        uint256 r = 0;
        while (d % 2 == 0) {
            d >>= 1;
            unchecked { ++r; }
        }

        // 20 deterministic witnesses (first 20 primes)
        uint8[20] memory witnesses = [
            2, 3, 5, 7, 11, 13, 17, 19, 23, 29,
            31, 37, 41, 43, 47, 53, 59, 61, 67, 71
        ];

        for (uint256 i = 0; i < 20;) {
            uint256 a = uint256(witnesses[i]);
            if (a >= n) { unchecked { ++i; } continue; }

            // x = a^d mod n
            uint256 x = _modexpUint256(a, d, n);

            if (x == 1 || x == n - 1) { unchecked { ++i; } continue; }

            bool composite = true;
            for (uint256 j = 1; j < r; j++) {
                x = _modexpUint256(x, 2, n);
                if (x == n - 1) {
                    composite = false;
                    break;
                }
            }
            if (composite) return false;

            unchecked { ++i; }
        }
        return true;
    }

    /**
     * @dev Modular exponentiation for uint256 values via the MODEXP precompile (0x05).
     *      Computes base^exp mod mod using 32-byte (uint256) operands.
     */
    function _modexpUint256(
        uint256 base_,
        uint256 exponent,
        uint256 modulus_
    ) internal view returns (uint256 result) {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x20)                // base length  = 32
            mstore(add(ptr, 0x20), 0x20)     // exp length   = 32
            mstore(add(ptr, 0x40), 0x20)     // mod length   = 32
            mstore(add(ptr, 0x60), base_)
            mstore(add(ptr, 0x80), exponent)
            mstore(add(ptr, 0xa0), modulus_)
            if iszero(staticcall(gas(), 0x05, ptr, 0xc0, ptr, 0x20)) {
                revert(0, 0)
            }
            result := mload(ptr)
        }
    }

    /**
     * @dev Derive the Fiat-Shamir challenge for a Wesolowski proof.
     *      l = H(V, V') | 1, matching the verifier's derivation.
     *      Per Wesolowski's protocol, l is derived from the claim only
     *      (base and result), NOT from the quotient Q, to avoid a
     *      circular dependency during proof construction.
     */
    function _deriveFiatShamirChallenge(
        bytes storage base,
        bytes calldata result_
    ) internal view returns (uint256 l) {
        l = uint256(keccak256(abi.encodePacked(
            keccak256(base),
            keccak256(result_)
        ))) | 1;
    }

    /**
     * @dev Verify an exponentiation proof: V' = V^{H(cred)} mod N.
     *      Pre-computes r = prime mod l (Fiat-Shamir challenge), then delegates
     *      to the external IExponentiationVerifier which verifies:
     *        Q^l · V^r ≡ V' (mod N)
     *      using the MODEXP precompile.
     */
    function _verifyExponentiationProof(
        AccumulatorState storage acc,
        bytes32 credentialHash,
        bytes calldata newValue,
        bytes calldata proof
    ) internal view returns (bool) {
        if (address(exponentiationVerifier) == address(0)) {
            revert ExponentiationVerifierNotSet();
        }
        if (newValue.length == 0) return false;

        uint256 prime = _hashToPrime(credentialHash);

        // The proof IS the Wesolowski quotient Q (modulus-sized, big-endian)
        bytes calldata quotientQ = proof;

        // Derive Fiat-Shamir challenge and compute remainder
        uint256 l = _deriveFiatShamirChallenge(acc.currentValue, newValue);
        uint256 r = prime % l;

        // Delegate: verifier re-derives l independently and checks Q^l · V^r ≡ V' (mod N)
        return exponentiationVerifier.verifyExponentiation(
            acc.currentValue,    // base V
            newValue,            // result V'
            r,                   // pre-computed remainder
            quotientQ,           // Wesolowski quotient Q
            _params.rsaModulus   // modulus N
        );
    }

    /**
     * @dev Verify a batch revocation proof.
     *      The combined exponent is the product of all H(cred_i), which may
     *      exceed uint256. Instead of computing the full product, we reduce
     *      incrementally: r = (p1 · p2 · ... · pk) mod l using native mulmod.
     *      This is algebraically correct because:
     *        (a mod l · b mod l) mod l = (a · b) mod l
     */
    function _verifyBatchProof(
        AccumulatorState storage acc,
        BatchUpdate calldata batch
    ) internal view returns (bool) {
        if (address(exponentiationVerifier) == address(0)) {
            revert ExponentiationVerifierNotSet();
        }
        if (batch.newAccumulatorValue.length == 0) return false;

        bytes calldata quotientQ = batch.proof;

        // Derive Fiat-Shamir challenge first (needed for correct modular reduction)
        uint256 l = _deriveFiatShamirChallenge(acc.currentValue, batch.newAccumulatorValue);

        // Compute r = (∏ H(cred_i)) mod l using incremental mulmod.
        // This produces the TRUE remainder without needing a big-number product.
        uint256 r = 1;
        for (uint256 i = 0; i < batch.credentialHashes.length; i++) {
            uint256 prime = _hashToPrime(batch.credentialHashes[i]);
            r = mulmod(r, prime, l);
        }

        return exponentiationVerifier.verifyExponentiation(
            acc.currentValue,              // base V
            batch.newAccumulatorValue,      // result V'
            r,                             // correctly reduced remainder
            quotientQ,                     // Wesolowski quotient Q
            _params.rsaModulus             // modulus N
        );
    }

    /**
     * @dev Verify a ZK proof of non-membership against the current accumulator.
     *      Delegates to the external IZKVerifier for real Groth16 pairing-based
     *      verification. The circuit proves knowledge of witness values (d, b)
     *      satisfying the Bézout identity without revealing them.
     *
     *      Public inputs to the circuit:
     *        [0] = keccak256(accumulatorValueHash, credentialHash)  — accumulator binding
     *        [1] = keccak256(generator)                             — generator binding
     *        [2] = epoch                                            — freshness binding
     */
    function _verifyNonMembershipZKProof(
        AccumulatorState storage acc,
        NonMembershipWitness calldata witness,
        bytes calldata zkProof
    ) internal view returns (bool) {
        if (address(zkVerifier) == address(0)) revert ZKVerifierNotSet();

        // Decode the Groth16 proof from calldata
        Groth16Proof memory proof = abi.decode(zkProof, (Groth16Proof));

        // Build the public inputs that the circuit must satisfy
        uint256[] memory publicInputs = new uint256[](3);
        publicInputs[0] = uint256(keccak256(abi.encodePacked(
            acc.currentValueHash,
            witness.credentialHash
        )));
        publicInputs[1] = uint256(keccak256(_params.generator));
        publicInputs[2] = witness.epoch;

        // Delegate to the external Groth16 verifier (BN254 pairing precompile)
        return zkVerifier.verifyProof(nonMembershipCircuitId, proof, publicInputs);
    }

    /**
     * @dev Verify non-membership at a historical snapshot.
     */
    function _verifyNonMembershipZKProofAtSnapshot(
        bytes32 snapshotValueHash,
        NonMembershipWitness calldata witness,
        bytes calldata zkProof
    ) internal view returns (bool) {
        if (address(zkVerifier) == address(0)) revert ZKVerifierNotSet();

        Groth16Proof memory proof = abi.decode(zkProof, (Groth16Proof));

        uint256[] memory publicInputs = new uint256[](3);
        publicInputs[0] = uint256(keccak256(abi.encodePacked(
            snapshotValueHash,
            witness.credentialHash
        )));
        publicInputs[1] = uint256(keccak256(_params.generator));
        publicInputs[2] = witness.epoch;

        return zkVerifier.verifyProof(nonMembershipCircuitId, proof, publicInputs);
    }
}
