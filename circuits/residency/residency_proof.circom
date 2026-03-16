pragma circom 2.1.6;

// =============================================================================
// ZeroID — Residency Proof Circuit
// =============================================================================
// Proves that a user's residency region code matches a required region WITHOUT
// revealing the exact address, postal code, or other location details.
//
// Cryptographic approach:
//   1. The user holds a residency credential containing a region code (numeric
//      encoding of country/state/province) issued by a trusted authority.
//   2. Credential binding via Poseidon hash:
//        credentialHash = Poseidon(subjectId, regionCode, postalCodeHash,
//                                 expiryTimestamp, issuerPubKeyX,
//                                 issuerPubKeyY, nonce)
//   3. Region verification: the circuit checks the private regionCode against
//      a public set of allowed regions using set membership proof.
//   4. Credential expiry and issuer signature are verified.
//
// Parameters:
//   N_BITS     — bit width for numeric comparisons (default 64)
//   SET_SIZE   — maximum number of allowed regions in the set (default 16)
// =============================================================================

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "circomlib/circuits/mux1.circom";
include "circomlib/circuits/gates.circom";

/// @title SetMembership
/// @notice Checks if a value exists in a fixed-size set.
/// @dev Iterates through each element and checks for equality.
///      Output is 1 if value matches any element, 0 otherwise.
template SetMembership(SET_SIZE) {
    signal input value;
    signal input set[SET_SIZE];
    signal output isMember;

    // For each element, compute (value == set[i]).
    component eq[SET_SIZE];
    signal matchAccum[SET_SIZE + 1];
    matchAccum[0] <== 0;

    for (var i = 0; i < SET_SIZE; i++) {
        eq[i] = IsEqual();
        eq[i].in[0] <== value;
        eq[i].in[1] <== set[i];

        // Accumulate matches. Since at most one match should exist for valid
        // data, the sum will be 0 or 1. We enforce this with a boolean
        // constraint on the output.
        matchAccum[i + 1] <== matchAccum[i] + eq[i].out;
    }

    // Clamp to boolean: if any match was found, output 1.
    // We use IsZero to check if matchAccum is non-zero.
    component isNonZero = IsZero();
    isNonZero.in <== matchAccum[SET_SIZE];

    // isNonZero.out == 1 when matchAccum == 0 (no match),
    // isNonZero.out == 0 when matchAccum != 0 (match found).
    isMember <== 1 - isNonZero.out;
}

template ResidencyProof(N_BITS, SET_SIZE) {
    // =========================================================================
    // Public inputs
    // =========================================================================
    signal input allowedRegions[SET_SIZE]; // set of allowed region codes
    signal input currentTimestamp;          // current Unix timestamp
    signal input credentialHashPublic;      // expected credential commitment

    // =========================================================================
    // Private inputs
    // =========================================================================
    signal input subjectId;
    signal input regionCode;              // numeric region code (e.g., ISO 3166-1)
    signal input postalCodeHash;          // Poseidon hash of the postal/zip code
    signal input expiryTimestamp;
    signal input issuerPubKeyX;
    signal input issuerPubKeyY;
    signal input nonce;
    signal input signatureR8x;
    signal input signatureR8y;
    signal input signatureS;

    // =========================================================================
    // Public outputs
    // =========================================================================
    signal output residencyVerified;      // 1 if region is in allowed set
    signal output credentialValid;        // 1 if credential is unexpired

    // =========================================================================
    // Step 1: Credential Binding
    // =========================================================================
    // 7-input Poseidon hash for credential commitment.
    component credHash = Poseidon(7);
    credHash.inputs[0] <== subjectId;
    credHash.inputs[1] <== regionCode;
    credHash.inputs[2] <== postalCodeHash;
    credHash.inputs[3] <== expiryTimestamp;
    credHash.inputs[4] <== issuerPubKeyX;
    credHash.inputs[5] <== issuerPubKeyY;
    credHash.inputs[6] <== nonce;

    // Hard constraint: recomputed hash must match the public commitment.
    credHash.out === credentialHashPublic;

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
    sigVerify.M <== credHash.out;

    // =========================================================================
    // Step 3: Credential Expiry Check
    // =========================================================================
    component expiryCheck = LessThan(N_BITS);
    expiryCheck.in[0] <== currentTimestamp;
    expiryCheck.in[1] <== expiryTimestamp;
    // expiryCheck.out == 1 means credential is still valid.

    credentialValid <== expiryCheck.out;

    // =========================================================================
    // Step 4: Set Membership — Region Verification
    // =========================================================================
    // Prove that the private regionCode exists in the public allowedRegions set.
    // The prover does not reveal which specific region they are in — only that
    // it is one of the allowed regions.
    component membership = SetMembership(SET_SIZE);
    membership.value <== regionCode;
    for (var i = 0; i < SET_SIZE; i++) {
        membership.set[i] <== allowedRegions[i];
    }

    residencyVerified <== membership.isMember;
}

// Main component: 64-bit comparisons, up to 16 allowed regions.
component main {public [allowedRegions, currentTimestamp, credentialHashPublic]} = ResidencyProof(64, 16);
