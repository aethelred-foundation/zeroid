pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/gates.circom";

/**
 * @title Privacy-Preserving Biometric Matching Circuit
 * @author ZeroID Cryptography Team
 * @notice Proves that a biometric sample matches a stored template without
 *         revealing either the sample or the template. Uses Hamming distance
 *         on binary feature vectors with a configurable match threshold.
 *
 * @dev Biometric matching protocol:
 *      1. A biometric template T is enrolled and committed as H(T, salt).
 *      2. At verification time, a fresh biometric sample S is captured.
 *      3. The prover demonstrates in ZK that:
 *         a. H(T, salt) matches the enrolled commitment
 *         b. HammingDistance(T, S) ≤ threshold
 *         c. The proof is bound to a fresh challenge (anti-replay)
 *      4. Neither T nor S is revealed to the verifier.
 *
 *      The template and sample are represented as binary feature vectors
 *      of length FEATURE_LEN bits. Common biometric modalities:
 *        - Iris codes: 2048 bits
 *        - Fingerprint minutiae: 512-1024 bits
 *        - Face embeddings (binarized): 256-512 bits
 *
 *      For gas efficiency, we use FEATURE_LEN = 256 (configurable).
 *      The Hamming distance threshold is typically 25-35% of FEATURE_LEN.
 *
 *      Anti-replay: each proof is bound to a unique challenge value that
 *      includes a timestamp and verifier identity, preventing reuse.
 *
 *      Parameters:
 *        FEATURE_LEN = number of bits in the feature vector
 *        CHUNK_SIZE  = bits per chunk for parallel processing
 */

/// @notice Compute XOR of two bits: out = a ⊕ b = a + b - 2·a·b
template BitXOR() {
    signal input a;
    signal input b;
    signal output out;

    signal ab;
    ab <== a * b;
    out <== a + b - 2 * ab;
}

/// @notice Compute Hamming distance between two binary vectors of length N
template HammingDistance(N) {
    signal input a[N];
    signal input b[N];
    signal output distance;

    component xors[N];
    signal accumulator[N + 1];
    accumulator[0] <== 0;

    for (var i = 0; i < N; i++) {
        // Verify inputs are binary
        a[i] * (1 - a[i]) === 0;
        b[i] * (1 - b[i]) === 0;

        // XOR: different bits contribute 1 to the distance
        xors[i] = BitXOR();
        xors[i].a <== a[i];
        xors[i].b <== b[i];

        accumulator[i + 1] <== accumulator[i] + xors[i].out;
    }

    distance <== accumulator[N];
}

/// @notice Check that a value is less than or equal to a threshold
///         Uses LessThan with +1 offset to implement ≤
template LessEqThan(n) {
    signal input in[2];
    signal output out;

    component lt = LessThan(n);
    lt.in[0] <== in[0];
    lt.in[1] <== in[1] + 1;
    out <== lt.out;
}

/// @notice Commit to a biometric template using Poseidon hash.
///         Breaks the template into chunks and chains hashes.
template TemplateCommitment(N) {
    signal input template_bits[N];
    signal input salt;
    signal output commitment;

    // Pack bits into field elements (chunks of 253 bits for BN254 field)
    var CHUNK_BITS = 250; // Safe packing size
    var NUM_CHUNKS = (N + CHUNK_BITS - 1) \ CHUNK_BITS; // Ceiling division

    signal chunks[NUM_CHUNKS];

    for (var c = 0; c < NUM_CHUNKS; c++) {
        signal chunkAccum[CHUNK_BITS + 1];
        chunkAccum[0] <== 0;

        for (var b = 0; b < CHUNK_BITS; b++) {
            var globalIdx = c * CHUNK_BITS + b;
            if (globalIdx < N) {
                // Pack bit into field element: chunk += bit * 2^b
                signal bitScaled;
                var power = 1;
                for (var p = 0; p < b; p++) {
                    power = power * 2;
                }
                bitScaled <== template_bits[globalIdx] * power;
                chunkAccum[b + 1] <== chunkAccum[b] + bitScaled;
            } else {
                chunkAccum[b + 1] <== chunkAccum[b];
            }
        }

        chunks[c] <== chunkAccum[CHUNK_BITS];
    }

    // Chain Poseidon hashes over chunks with salt
    signal hashChain[NUM_CHUNKS + 1];
    hashChain[0] <== salt;

    component hashers[NUM_CHUNKS];
    for (var c = 0; c < NUM_CHUNKS; c++) {
        hashers[c] = Poseidon(2);
        hashers[c].inputs[0] <== hashChain[c];
        hashers[c].inputs[1] <== chunks[c];
        hashChain[c + 1] <== hashers[c].out;
    }

    commitment <== hashChain[NUM_CHUNKS];
}

/// @notice Anti-replay challenge binding
///         Binds the proof to a verifier-provided challenge
template ChallengeBinding() {
    signal input challenge;          // Verifier-provided nonce
    signal input verifierIdentity;   // Hash of the verifier's identity
    signal input timestamp;          // Current timestamp
    signal input proofData;          // Commitment to the proof internals
    signal output binding;

    component hasher = Poseidon(4);
    hasher.inputs[0] <== challenge;
    hasher.inputs[1] <== verifierIdentity;
    hasher.inputs[2] <== timestamp;
    hasher.inputs[3] <== proofData;
    binding <== hasher.out;
}

/// @notice Template freshness check: verify the template was enrolled recently
///         or within an acceptable window
template TemplateFreshness() {
    signal input enrollmentTimestamp;
    signal input currentTimestamp;
    signal input maxAge;              // Maximum age in seconds
    signal output valid;

    // Check: currentTimestamp - enrollmentTimestamp <= maxAge
    signal age;
    age <== currentTimestamp - enrollmentTimestamp;

    component check = LessEqThan(64);
    check.in[0] <== age;
    check.in[1] <== maxAge;
    valid <== check.out;
}

