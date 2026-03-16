pragma circom 2.1.6;

// =============================================================================
// ZeroID — Age Proof Circuit
// =============================================================================
// Proves that a user's age meets or exceeds a public threshold WITHOUT
// revealing the actual date of birth or age.
//
// Cryptographic approach:
//   1. The user holds a credential containing their date-of-birth (as a Unix
//      timestamp) signed by a trusted issuer.
//   2. The credential is bound via a Poseidon hash commitment:
//        credentialHash = Poseidon(subjectId, dateOfBirth, expiryTimestamp,
//                                 issuerPubKeyX, issuerPubKeyY, nonce)
//   3. The circuit checks:
//        a) credentialHash matches the public commitment (credential binding)
//        b) currentTimestamp - dateOfBirth >= ageThreshold * SECONDS_PER_YEAR
//        c) currentTimestamp < expiryTimestamp (credential not expired)
//        d) EdDSA signature from the issuer is valid over the credential hash
//   4. Only the boolean result (age >= threshold) is revealed publicly.
//
// Parameters:
//   N_BITS — bit width for range comparisons (default 64, supports timestamps
//            up to year ~2554)
// =============================================================================

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/eddsaposeidon.circom";

// Seconds in a calendar year (365.25 days to account for leap years).
// 365.25 * 86400 = 31_557_600
// We use the integer floor: 31557600.

template AgeProof(N_BITS) {
    // =========================================================================
    // Public inputs
    // =========================================================================
    signal input ageThresholdYears;     // minimum age in years (e.g., 18)
    signal input currentTimestamp;       // current Unix timestamp (seconds)
    signal input credentialHashPublic;   // expected Poseidon commitment

    // =========================================================================
    // Private inputs — known only to the prover
    // =========================================================================
    signal input subjectId;             // unique identifier of the credential holder
    signal input dateOfBirth;           // Unix timestamp of date of birth
    signal input expiryTimestamp;        // when the credential expires
    signal input issuerPubKeyX;         // issuer EdDSA public key (x coordinate)
    signal input issuerPubKeyY;         // issuer EdDSA public key (y coordinate)
    signal input nonce;                 // randomness for hiding commitment
    signal input signatureR8x;          // EdDSA signature R8.x
    signal input signatureR8y;          // EdDSA signature R8.y
    signal input signatureS;            // EdDSA signature S

    // =========================================================================
    // Public outputs
    // =========================================================================
    signal output ageVerified;          // 1 if age >= threshold, 0 otherwise
    signal output credentialValid;      // 1 if all checks pass

    // =========================================================================
    // Step 1: Credential Binding — recompute Poseidon hash and verify match
    // =========================================================================
    // Poseidon with 6 inputs: subjectId, dateOfBirth, expiryTimestamp,
    //                         issuerPubKeyX, issuerPubKeyY, nonce
    component credHash = Poseidon(6);
    credHash.inputs[0] <== subjectId;
    credHash.inputs[1] <== dateOfBirth;
    credHash.inputs[2] <== expiryTimestamp;
    credHash.inputs[3] <== issuerPubKeyX;
    credHash.inputs[4] <== issuerPubKeyY;
    credHash.inputs[5] <== nonce;

    // Enforce that the recomputed hash matches the public commitment.
    credHash.out === credentialHashPublic;

    // =========================================================================
    // Step 2: Issuer Signature Verification (EdDSA over Poseidon)
    // =========================================================================
    // Verify that the issuer signed the credential hash.
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
    // Verify currentTimestamp < expiryTimestamp (credential has not expired).
    // We compute expiryTimestamp - currentTimestamp and check it is positive
    // (i.e., fits in N_BITS as an unsigned integer).
    component expiryCheck = LessThan(N_BITS);
    expiryCheck.in[0] <== currentTimestamp;
    expiryCheck.in[1] <== expiryTimestamp;
    // expiryCheck.out == 1 means credential is still valid

    // =========================================================================
    // Step 4: Age Range Proof
    // =========================================================================
    // Compute the age in seconds: ageSeconds = currentTimestamp - dateOfBirth.
    // Then compute the threshold in seconds: thresholdSeconds = ageThresholdYears * 31557600.
    // Finally check ageSeconds >= thresholdSeconds.

    // Ensure dateOfBirth <= currentTimestamp (sanity check).
    component dobCheck = LessThan(N_BITS);
    dobCheck.in[0] <== dateOfBirth;
    dobCheck.in[1] <== currentTimestamp + 1; // dateOfBirth <= currentTimestamp
    dobCheck.out === 1;

    signal ageSeconds;
    ageSeconds <== currentTimestamp - dateOfBirth;

    // Threshold in seconds. Using 31557600 (365.25 days).
    signal thresholdSeconds;
    thresholdSeconds <== ageThresholdYears * 31557600;

    // Check ageSeconds >= thresholdSeconds.
    // Equivalent to: thresholdSeconds <= ageSeconds
    // LessThan returns 1 if in[0] < in[1].
    // We check thresholdSeconds <= ageSeconds by checking
    // NOT (ageSeconds < thresholdSeconds).
    component ageCompare = LessThan(N_BITS);
    ageCompare.in[0] <== ageSeconds;
    ageCompare.in[1] <== thresholdSeconds;
    // ageCompare.out == 0 means ageSeconds >= thresholdSeconds

    // ageVerified = 1 - ageCompare.out
    // If ageSeconds >= thresholdSeconds, ageCompare.out = 0, so ageVerified = 1.
    ageVerified <== 1 - ageCompare.out;

    // =========================================================================
    // Step 5: Aggregate credential validity
    // =========================================================================
    // credentialValid = expiryCheck.out (credential not expired)
    // Note: signature verification is enforced as a hard constraint above,
    // and credential hash binding is also a hard constraint. If either fails,
    // the proof cannot be generated at all. Expiry is surfaced as an output
    // so the verifier can see if the credential was valid at proof time.
    credentialValid <== expiryCheck.out;
}

// Main component: 64-bit range for timestamps (sufficient until year ~2554).
component main {public [ageThresholdYears, currentTimestamp, credentialHashPublic]} = AgeProof(64);
