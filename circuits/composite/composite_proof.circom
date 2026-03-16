pragma circom 2.1.6;

// =============================================================================
// ZeroID — Composite Proof Circuit
// =============================================================================
// Combines multiple identity attribute proofs into a single ZK proof. This
// enables complex compliance scenarios such as "user is 18+, resides in an
// EU country, and has Good or better credit" — all in one proof, without
// revealing any underlying data.
//
// Cryptographic approach:
//   1. Each credential (age, residency, credit, nationality) is independently
//      bound via its own Poseidon hash commitment.
//   2. All credentials must be issued to the SAME subjectId (linkage check).
//   3. Each credential has its own issuer signature and expiry.
//   4. A master binding hash ties all credential hashes together with the
//      subject ID, preventing proof transplant attacks:
//        masterHash = Poseidon(subjectId, ageCredHash, residencyCredHash,
//                              creditCredHash, nationalityCredHash)
//   5. Individual attribute checks (age range, region set membership, tier
//      comparison, nationality set membership) are performed.
//   6. A configurable policy mask selects which attributes are required.
//
// Parameters:
//   N_BITS           — bit width for comparisons (default 64)
//   REGION_SET_SIZE  — max allowed regions (default 16)
//   NAT_SET_SIZE     — max allowed nationalities (default 32)
//   NUM_CREDIT_TIERS — number of credit tiers (default 5)
//   SCORE_BITS       — bit width for credit scores (default 16)
// =============================================================================

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "circomlib/circuits/mux1.circom";
include "circomlib/circuits/gates.circom";

