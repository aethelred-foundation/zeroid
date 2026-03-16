pragma circom 2.1.6;

// =============================================================================
// ZeroID — Nationality Proof Circuit
// =============================================================================
// Proves that a user's nationality belongs to a permitted set WITHOUT
// revealing which specific nationality they hold.
//
// Cryptographic approach:
//   1. The user holds an identity credential with a numeric nationality code
//      (ISO 3166-1 numeric) issued by a trusted authority.
//   2. Credential binding via Poseidon hash:
//        credentialHash = Poseidon(subjectId, nationalityCode, documentType,
//                                 documentHash, expiryTimestamp,
//                                 issuerPubKeyX, issuerPubKeyY, nonce)
//   3. Set membership: the circuit proves nationalityCode is in the public
//      allowedNationalities set using equality checks across all entries.
//   4. Merkle-tree alternative: for larger sets, a Merkle inclusion proof is
//      more efficient. This circuit supports both flat-set and Merkle modes
//      via a template parameter.
//
// Parameters:
//   N_BITS       — bit width for comparisons (default 64)
//   SET_SIZE     — max nationalities in the flat set (default 32)
//   TREE_DEPTH   — depth of Merkle tree for large-set mode (default 8, 256 leaves)
// =============================================================================

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "circomlib/circuits/mux1.circom";
include "circomlib/circuits/gates.circom";

