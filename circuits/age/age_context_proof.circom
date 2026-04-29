pragma circom 2.1.6;

// =============================================================================
// ZeroID Age Context Proof Circuit v2
// =============================================================================
// Proves an age threshold against a signed credential commitment while exposing
// the exact public-signal schema required by the backend verifier:
//   [claimsHash, ageThresholdYears, contextCommitment]
//
// This circuit has no public outputs so contextCommitment remains the final
// public signal. A valid Groth16 proof itself is the boolean assertion that:
//   - the issuer signature verifies over the credential commitment,
//   - the credential commitment equals claimsHash,
//   - the credential is not expired,
//   - the holder is at least ageThresholdYears old,
//   - the proof statement includes the verifier-supplied contextCommitment.
// =============================================================================

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/eddsaposeidon.circom";

template AgeContextProof(N_BITS) {
    // Public signals. The order is part of the verifier contract.
    signal input claimsHash;
    signal input ageThresholdYears;
    signal input contextCommitment;

    // Private credential witness.
    signal input subjectId;
    signal input dateOfBirth;
    signal input expiryTimestamp;
    signal input currentTimestamp;
    signal input issuerPubKeyX;
    signal input issuerPubKeyY;
    signal input nonce;
    signal input signatureR8x;
    signal input signatureR8y;
    signal input signatureS;
    signal input contextCommitmentWitness;

    component credHash = Poseidon(6);
    credHash.inputs[0] <== subjectId;
    credHash.inputs[1] <== dateOfBirth;
    credHash.inputs[2] <== expiryTimestamp;
    credHash.inputs[3] <== issuerPubKeyX;
    credHash.inputs[4] <== issuerPubKeyY;
    credHash.inputs[5] <== nonce;
    credHash.out === claimsHash;

    component sigVerify = EdDSAPoseidonVerifier();
    sigVerify.enabled <== 1;
    sigVerify.Ax <== issuerPubKeyX;
    sigVerify.Ay <== issuerPubKeyY;
    sigVerify.S <== signatureS;
    sigVerify.R8x <== signatureR8x;
    sigVerify.R8y <== signatureR8y;
    sigVerify.M <== credHash.out;

    component expiryCheck = LessThan(N_BITS);
    expiryCheck.in[0] <== currentTimestamp;
    expiryCheck.in[1] <== expiryTimestamp;
    expiryCheck.out === 1;

    component dobCheck = LessThan(N_BITS);
    dobCheck.in[0] <== dateOfBirth;
    dobCheck.in[1] <== currentTimestamp + 1;
    dobCheck.out === 1;

    signal ageSeconds;
    ageSeconds <== currentTimestamp - dateOfBirth;

    signal thresholdSeconds;
    thresholdSeconds <== ageThresholdYears * 31557600;

    component ageCompare = LessThan(N_BITS);
    ageCompare.in[0] <== ageSeconds;
    ageCompare.in[1] <== thresholdSeconds;
    ageCompare.out === 0;

    contextCommitmentWitness === contextCommitment;
}

component main {public [claimsHash, ageThresholdYears, contextCommitment]} = AgeContextProof(64);