/// @title SetMembership
/// @notice Checks if a value exists in a fixed-size set.
template SetMembership(SET_SIZE) {
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

/// @title RangeCheck
/// @notice Verifies value is within [lowerBound, upperBound).
template RangeCheck(N_BITS) {
    signal input value;
    signal input lowerBound;
    signal input upperBound;
    signal output inRange;

    component lowerCmp = LessThan(N_BITS);
    lowerCmp.in[0] <== value;
    lowerCmp.in[1] <== lowerBound;
    signal aboveLower;
    aboveLower <== 1 - lowerCmp.out;

    component upperCmp = LessThan(N_BITS);
    upperCmp.in[0] <== value;
    upperCmp.in[1] <== upperBound;

    component andGate = AND();
    andGate.a <== aboveLower;
    andGate.b <== upperCmp.out;
    inRange <== andGate.out;
}

/// @title CredentialVerifier
/// @notice Verifies a single credential: hash binding, signature, and expiry.
/// @dev Encapsulates the common pattern across all credential types.
template CredentialVerifier(NUM_FIELDS) {
    signal input fields[NUM_FIELDS];
    signal input credentialHashPublic;
    signal input currentTimestamp;
    signal input expiryTimestamp;
    signal input issuerPubKeyX;
    signal input issuerPubKeyY;
    signal input signatureR8x;
    signal input signatureR8y;
    signal input signatureS;

    signal output credHash;
    signal output isValid;   // 1 if not expired (signature is hard constraint)

    // Hash all fields.
    component hasher = Poseidon(NUM_FIELDS);
    for (var i = 0; i < NUM_FIELDS; i++) {
        hasher.inputs[i] <== fields[i];
    }
    credHash <== hasher.out;

    // Binding constraint.
    hasher.out === credentialHashPublic;

    // Signature verification (hard constraint — proof fails if invalid).
    component sigVerify = EdDSAPoseidonVerifier();
    sigVerify.enabled <== 1;
    sigVerify.Ax <== issuerPubKeyX;
    sigVerify.Ay <== issuerPubKeyY;
    sigVerify.S <== signatureS;
    sigVerify.R8x <== signatureR8x;
    sigVerify.R8y <== signatureR8y;
    sigVerify.M <== hasher.out;

    // Expiry check.
    component expiryCheck = LessThan(64);
    expiryCheck.in[0] <== currentTimestamp;
    expiryCheck.in[1] <== expiryTimestamp;
    isValid <== expiryCheck.out;
}

template CompositeProof(N_BITS, REGION_SET_SIZE, NAT_SET_SIZE, NUM_CREDIT_TIERS, SCORE_BITS) {
    // =========================================================================
    // Public inputs
    // =========================================================================
    signal input currentTimestamp;

    // Policy mask: which attributes to enforce.
    // Bit 0 = age, Bit 1 = residency, Bit 2 = credit, Bit 3 = nationality.
    signal input policyMask[4];

    // Age parameters
    signal input ageThresholdYears;

    // Residency parameters
    signal input allowedRegions[REGION_SET_SIZE];

    // Credit parameters
    signal input minimumCreditTier;
    signal input tierBoundaries[NUM_CREDIT_TIERS + 1];

    // Nationality parameters
    signal input allowedNationalities[NAT_SET_SIZE];

    // Credential commitments (public)
    signal input ageCredHashPublic;
    signal input residencyCredHashPublic;
    signal input creditCredHashPublic;
    signal input nationalityCredHashPublic;
    signal input masterHashPublic;

    // =========================================================================
    // Private inputs — Age Credential
    // =========================================================================
    signal input subjectId;                // shared across all credentials
    signal input dateOfBirth;
    signal input ageExpiry;
    signal input ageIssuerPubKeyX;
    signal input ageIssuerPubKeyY;
    signal input ageNonce;
    signal input ageSigR8x;
    signal input ageSigR8y;
    signal input ageSigS;

    // =========================================================================
    // Private inputs — Residency Credential
    // =========================================================================
    signal input regionCode;
    signal input postalCodeHash;
    signal input residencyExpiry;
    signal input residencyIssuerPubKeyX;
    signal input residencyIssuerPubKeyY;
    signal input residencyNonce;
    signal input residencySigR8x;
    signal input residencySigR8y;
    signal input residencySigS;

    // =========================================================================
    // Private inputs — Credit Credential
    // =========================================================================
    signal input creditScore;
    signal input creditTier;
    signal input creditExpiry;
    signal input creditIssuerPubKeyX;
    signal input creditIssuerPubKeyY;
    signal input creditNonce;
    signal input creditSigR8x;
    signal input creditSigR8y;
    signal input creditSigS;

    // =========================================================================
    // Private inputs — Nationality Credential
    // =========================================================================
    signal input nationalityCode;
    signal input documentType;
    signal input documentHash;
    signal input nationalityExpiry;
    signal input nationalityIssuerPubKeyX;
    signal input nationalityIssuerPubKeyY;
    signal input nationalityNonce;
    signal input nationalitySigR8x;
    signal input nationalitySigR8y;
    signal input nationalitySigS;

    // =========================================================================
    // Public outputs
    // =========================================================================
    signal output allPoliciesMet;          // 1 if all required policies pass
    signal output ageResult;               // 1 if age >= threshold
    signal output residencyResult;         // 1 if region in allowed set
    signal output creditResult;            // 1 if credit tier >= minimum
    signal output nationalityResult;       // 1 if nationality in allowed set

    // =========================================================================
    // Enforce policyMask values are binary
    // =========================================================================
    for (var i = 0; i < 4; i++) {
        policyMask[i] * (1 - policyMask[i]) === 0;
    }

    // =========================================================================
    // Credential 1: Age
    // =========================================================================
    // Fields: subjectId, dateOfBirth, ageExpiry, issuerPubKeyX, issuerPubKeyY, nonce
    component ageVerifier = CredentialVerifier(6);
    ageVerifier.fields[0] <== subjectId;
    ageVerifier.fields[1] <== dateOfBirth;
    ageVerifier.fields[2] <== ageExpiry;
    ageVerifier.fields[3] <== ageIssuerPubKeyX;
    ageVerifier.fields[4] <== ageIssuerPubKeyY;
    ageVerifier.fields[5] <== ageNonce;
    ageVerifier.credentialHashPublic <== ageCredHashPublic;
    ageVerifier.currentTimestamp <== currentTimestamp;
    ageVerifier.expiryTimestamp <== ageExpiry;
    ageVerifier.issuerPubKeyX <== ageIssuerPubKeyX;
    ageVerifier.issuerPubKeyY <== ageIssuerPubKeyY;
    ageVerifier.signatureR8x <== ageSigR8x;
    ageVerifier.signatureR8y <== ageSigR8y;
    ageVerifier.signatureS <== ageSigS;

    // Age check: currentTimestamp - dateOfBirth >= ageThresholdYears * 31557600
    signal ageSeconds;
    ageSeconds <== currentTimestamp - dateOfBirth;
    signal ageThresholdSeconds;
    ageThresholdSeconds <== ageThresholdYears * 31557600;

    component ageCmp = LessThan(N_BITS);
    ageCmp.in[0] <== ageSeconds;
    ageCmp.in[1] <== ageThresholdSeconds;
    ageResult <== 1 - ageCmp.out;

    // =========================================================================
    // Credential 2: Residency
    // =========================================================================
    // Fields: subjectId, regionCode, postalCodeHash, residencyExpiry, issuerPubKeyX, issuerPubKeyY, nonce
    component residencyVerifier = CredentialVerifier(7);
    residencyVerifier.fields[0] <== subjectId;
    residencyVerifier.fields[1] <== regionCode;
    residencyVerifier.fields[2] <== postalCodeHash;
    residencyVerifier.fields[3] <== residencyExpiry;
    residencyVerifier.fields[4] <== residencyIssuerPubKeyX;
    residencyVerifier.fields[5] <== residencyIssuerPubKeyY;
    residencyVerifier.fields[6] <== residencyNonce;
    residencyVerifier.credentialHashPublic <== residencyCredHashPublic;
    residencyVerifier.currentTimestamp <== currentTimestamp;
    residencyVerifier.expiryTimestamp <== residencyExpiry;
    residencyVerifier.issuerPubKeyX <== residencyIssuerPubKeyX;
    residencyVerifier.issuerPubKeyY <== residencyIssuerPubKeyY;
    residencyVerifier.signatureR8x <== residencySigR8x;
    residencyVerifier.signatureR8y <== residencySigR8y;
    residencyVerifier.signatureS <== residencySigS;

    // Region set membership.
    component regionMembership = SetMembership(REGION_SET_SIZE);
    regionMembership.value <== regionCode;
    for (var i = 0; i < REGION_SET_SIZE; i++) {
        regionMembership.set[i] <== allowedRegions[i];
    }
    residencyResult <== regionMembership.isMember;

    // =========================================================================
    // Credential 3: Credit
    // =========================================================================
    // Fields: subjectId, creditScore, creditTier, creditExpiry, issuerPubKeyX, issuerPubKeyY, nonce
    component creditVerifier = CredentialVerifier(7);
    creditVerifier.fields[0] <== subjectId;
    creditVerifier.fields[1] <== creditScore;
    creditVerifier.fields[2] <== creditTier;
    creditVerifier.fields[3] <== creditExpiry;
    creditVerifier.fields[4] <== creditIssuerPubKeyX;
    creditVerifier.fields[5] <== creditIssuerPubKeyY;
    creditVerifier.fields[6] <== creditNonce;
    creditVerifier.credentialHashPublic <== creditCredHashPublic;
    creditVerifier.currentTimestamp <== currentTimestamp;
    creditVerifier.expiryTimestamp <== creditExpiry;
    creditVerifier.issuerPubKeyX <== creditIssuerPubKeyX;
    creditVerifier.issuerPubKeyY <== creditIssuerPubKeyY;
    creditVerifier.signatureR8x <== creditSigR8x;
    creditVerifier.signatureR8y <== creditSigR8y;
    creditVerifier.signatureS <== creditSigS;

    // Credit tier range validation and threshold check.
    component creditRangeChecks[NUM_CREDIT_TIERS];
    component creditTierEq[NUM_CREDIT_TIERS];
    signal creditTierMatch[NUM_CREDIT_TIERS];
    signal creditValidAccum[NUM_CREDIT_TIERS + 1];
    creditValidAccum[0] <== 0;

    for (var i = 0; i < NUM_CREDIT_TIERS; i++) {
        creditRangeChecks[i] = RangeCheck(SCORE_BITS);
        creditRangeChecks[i].value <== creditScore;
        creditRangeChecks[i].lowerBound <== tierBoundaries[i];
        creditRangeChecks[i].upperBound <== tierBoundaries[i + 1];

        creditTierEq[i] = IsEqual();
        creditTierEq[i].in[0] <== creditTier;
        creditTierEq[i].in[1] <== i;

        creditTierMatch[i] <== creditTierEq[i].out * creditRangeChecks[i].inRange;
        creditValidAccum[i + 1] <== creditValidAccum[i] + creditTierMatch[i];
    }

    // Hard constraint: exactly one tier must match.
    creditValidAccum[NUM_CREDIT_TIERS] === 1;

    // Tier meets minimum.
    component creditTierCmp = LessThan(N_BITS);
    creditTierCmp.in[0] <== creditTier;
    creditTierCmp.in[1] <== minimumCreditTier;
    creditResult <== 1 - creditTierCmp.out;

    // =========================================================================
    // Credential 4: Nationality
    // =========================================================================
    // Use chained Poseidon (4 + 5 = 8 total fields + nonce).
    component natHashInner = Poseidon(4);
    natHashInner.inputs[0] <== subjectId;
    natHashInner.inputs[1] <== nationalityCode;
    natHashInner.inputs[2] <== documentType;
    natHashInner.inputs[3] <== documentHash;

    component natHashOuter = Poseidon(5);
    natHashOuter.inputs[0] <== natHashInner.out;
    natHashOuter.inputs[1] <== nationalityExpiry;
    natHashOuter.inputs[2] <== nationalityIssuerPubKeyX;
    natHashOuter.inputs[3] <== nationalityIssuerPubKeyY;
    natHashOuter.inputs[4] <== nationalityNonce;

    natHashOuter.out === nationalityCredHashPublic;

    // Nationality signature verification.
    component natSigVerify = EdDSAPoseidonVerifier();
    natSigVerify.enabled <== 1;
    natSigVerify.Ax <== nationalityIssuerPubKeyX;
    natSigVerify.Ay <== nationalityIssuerPubKeyY;
    natSigVerify.S <== nationalitySigS;
    natSigVerify.R8x <== nationalitySigR8x;
    natSigVerify.R8y <== nationalitySigR8y;
    natSigVerify.M <== natHashOuter.out;

    // Nationality expiry check.
    component natExpiryCheck = LessThan(N_BITS);
    natExpiryCheck.in[0] <== currentTimestamp;
    natExpiryCheck.in[1] <== nationalityExpiry;

    // Nationality set membership.
    component natMembership = SetMembership(NAT_SET_SIZE);
    natMembership.value <== nationalityCode;
    for (var i = 0; i < NAT_SET_SIZE; i++) {
        natMembership.set[i] <== allowedNationalities[i];
    }
    nationalityResult <== natMembership.isMember;

    // =========================================================================
    // Master Binding Hash — prevents credential mix-and-match
    // =========================================================================
    // Tie all credential hashes to a single subject identity.
    component masterHash = Poseidon(5);
    masterHash.inputs[0] <== subjectId;
    masterHash.inputs[1] <== ageVerifier.credHash;
    masterHash.inputs[2] <== residencyVerifier.credHash;
    masterHash.inputs[3] <== creditVerifier.credHash;
    masterHash.inputs[4] <== natHashOuter.out;

    masterHash.out === masterHashPublic;

    // =========================================================================
    // Policy Enforcement
    // =========================================================================
    // For each attribute, compute: policyResult = policyMask[i] ? attributeResult : 1
    // (If policy is not required, treat it as passing.)
    // Then allPoliciesMet = product of all policy results.

    // Include credential validity (not expired) in the per-attribute result.
    signal ageFullResult;
    ageFullResult <== ageResult * ageVerifier.isValid;

    signal residencyFullResult;
    residencyFullResult <== residencyResult * residencyVerifier.isValid;

    signal creditFullResult;
    creditFullResult <== creditResult * creditVerifier.isValid;

    signal natFullResult;
    natFullResult <== nationalityResult * natExpiryCheck.out;

    // Mux: if policyMask[i] == 0, result is 1 (pass); else result is the check.
    component ageMux = Mux1();
    ageMux.c[0] <== 1;
    ageMux.c[1] <== ageFullResult;
    ageMux.s <== policyMask[0];

    component residencyMux = Mux1();
    residencyMux.c[0] <== 1;
    residencyMux.c[1] <== residencyFullResult;
    residencyMux.s <== policyMask[1];

    component creditMux = Mux1();
    creditMux.c[0] <== 1;
    creditMux.c[1] <== creditFullResult;
    creditMux.s <== policyMask[2];

    component natMux = Mux1();
    natMux.c[0] <== 1;
    natMux.c[1] <== natFullResult;
    natMux.s <== policyMask[3];

    // All policies met = product of all individual results.
    // Since each is 0 or 1, the product is 1 iff all are 1.
    signal partial1;
    partial1 <== ageMux.out * residencyMux.out;
    signal partial2;
    partial2 <== creditMux.out * natMux.out;
    allPoliciesMet <== partial1 * partial2;
}

// Main component with default parameters suitable for most compliance scenarios.
// 64-bit timestamps, 16 regions, 32 nationalities, 5 credit tiers, 16-bit scores.
component main {public [
    currentTimestamp,
    policyMask,
    ageThresholdYears,
    allowedRegions,
    minimumCreditTier,
    tierBoundaries,
    allowedNationalities,
    ageCredHashPublic,
    residencyCredHashPublic,
    creditCredHashPublic,
    nationalityCredHashPublic,
    masterHashPublic
]} = CompositeProof(64, 16, 32, 5, 16);
