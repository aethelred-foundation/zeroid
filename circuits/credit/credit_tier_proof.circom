pragma circom 2.1.6;

// =============================================================================
// ZeroID — Credit Tier Proof Circuit
// =============================================================================
// Proves that a user's credit score falls within or above a required tier
// WITHOUT revealing the exact credit score.
//
// Cryptographic approach:
//   1. Credit scores are mapped to tiers (e.g., 0=Poor, 1=Fair, 2=Good,
//      3=Very Good, 4=Excellent). The issuer encodes both the raw score and
//      the tier into the credential.
//   2. Credential binding via Poseidon hash:
//        credentialHash = Poseidon(subjectId, creditScore, creditTier,
//                                 expiryTimestamp, issuerPubKeyX,
//                                 issuerPubKeyY, nonce)
//   3. The circuit verifies:
//        a) Credential hash commitment matches
//        b) Credit tier is correctly derived from the score (range check)
//        c) Credit tier >= required minimum tier
//        d) Credential is not expired
//        e) Issuer signature is valid
//   4. Only the boolean (tier >= threshold) is revealed.
//
// Parameters:
//   N_BITS       — bit width for comparisons (default 64)
//   NUM_TIERS    — number of credit tiers (default 5)
//   SCORE_BITS   — bit width for credit score (default 16, supports 0-65535)
// =============================================================================

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "circomlib/circuits/gates.circom";

/// @title RangeCheck
/// @notice Verifies that a value falls within [lowerBound, upperBound).
/// @dev Uses two LessThan comparators to enforce both bounds.
template RangeCheck(N_BITS) {
    signal input value;
    signal input lowerBound;
    signal input upperBound;
    signal output inRange;

    // Check: value >= lowerBound (i.e., NOT value < lowerBound)
    component lowerCheck = LessThan(N_BITS);
    lowerCheck.in[0] <== value;
    lowerCheck.in[1] <== lowerBound;
    // lowerCheck.out == 1 means value < lowerBound (BAD)
    signal aboveLower;
    aboveLower <== 1 - lowerCheck.out;

    // Check: value < upperBound
    component upperCheck = LessThan(N_BITS);
    upperCheck.in[0] <== value;
    upperCheck.in[1] <== upperBound;
    // upperCheck.out == 1 means value < upperBound (GOOD)

    // inRange = aboveLower AND belowUpper
    component andGate = AND();
    andGate.a <== aboveLower;
    andGate.b <== upperCheck.out;
    inRange <== andGate.out;
}

template CreditTierProof(N_BITS, NUM_TIERS, SCORE_BITS) {
    // =========================================================================
    // Public inputs
    // =========================================================================
    signal input minimumTier;               // required minimum credit tier
    signal input currentTimestamp;           // current Unix timestamp
    signal input credentialHashPublic;       // expected credential commitment
    // Tier boundary thresholds: tierBoundaries[i] is the minimum score for tier i.
    // e.g., [0, 300, 580, 670, 740] for tiers Poor/Fair/Good/VeryGood/Excellent
    // tierBoundaries[NUM_TIERS] is the upper bound sentinel (e.g., 850 or 65536).
    signal input tierBoundaries[NUM_TIERS + 1];

    // =========================================================================
    // Private inputs
    // =========================================================================
    signal input subjectId;
    signal input creditScore;               // raw credit score (e.g., 300-850)
    signal input creditTier;                // derived tier (0 to NUM_TIERS-1)
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
    signal output tierMeetsThreshold;       // 1 if creditTier >= minimumTier
    signal output credentialValid;          // 1 if credential is unexpired

    // =========================================================================
    // Step 1: Credential Binding
    // =========================================================================
    component credHash = Poseidon(7);
    credHash.inputs[0] <== subjectId;
    credHash.inputs[1] <== creditScore;
    credHash.inputs[2] <== creditTier;
    credHash.inputs[3] <== expiryTimestamp;
    credHash.inputs[4] <== issuerPubKeyX;
    credHash.inputs[5] <== issuerPubKeyY;
    credHash.inputs[6] <== nonce;

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

    credentialValid <== expiryCheck.out;

    // =========================================================================
    // Step 4: Credit Score Range Validation
    // =========================================================================
    // Verify that the credit score falls within the bounds for the claimed tier.
    // This prevents a prover from lying about their tier. The score must satisfy:
    //   tierBoundaries[creditTier] <= creditScore < tierBoundaries[creditTier + 1]
    //
    // Since we cannot dynamically index arrays in Circom, we check all tiers
    // and enforce that exactly the claimed tier's range contains the score.

    component rangeChecks[NUM_TIERS];
    signal tierMatch[NUM_TIERS];

    for (var i = 0; i < NUM_TIERS; i++) {
        rangeChecks[i] = RangeCheck(SCORE_BITS);
        rangeChecks[i].value <== creditScore;
        rangeChecks[i].lowerBound <== tierBoundaries[i];
        rangeChecks[i].upperBound <== tierBoundaries[i + 1];
    }

    // Verify that the claimed creditTier matches the tier where the score falls.
    // For each tier i, check if creditTier == i AND rangeChecks[i].inRange == 1.
    component tierEq[NUM_TIERS];
    signal validTierAccum[NUM_TIERS + 1];
    validTierAccum[0] <== 0;

    for (var i = 0; i < NUM_TIERS; i++) {
        tierEq[i] = IsEqual();
        tierEq[i].in[0] <== creditTier;
        tierEq[i].in[1] <== i;

        // tierMatch[i] = (creditTier == i) AND (score in range for tier i)
        tierMatch[i] <== tierEq[i].out * rangeChecks[i].inRange;

        validTierAccum[i + 1] <== validTierAccum[i] + tierMatch[i];
    }

    // Exactly one tier must match (the claimed one, with correct range).
    validTierAccum[NUM_TIERS] === 1;

    // =========================================================================
    // Step 5: Tier Threshold Comparison
    // =========================================================================
    // Check creditTier >= minimumTier.
    // Equivalent to: NOT (creditTier < minimumTier).
    component tierCompare = LessThan(N_BITS);
    tierCompare.in[0] <== creditTier;
    tierCompare.in[1] <== minimumTier;

    tierMeetsThreshold <== 1 - tierCompare.out;
}

// Main component: 64-bit timestamps, 5 credit tiers, 16-bit scores.
component main {public [minimumTier, currentTimestamp, credentialHashPublic, tierBoundaries]} = CreditTierProof(64, 5, 16);
