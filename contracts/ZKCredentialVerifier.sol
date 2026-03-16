// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IZeroID.sol";

/**
 * @title ZKCredentialVerifier
 * @author Aethelred Team
 * @notice On-chain Groth16 ZK proof verification for the ZeroID protocol.
 *         Supports multiple circuit types (age, KYC, accreditation, etc.)
 *         with independently upgradeable verification keys.
 *
 * @dev Implementation notes:
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │                   ZK CREDENTIAL VERIFIER                       │
 * ├────────────────────────────────────────────────────────────────┤
 * │  ┌────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
 * │  │  Circuit Mgmt   │  │  Proof Verify     │  │  Audit Trail │  │
 * │  │  ──────────────  │  │  ────────────     │  │  ──────────  │  │
 * │  │  • register vk   │  │  • Groth16 check  │  │  • proof log │  │
 * │  │  • update vk     │  │  • BN254 pairing  │  │  • nullifier │  │
 * │  │  • deactivate    │  │  • input validate │  │  • replay    │  │
 * │  └────────────────┘  └──────────────────┘  └──────────────┘  │
 * └────────────────────────────────────────────────────────────────┘
 *
 * The verifier uses the alt_bn128 (BN254) elliptic curve precompiles at
 * addresses 0x06 (ecAdd), 0x07 (ecMul), and 0x08 (ecPairing) for
 * gas-efficient on-chain Groth16 verification.
 *
 * Nullifier tracking prevents proof replay: each proof generates a
 * unique nullifier that is stored on-chain after successful verification.
 */
