// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import "../../../contracts/ZeroID.sol";
import "../../../contracts/CredentialRegistry.sol";
import "../../../contracts/ZKCredentialVerifier.sol";
import "../../../contracts/GovernanceModule.sol";
import "../../../contracts/TEEAttestationRegistry.sol";
import "../../../contracts/BBSPlusCredential.sol";
import "../../../contracts/ThresholdCredential.sol";
import "../../../contracts/SelectiveDisclosure.sol";
import "../../../contracts/AccumulatorRevocation.sol";
import "../../../contracts/interfaces/IExponentiationVerifier.sol";
import "../../../contracts/verifiers/WesolowskiVerifier.sol";
import "../../../contracts/CrossChainIdentityBridge.sol";
import "../../../contracts/RegulatoryCompliance.sol";
import "../../../contracts/AIAgentRegistry.sol";
import "../../../contracts/interfaces/IZeroID.sol";
import "../../../contracts/libraries/BN254.sol";

/// @title TestHelper
/// @notice Shared test utilities, constants, and mock contracts for ZeroID Foundry tests.
abstract contract TestHelper is Test {
    // ── Common addresses ────────────────────────────────────────────
    address internal admin = address(0xA11CE);
    address internal alice = address(0xA1);
    address internal bob   = address(0xB0B);
    address internal carol = address(0xCA401);
    address internal dave  = address(0xDA7E);
    address internal eve   = address(0xE7E);
    address internal operator = address(0x09E4A704);

    // ── Common DID / credential hashes ──────────────────────────────
    bytes32 internal constant DID_HASH_1 = keccak256("did:zeroid:alice");
    bytes32 internal constant DID_HASH_2 = keccak256("did:zeroid:bob");
    bytes32 internal constant DID_HASH_3 = keccak256("did:zeroid:carol");
    bytes32 internal constant RECOVERY_HASH_1 = keccak256(abi.encodePacked(bytes32(keccak256("recovery_secret_1"))));
    bytes32 internal constant RECOVERY_SECRET_1 = keccak256("recovery_secret_1");
    bytes32 internal constant SCHEMA_HASH_1 = keccak256("schema:kyc:v1");
    bytes32 internal constant CREDENTIAL_HASH_1 = keccak256("cred:alice:kyc:1");
    bytes32 internal constant CREDENTIAL_HASH_2 = keccak256("cred:bob:kyc:1");
    bytes32 internal constant MERKLE_ROOT_1 = keccak256("merkle_root_1");

    // ── Helper functions ────────────────────────────────────────────

    /// @notice Register an identity on ZeroID for a given caller
    function _registerIdentity(
        ZeroID zeroid,
        address caller,
        bytes32 didHash,
        bytes32 recoveryHash
    ) internal {
        vm.prank(caller);
        zeroid.registerIdentity(didHash, recoveryHash);
    }

    /// @notice Get a dummy Groth16 proof (will fail real verification but is structurally valid)
    function _dummyProof() internal pure returns (Groth16Proof memory) {
        return Groth16Proof({
            a: [uint256(1), uint256(2)],
            b: [[uint256(1), uint256(2)], [uint256(3), uint256(4)]],
            c: [uint256(1), uint256(2)]
        });
    }

    /// @notice Generate unique bytes32 from a string + index
    function _hash(string memory prefix, uint256 index) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(prefix, index));
    }
}