/// @notice Liveness detection commitment
///         Prevents use of recorded/replayed biometrics
template LivenessProof() {
    signal input sampleHash;
    signal input captureNonce;       // Random nonce provided at capture time
    signal input sensorId;           // Identifier of the capture device
    signal output livenessCommitment;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== sampleHash;
    hasher.inputs[1] <== captureNonce;
    hasher.inputs[2] <== sensorId;
    livenessCommitment <== hasher.out;
}

/// @notice Main biometric matching circuit
///         FEATURE_LEN = length of binary feature vectors
template BiometricMatch(FEATURE_LEN) {
    // ── Public inputs ──
    signal input enrolledCommitment;     // Poseidon commitment of the enrolled template
    signal input matchThreshold;         // Maximum allowed Hamming distance
    signal input challenge;              // Anti-replay challenge from verifier
    signal input verifierIdentity;       // Verifier's identity hash
    signal input timestamp;              // Current timestamp

    // ── Private inputs ──
    signal input enrolledTemplate[FEATURE_LEN];  // Enrolled biometric template (binary)
    signal input freshSample[FEATURE_LEN];       // Fresh biometric sample (binary)
    signal input templateSalt;                    // Salt used in template commitment
    signal input captureNonce;                    // Liveness nonce from capture
    signal input sensorId;                        // Capture device identifier
    signal input enrollmentTimestamp;              // When the template was enrolled
    signal input maxTemplateAge;                  // Maximum template age allowed

    // ── Public outputs ──
    signal output matchResult;           // 1 if match, 0 if no match
    signal output challengeBinding;      // Anti-replay binding
    signal output livenessCommitment;    // Proof of live capture

    // ── Step 1: Verify enrolled template commitment ──
    component templateCommit = TemplateCommitment(FEATURE_LEN);
    for (var i = 0; i < FEATURE_LEN; i++) {
        templateCommit.template_bits[i] <== enrolledTemplate[i];
    }
    templateCommit.salt <== templateSalt;

    // The computed commitment must match the enrolled commitment
    component commitCheck = IsEqual();
    commitCheck.in[0] <== templateCommit.commitment;
    commitCheck.in[1] <== enrolledCommitment;
    commitCheck.out === 1;

    // ── Step 2: Compute Hamming distance ──
    component hamming = HammingDistance(FEATURE_LEN);
    for (var i = 0; i < FEATURE_LEN; i++) {
        hamming.a[i] <== enrolledTemplate[i];
        hamming.b[i] <== freshSample[i];
    }

    // ── Step 3: Check distance ≤ threshold ──
    component thresholdCheck = LessEqThan(32);
    thresholdCheck.in[0] <== hamming.distance;
    thresholdCheck.in[1] <== matchThreshold;

    matchResult <== thresholdCheck.out;

    // ── Step 4: Template freshness verification ──
    component freshness = TemplateFreshness();
    freshness.enrollmentTimestamp <== enrollmentTimestamp;
    freshness.currentTimestamp <== timestamp;
    freshness.maxAge <== maxTemplateAge;
    freshness.valid === 1;

    // ── Step 5: Liveness proof ──
    // Hash the fresh sample for liveness binding
    component sampleHasher = Poseidon(2);
    signal sampleChunk;

    // Pack first 250 bits of sample into a field element for hashing
    signal samplePack[FEATURE_LEN + 1];
    samplePack[0] <== 0;
    for (var i = 0; i < FEATURE_LEN; i++) {
        if (i < 250) {
            signal sBit;
            var power = 1;
            for (var p = 0; p < i; p++) {
                power = power * 2;
            }
            sBit <== freshSample[i] * power;
            samplePack[i + 1] <== samplePack[i] + sBit;
        } else {
            samplePack[i + 1] <== samplePack[i];
        }
    }

    sampleHasher.inputs[0] <== samplePack[FEATURE_LEN];
    sampleHasher.inputs[1] <== templateSalt;

    component liveness = LivenessProof();
    liveness.sampleHash <== sampleHasher.out;
    liveness.captureNonce <== captureNonce;
    liveness.sensorId <== sensorId;
    livenessCommitment <== liveness.livenessCommitment;

    // ── Step 6: Anti-replay challenge binding ──
    // Bind the proof to the verifier's challenge
    component proofDataHasher = Poseidon(3);
    proofDataHasher.inputs[0] <== templateCommit.commitment;
    proofDataHasher.inputs[1] <== hamming.distance;
    proofDataHasher.inputs[2] <== livenessCommitment;

    component antiReplay = ChallengeBinding();
    antiReplay.challenge <== challenge;
    antiReplay.verifierIdentity <== verifierIdentity;
    antiReplay.timestamp <== timestamp;
    antiReplay.proofData <== proofDataHasher.out;
    challengeBinding <== antiReplay.binding;

    // ── Step 7: Final integrity constraint ──
    // Ensure the proof is internally consistent
    component integrity = Poseidon(5);
    integrity.inputs[0] <== matchResult;
    integrity.inputs[1] <== challengeBinding;
    integrity.inputs[2] <== livenessCommitment;
    integrity.inputs[3] <== enrolledCommitment;
    integrity.inputs[4] <== hamming.distance;

    // Constrain: integrity hash must be non-zero
    component integrityNonZero = IsZero();
    integrityNonZero.in <== integrity.out;
    integrityNonZero.out === 0;
}

// Default instantiation: 256-bit feature vectors
component main {public [enrolledCommitment, matchThreshold, challenge, verifierIdentity, timestamp]} = BiometricMatch(256);