contract ZKCredentialVerifier is IZKVerifier, AccessControl, Pausable, ReentrancyGuard {

    // ──────────────────────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────────────────────

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant CIRCUIT_MANAGER_ROLE = keccak256("CIRCUIT_MANAGER_ROLE");

    // ──────────────────────────────────────────────────────────────
    // Constants — BN254 curve order
    // ──────────────────────────────────────────────────────────────

    uint256 internal constant PRIME_Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
    uint256 internal constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // ──────────────────────────────────────────────────────────────
    // Storage — Verification Keys
    // ──────────────────────────────────────────────────────────────

    struct VerificationKey {
        uint256[2] alpha;
        uint256[2][2] beta;
        uint256[2][2] gamma;
        uint256[2][2] delta;
        uint256[2][] ic;          // Input commitment points
        bool isActive;
        uint64 registeredAt;
        uint64 updatedAt;
        uint32 verificationCount;
    }

    /// @dev circuitId => VerificationKey
    mapping(bytes32 => VerificationKey) private _verificationKeys;

    /// @dev All registered circuit IDs for enumeration
    bytes32[] private _circuitIds;

    /// @dev Nullifier tracking: keccak256(proof) => used flag
    mapping(bytes32 => bool) private _usedNullifiers;

    /// @dev Proof audit log
    struct ProofRecord {
        bytes32 circuitId;
        bytes32 nullifier;
        address verifier;
        uint64 verifiedAt;
        bool valid;
    }

    /// @dev proofHash => ProofRecord
    mapping(bytes32 => ProofRecord) private _proofRecords;

    /// @notice Total successful verifications across all circuits
    uint256 public totalVerifications;

    // ──────────────────────────────────────────────────────────────
    // Events (beyond interface)
    // ──────────────────────────────────────────────────────────────

    event CircuitRegistered(bytes32 indexed circuitId, uint256 icLength, uint64 timestamp);
    event CircuitDeactivated(bytes32 indexed circuitId, uint64 timestamp);
    event NullifierUsed(bytes32 indexed nullifier, bytes32 indexed circuitId);

    // ──────────────────────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────────────────────

    error CircuitNotRegistered(bytes32 circuitId);
    error CircuitNotActive(bytes32 circuitId);
    error CircuitAlreadyRegistered(bytes32 circuitId);
    error InvalidICLength(uint256 expected, uint256 actual);
    error InvalidProofPoint();
    error NullifierAlreadyUsed(bytes32 nullifier);
    error InvalidInputCount(uint256 expected, uint256 actual);
    error InputOutOfField(uint256 input);
    error PairingFailed();

    // ──────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────

    /// @param admin Initial admin and circuit manager
    constructor(address admin) {
        require(admin != address(0), "Zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
        _grantRole(CIRCUIT_MANAGER_ROLE, admin);
    }

    // ──────────────────────────────────────────────────────────────
    // Circuit Management
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc IZKVerifier
    function setVerificationKey(
        bytes32 circuitId,
        uint256[2] calldata alpha,
        uint256[2][2] calldata beta,
        uint256[2][2] calldata gamma,
        uint256[2][2] calldata delta,
        uint256[2][] calldata ic
    ) external override onlyRole(CIRCUIT_MANAGER_ROLE) {
        require(circuitId != bytes32(0), "Zero circuit ID");
        require(ic.length >= 2, "IC must have at least 2 points");

        // Validate all points are on the curve (< PRIME_Q)
        _validateG1Point(alpha);
        for (uint256 i = 0; i < ic.length; ) {
            _validateG1Point(ic[i]);
            unchecked { i++; }
        }

        bool isNew = !_verificationKeys[circuitId].isActive &&
                      _verificationKeys[circuitId].registeredAt == 0;

        VerificationKey storage vk = _verificationKeys[circuitId];
        vk.alpha = alpha;
        vk.beta = beta;
        vk.gamma = gamma;
        vk.delta = delta;
        vk.isActive = true;

        // Copy IC points
        delete vk.ic;
        for (uint256 i = 0; i < ic.length; ) {
            vk.ic.push(ic[i]);
            unchecked { i++; }
        }

        uint64 now64 = uint64(block.timestamp);
        if (isNew) {
            vk.registeredAt = now64;
            _circuitIds.push(circuitId);
            emit CircuitRegistered(circuitId, ic.length, now64);
        }
        vk.updatedAt = now64;

        emit VerificationKeyUpdated(circuitId, now64);
    }

    /// @notice Deactivate a circuit (does not delete the key)
    /// @param circuitId The circuit to deactivate
    function deactivateCircuit(bytes32 circuitId) external onlyRole(CIRCUIT_MANAGER_ROLE) {
        if (!_verificationKeys[circuitId].isActive) revert CircuitNotActive(circuitId);
        _verificationKeys[circuitId].isActive = false;
        emit CircuitDeactivated(circuitId, uint64(block.timestamp));
    }

    /// @inheritdoc IZKVerifier
    function isCircuitRegistered(bytes32 circuitId) external view override returns (bool) {
        return _verificationKeys[circuitId].isActive;
    }

    /// @notice Get the number of registered circuits
    function circuitCount() external view returns (uint256) {
        return _circuitIds.length;
    }

    /// @notice Get circuit verification stats
    function getCircuitStats(bytes32 circuitId) external view returns (
        bool isActive,
        uint64 registeredAt,
        uint64 updatedAt,
        uint32 verificationCount,
        uint256 icLength
    ) {
        VerificationKey storage vk = _verificationKeys[circuitId];
        return (vk.isActive, vk.registeredAt, vk.updatedAt, vk.verificationCount, vk.ic.length);
    }

    // ──────────────────────────────────────────────────────────────
    // Proof Verification
    // ──────────────────────────────────────────────────────────────

    /// @inheritdoc IZKVerifier
    function verifyProof(
        bytes32 circuitId,
        Groth16Proof calldata proof,
        uint256[] calldata publicInputs
    ) external view override returns (bool) {
        return _verifyProofInternal(circuitId, proof, publicInputs);
    }

    /// @notice Verify a proof and record the result on-chain with nullifier tracking
    /// @param circuitId The circuit to verify against
    /// @param proof The Groth16 proof
    /// @param publicInputs The public inputs
    /// @param nullifier Unique nullifier to prevent replay
    /// @return valid Whether the proof is valid
    function verifyAndRecord(
        bytes32 circuitId,
        Groth16Proof calldata proof,
        uint256[] calldata publicInputs,
        bytes32 nullifier
    ) external whenNotPaused nonReentrant returns (bool valid) {
        if (_usedNullifiers[nullifier]) revert NullifierAlreadyUsed(nullifier);

        valid = _verifyProofInternal(circuitId, proof, publicInputs);

        // Mark nullifier as used regardless of result to prevent retry attacks
        _usedNullifiers[nullifier] = true;

        bytes32 proofHash = keccak256(abi.encode(proof.a, proof.b, proof.c, publicInputs));

        _proofRecords[proofHash] = ProofRecord({
            circuitId: circuitId,
            nullifier: nullifier,
            verifier: msg.sender,
            verifiedAt: uint64(block.timestamp),
            valid: valid
        });

        if (valid) {
            unchecked {
                _verificationKeys[circuitId].verificationCount++;
                totalVerifications++;
            }
        }

        emit NullifierUsed(nullifier, circuitId);
        emit ProofVerified(proofHash, circuitId, valid);
    }

    /// @notice Check if a nullifier has been used
    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return _usedNullifiers[nullifier];
    }

    /// @notice Retrieve a proof record
    function getProofRecord(bytes32 proofHash) external view returns (ProofRecord memory) {
        return _proofRecords[proofHash];
    }

    // ──────────────────────────────────────────────────────────────
    // Internal — Groth16 Verification (BN254)
    // ──────────────────────────────────────────────────────────────

    /// @dev Core Groth16 verification using EIP-196/197 precompiles
    function _verifyProofInternal(
        bytes32 circuitId,
        Groth16Proof calldata proof,
        uint256[] calldata publicInputs
    ) internal view returns (bool) {
        VerificationKey storage vk = _verificationKeys[circuitId];
        if (vk.registeredAt == 0) revert CircuitNotRegistered(circuitId);
        if (!vk.isActive) revert CircuitNotActive(circuitId);

        // Public inputs count must match IC length - 1
        uint256 expectedInputs = vk.ic.length - 1;
        if (publicInputs.length != expectedInputs) {
            revert InvalidInputCount(expectedInputs, publicInputs.length);
        }

        // Validate all public inputs are in the scalar field
        for (uint256 i = 0; i < publicInputs.length; ) {
            if (publicInputs[i] >= SNARK_SCALAR_FIELD) revert InputOutOfField(publicInputs[i]);
            unchecked { i++; }
        }

        // Validate proof points
        _validateG1Point(proof.a);
        _validateG1Point(proof.c);

        // Compute the linear combination: vk_x = IC[0] + sum(publicInputs[i] * IC[i+1])
        uint256[2] memory vkX = [vk.ic[0][0], vk.ic[0][1]];

        for (uint256 i = 0; i < publicInputs.length; ) {
            uint256[2] memory mulResult = _ecMul(vk.ic[i + 1], publicInputs[i]);
            vkX = _ecAdd(vkX, mulResult);
            unchecked { i++; }
        }

        // Construct pairing input: e(A, B) == e(alpha, beta) * e(vk_x, gamma) * e(C, delta)
        // Rearranged: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
        return _ecPairing(
            _negate(proof.a), proof.b,
            vk.alpha, vk.beta,
            vkX, vk.gamma,
            proof.c, vk.delta
        );
    }

    /// @dev Validate that a G1 point's coordinates are < PRIME_Q
    function _validateG1Point(uint256[2] memory point) internal pure {
        if (point[0] >= PRIME_Q || point[1] >= PRIME_Q) revert InvalidProofPoint();
    }

    /// @dev Negate a G1 point (reflect over x-axis)
    function _negate(uint256[2] memory p) internal pure returns (uint256[2] memory) {
        if (p[0] == 0 && p[1] == 0) return p;
        return [p[0], PRIME_Q - (p[1] % PRIME_Q)];
    }

    /// @dev Elliptic curve addition using precompile at 0x06
    function _ecAdd(uint256[2] memory p1, uint256[2] memory p2)
        internal view returns (uint256[2] memory result)
    {
        uint256[4] memory input;
        input[0] = p1[0];
        input[1] = p1[1];
        input[2] = p2[0];
        input[3] = p2[1];

        bool success;
        assembly {
            success := staticcall(gas(), 0x06, input, 0x80, result, 0x40)
        }
        require(success, "ecAdd failed");
    }

    /// @dev Elliptic curve scalar multiplication using precompile at 0x07
    function _ecMul(uint256[2] memory p, uint256 s)
        internal view returns (uint256[2] memory result)
    {
        uint256[3] memory input;
        input[0] = p[0];
        input[1] = p[1];
        input[2] = s;

        bool success;
        assembly {
            success := staticcall(gas(), 0x07, input, 0x60, result, 0x40)
        }
        require(success, "ecMul failed");
    }

    /// @dev BN254 pairing check using precompile at 0x08
    ///      Returns true if the pairing equation holds
    function _ecPairing(
        uint256[2] memory a1, uint256[2][2] memory b1,
        uint256[2] memory a2, uint256[2][2] memory b2,
        uint256[2] memory a3, uint256[2][2] memory b3,
        uint256[2] memory a4, uint256[2][2] memory b4
    ) internal view returns (bool) {
        uint256[24] memory input;

        // Pair 1: (-A, B)
        input[0]  = a1[0];  input[1]  = a1[1];
        input[2]  = b1[0][1]; input[3]  = b1[0][0];
        input[4]  = b1[1][1]; input[5]  = b1[1][0];

        // Pair 2: (alpha, beta)
        input[6]  = a2[0];  input[7]  = a2[1];
        input[8]  = b2[0][1]; input[9]  = b2[0][0];
        input[10] = b2[1][1]; input[11] = b2[1][0];

        // Pair 3: (vk_x, gamma)
        input[12] = a3[0];  input[13] = a3[1];
        input[14] = b3[0][1]; input[15] = b3[0][0];
        input[16] = b3[1][1]; input[17] = b3[1][0];

        // Pair 4: (C, delta)
        input[18] = a4[0];  input[19] = a4[1];
        input[20] = b4[0][1]; input[21] = b4[0][0];
        input[22] = b4[1][1]; input[23] = b4[1][0];

        uint256[1] memory result;
        bool success;
        assembly {
            success := staticcall(gas(), 0x08, input, 0x300, result, 0x20)
        }
        if (!success) revert PairingFailed();
        return result[0] == 1;
    }

    // ──────────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────────

    function pause() external onlyRole(ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(ADMIN_ROLE) { _unpause(); }
}
