pragma circom 2.1.6;

// =============================================================================
// ZeroID Eligibility Policy Context Proof v1
// =============================================================================
// Proves the v1 hero workflow statement used by EDGE, Presight, and TII pilots:
//   - the issuer-signed KYC credential commitment equals claimsHash,
//   - the credential is not expired,
//   - the holder is at least ageThresholdYears old,
//   - the private residence country code is bound to the public policy signal,
//   - the proof statement is bound to policyVersionHash and contextCommitment.
//
// Public signal order is part of the verifier contract:
//   [claimsHash, ageThresholdYears, residencyCountryCode, currentTimestamp,
//    policyVersionHash, contextCommitment]
//
// The circuit intentionally has no public outputs so contextCommitment remains
// the final public signal consumed by the backend context-binding verifier.
// =============================================================================

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/eddsaposeidon.circom";

template EligibilityPolicyContextProof(N_BITS) {
    // Public signals. The order is pinned in circuits/manifest/eligibility_v1.json.
    signal input claimsHash;
    signal input ageThresholdYears;
    signal input residencyCountryCode;
    signal input currentTimestamp;
    signal input policyVersionHash;
    signal input contextCommitment;

    // Private credential witness.
    signal input subjectId;
    signal input dateOfBirth;
    signal input residenceCountryCode;
    signal input expiryTimestamp;
    signal input issuerPubKeyX;
    signal input issuerPubKeyY;
    signal input nonce;
    signal input signatureR8x;
    signal input signatureR8y;
    signal input signatureS;
    signal input policyVersionHashWitness;
    signal input contextCommitmentWitness;

    component credHash = Poseidon(7);
    credHash.inputs[0] <== subjectId;
    credHash.inputs[1] <== dateOfBirth;
    credHash.inputs[2] <== residenceCountryCode;
    credHash.inputs[3] <== expiryTimestamp;
    credHash.inputs[4] <== issuerPubKeyX;
    credHash.inputs[5] <== issuerPubKeyY;
    credHash.inputs[6] <== nonce;
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

    residenceCountryCode === residencyCountryCode;
    policyVersionHashWitness === policyVersionHash;
    contextCommitmentWitness === contextCommitment;
}

component main {public [claimsHash, ageThresholdYears, residencyCountryCode, currentTimestamp, policyVersionHash, contextCommitment]} = EligibilityPolicyContextProof(64);