/// @title MerkleInclusionProof
/// @notice Verifies that a leaf is included in a Poseidon Merkle tree.
/// @dev The pathIndices array encodes the path direction at each level
///      (0 = leaf is on the left, 1 = leaf is on the right).
template MerkleInclusionProof(DEPTH) {
    signal input leaf;
    signal input root;
    signal input pathElements[DEPTH];
    signal input pathIndices[DEPTH];    // 0 or 1 at each level

    signal intermediateHashes[DEPTH + 1];
    intermediateHashes[0] <== leaf;

    component hashers[DEPTH];
    component muxLeft[DEPTH];
    component muxRight[DEPTH];

    for (var i = 0; i < DEPTH; i++) {
        // Enforce pathIndices are binary.
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // Select ordering based on path direction.
        // If pathIndices[i] == 0: hash(current, sibling)
        // If pathIndices[i] == 1: hash(sibling, current)
        muxLeft[i] = Mux1();
        muxLeft[i].c[0] <== intermediateHashes[i];
        muxLeft[i].c[1] <== pathElements[i];
        muxLeft[i].s <== pathIndices[i];

        muxRight[i] = Mux1();
        muxRight[i].c[0] <== pathElements[i];
        muxRight[i].c[1] <== intermediateHashes[i];
        muxRight[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== muxLeft[i].out;
        hashers[i].inputs[1] <== muxRight[i].out;

        intermediateHashes[i + 1] <== hashers[i].out;
    }

    // The final computed root must match the public Merkle root.
    intermediateHashes[DEPTH] === root;
}

/// @title FlatSetMembership
/// @notice Checks if a value exists in a flat array of allowed values.
template FlatSetMembership(SET_SIZE) {
    signal input value;
    signal input set[SET_SIZE];
    signal output isMember;

    component eq[SET_SIZE];
    signal accum[SET_SIZE + 1];
    accum[0] <== 0;

    for (var i = 0; i < SET_SIZE; i++) {
        eq[i] = IsEqual();
        eq[i].in[0] <== value;
        eq[i].in[1] <== set[i];
        accum[i + 1] <== accum[i] + eq[i].out;
    }

    component isNonZero = IsZero();
    isNonZero.in <== accum[SET_SIZE];
    isMember <== 1 - isNonZero.out;
}

template NationalityProof(N_BITS, SET_SIZE, TREE_DEPTH) {
    // =========================================================================
    // Public inputs
    // =========================================================================
    signal input currentTimestamp;
    signal input credentialHashPublic;

    // --- Flat set mode ---
    signal input allowedNationalities[SET_SIZE];

    // --- Merkle mode ---
    signal input merkleRoot;              // Merkle root of allowed nationalities

    // Mode selector: 0 = flat set, 1 = Merkle tree
    signal input useMerkleMode;

    // =========================================================================
    // Private inputs
    // =========================================================================
    signal input subjectId;
    signal input nationalityCode;         // ISO 3166-1 numeric code
    signal input documentType;            // 0=passport, 1=nationalID, 2=visa, etc.
    signal input documentHash;            // Poseidon hash of document details
    signal input expiryTimestamp;
    signal input issuerPubKeyX;
    signal input issuerPubKeyY;
    signal input nonce;
    signal input signatureR8x;
    signal input signatureR8y;
    signal input signatureS;

    // Merkle proof inputs (only used in Merkle mode)
    signal input merklePathElements[TREE_DEPTH];
    signal input merklePathIndices[TREE_DEPTH];

    // =========================================================================
    // Public outputs
    // =========================================================================
    signal output nationalityVerified;    // 1 if nationality is in allowed set
    signal output credentialValid;        // 1 if credential is unexpired

    // =========================================================================
    // Step 1: Credential Binding (8-input Poseidon)
    // =========================================================================
    // We split into two rounds of Poseidon since circomlib Poseidon supports
    // up to ~16 inputs, but chaining is cleaner for readability.
    component credHashInner = Poseidon(4);
    credHashInner.inputs[0] <== subjectId;
    credHashInner.inputs[1] <== nationalityCode;
    credHashInner.inputs[2] <== documentType;
    credHashInner.inputs[3] <== documentHash;

    component credHashOuter = Poseidon(5);
    credHashOuter.inputs[0] <== credHashInner.out;
    credHashOuter.inputs[1] <== expiryTimestamp;
    credHashOuter.inputs[2] <== issuerPubKeyX;
    credHashOuter.inputs[3] <== issuerPubKeyY;
    credHashOuter.inputs[4] <== nonce;

    credHashOuter.out === credentialHashPublic;

    // =========================================================================
    // Step 2: Issuer Signature Verification
    // =========================================================================
    component sigVerify = EdDSAPoseidonVerifier();
    sigVerify.enabled <== 1;
    sigVerify.Ax <== issuerPubKeyX;
    sigVerify.Ay <== issuerPubKeyY;
    sigVerify.S <== signatureS;
    sigVerify.R8x <== signatureR8x;
    sigVerify.R8y <== signatureR8y;
    sigVerify.M <== credHashOuter.out;

    // =========================================================================
    // Step 3: Credential Expiry Check
    // =========================================================================
    component expiryCheck = LessThan(N_BITS);
    expiryCheck.in[0] <== currentTimestamp;
    expiryCheck.in[1] <== expiryTimestamp;

    credentialValid <== expiryCheck.out;

    // =========================================================================
    // Step 4: Nationality Set Membership
    // =========================================================================

    // Enforce useMerkleMode is binary.
    useMerkleMode * (1 - useMerkleMode) === 0;

    // --- Flat set membership ---
    component flatMembership = FlatSetMembership(SET_SIZE);
    flatMembership.value <== nationalityCode;
    for (var i = 0; i < SET_SIZE; i++) {
        flatMembership.set[i] <== allowedNationalities[i];
    }

    // --- Merkle inclusion proof ---
    // Hash the nationality code to get the leaf value.
    component leafHash = Poseidon(1);
    leafHash.inputs[0] <== nationalityCode;

    component merkleProof = MerkleInclusionProof(TREE_DEPTH);
    merkleProof.leaf <== leafHash.out;
    merkleProof.root <== merkleRoot;
    for (var i = 0; i < TREE_DEPTH; i++) {
        merkleProof.pathElements[i] <== merklePathElements[i];
        merkleProof.pathIndices[i] <== merklePathIndices[i];
    }
    // Note: Merkle proof verification is a hard constraint (the === inside
    // MerkleInclusionProof). In flat-set mode, the Merkle inputs must still
    // form a valid proof against merkleRoot. The caller should provide a
    // dummy valid proof when using flat mode, or use only one mode per
    // deployment.

    // Select result based on mode.
    // nationalityVerified = useMerkleMode ? 1 (Merkle constraints enforce) : flatMembership.isMember
    // In Merkle mode, if the proof is invalid, the circuit fails entirely,
    // so reaching this point means the nationality is verified.
    component resultMux = Mux1();
    resultMux.c[0] <== flatMembership.isMember;
    resultMux.c[1] <== 1;  // Merkle mode: proof is enforced by hard constraints
    resultMux.s <== useMerkleMode;

    nationalityVerified <== resultMux.out;
}

// Main component: 64-bit comparisons, 32-element flat set, 8-level Merkle tree.
component main {public [currentTimestamp, credentialHashPublic, allowedNationalities, merkleRoot, useMerkleMode]} = NationalityProof(64, 32, 8);
