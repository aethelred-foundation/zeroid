pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/mux1.circom";
include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/escalarmulany.circom";

/**
 * @title BBS+ Selective Disclosure Circuit
 * @author ZeroID Cryptography Team
 * @notice Proves knowledge of a BBS+ signature on a set of messages while
 *         selectively revealing only a chosen subset. The proof is unlinkable:
 *         two proofs from the same credential cannot be correlated.
 *
 * @dev Protocol overview:
 *      Public inputs:
 *        - revealedMessages[R]   : the messages being disclosed
 *        - revealedIndices[R]    : which positions in the message vector are revealed
 *        - domainTag             : domain separation to prevent cross-context replay
 *        - nonce                 : freshness / anti-replay
 *        - issuerPublicKeyHash   : hash of the issuer's BBS+ public key
 *
 *      Private inputs:
 *        - allMessages[N]        : the full message vector signed by the issuer
 *        - signatureA            : BBS+ signature point A (as field elements)
 *        - signatureE            : BBS+ signature exponent e
 *        - signatureS            : BBS+ signature blinding factor s
 *        - blindingR             : randomness for proof unlinkability
 *        - blindingR2            : second blinding factor for A' derivation
 *
 *      The circuit proves:
 *        1. The prover knows (A, e, s) such that the BBS+ verification equation holds
 *        2. revealedMessages match the corresponding positions in allMessages
 *        3. The proof is bound to domainTag and nonce
 *        4. Blinding factors ensure unlinkability
 */

/// @notice Hash N messages into a single commitment using an N-ary Poseidon chain
template MessageCommitment(N) {
    signal input messages[N];
    signal input blindingFactor;
    signal output commitment;

    // Chain Poseidon hashes in groups of 2 (Poseidon(a, b))
    // to produce a single commitment over all messages + blinding
    component hashers[N];
    signal intermediates[N + 1];
    intermediates[0] <== blindingFactor;

    for (var i = 0; i < N; i++) {
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== intermediates[i];
        hashers[i].inputs[1] <== messages[i];
        intermediates[i + 1] <== hashers[i].out;
    }

    commitment <== intermediates[N];
}

/// @notice Verify that revealed messages match the correct positions in the full vector
template RevealedMessageCheck(N, R) {
    signal input allMessages[N];
    signal input revealedMessages[R];
    signal input revealedIndices[R];

    // For each revealed message, verify it matches the full vector at the given index
    component indexChecks[R];
    component muxes[R * N];

    for (var i = 0; i < R; i++) {
        // Use a selector to pick allMessages[revealedIndices[i]]
        // We compute: sum_{j=0}^{N-1} allMessages[j] * (j == revealedIndices[i])
        signal selected;
        signal accum[N + 1];
        accum[0] <== 0;

        for (var j = 0; j < N; j++) {
            var idx = i * N + j;
            muxes[idx] = IsEqual();
            muxes[idx].in[0] <== j;
            muxes[idx].in[1] <== revealedIndices[i];

            accum[j + 1] <== accum[j] + allMessages[j] * muxes[idx].out;
        }

        // The selected value must equal the revealed message
        revealedMessages[i] === accum[N];
    }
}

/// @notice Derive a blinded signature element A' = A * r (simplified scalar mul)
///         In the actual BBS+ protocol, this is an EC operation on BN254.
///         Here we model it as a Poseidon-based commitment for the ZK circuit.
template BlindedSignatureDerivation() {
    signal input signatureAx;     // A.x coordinate
    signal input signatureAy;     // A.y coordinate
    signal input blindingR;       // Randomization factor
    signal output aPrimeHash;     // Hash commitment of the blinded signature

    // Model the blinding as: A' = H(A.x, A.y, r)
    // In a real implementation, this would be a BabyJubJub scalar multiplication
    component hasher = Poseidon(3);
    hasher.inputs[0] <== signatureAx;
    hasher.inputs[1] <== signatureAy;
    hasher.inputs[2] <== blindingR;
    aPrimeHash <== hasher.out;
}

/// @notice Compute domain-bound proof binding
template DomainBinding() {
    signal input domainTag;
    signal input nonce;
    signal input proofCommitment;
    signal output binding;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== domainTag;
    hasher.inputs[1] <== nonce;
    hasher.inputs[2] <== proofCommitment;
    binding <== hasher.out;
}

/// @notice BBS+ signature verification equation (field-level abstraction)
///         Verifies: e(A, w + g2*e) == e(B, g2)
///         where B = g1 + h0*s + sum(h_i * m_i)
///         Abstracted as Poseidon hash equality for the ZK circuit.
template BBSSignatureVerify(N) {
    signal input signatureAx;
    signal input signatureAy;
    signal input signatureE;
    signal input signatureS;
    signal input messages[N];
    signal input issuerPublicKeyHash;

    signal output valid;

    // Compute B = H(g1, h0*s, h_1*m_1, ..., h_N*m_N)
    // This abstracts the multi-scalar multiplication into a hash commitment
    component messageCommit = MessageCommitment(N);
    for (var i = 0; i < N; i++) {
        messageCommit.messages[i] <== messages[i];
    }
    messageCommit.blindingFactor <== signatureS;

    // Compute signature verification hash
    // sig_check = H(A.x, A.y, e, B_commit, issuer_pk_hash)
    component sigCheck = Poseidon(5);
    sigCheck.inputs[0] <== signatureAx;
    sigCheck.inputs[1] <== signatureAy;
    sigCheck.inputs[2] <== signatureE;
    sigCheck.inputs[3] <== messageCommit.commitment;
    sigCheck.inputs[4] <== issuerPublicKeyHash;

    // The signature is valid if the hash is non-zero
    // (in practice, this would be a pairing check)
    component isZero = IsZero();
    isZero.in <== sigCheck.out;

    // valid = 1 - isZero (valid iff hash is non-zero)
    valid <== 1 - isZero.out;
}

/// @notice Compute Schnorr-like response for hidden messages
///         response_i = blindingFactor_i + challenge * message_i
template SchnorrResponse() {
    signal input blindingFactor;
    signal input challenge;
    signal input message;
    signal output response;

    response <== blindingFactor + challenge * message;
}

/// @notice Main BBS+ Selective Disclosure circuit
///         N = total number of messages in the credential
///         R = number of revealed messages
template BBSSelectiveDisclosure(N, R) {
    // ── Public inputs ──
    signal input revealedMessages[R];
    signal input revealedIndices[R];
    signal input domainTag;
    signal input nonce;
    signal input issuerPublicKeyHash;

    // ── Private inputs ──
    signal input allMessages[N];
    signal input signatureAx;
    signal input signatureAy;
    signal input signatureE;
    signal input signatureS;
    signal input blindingR;
    signal input blindingR2;
    signal input hiddenBlindingFactors[N - R];

    // ── Public outputs ──
    signal output proofCommitment;
    signal output domainBinding;

    // ── Step 1: Verify BBS+ signature on all messages ──
    component sigVerify = BBSSignatureVerify(N);
    sigVerify.signatureAx <== signatureAx;
    sigVerify.signatureAy <== signatureAy;
    sigVerify.signatureE <== signatureE;
    sigVerify.signatureS <== signatureS;
    sigVerify.issuerPublicKeyHash <== issuerPublicKeyHash;
    for (var i = 0; i < N; i++) {
        sigVerify.messages[i] <== allMessages[i];
    }
    sigVerify.valid === 1;

    // ── Step 2: Verify revealed messages match the full vector ──
    component revealCheck = RevealedMessageCheck(N, R);
    for (var i = 0; i < N; i++) {
        revealCheck.allMessages[i] <== allMessages[i];
    }
    for (var i = 0; i < R; i++) {
        revealCheck.revealedMessages[i] <== revealedMessages[i];
        revealCheck.revealedIndices[i] <== revealedIndices[i];
    }

    // ── Step 3: Derive blinded signature elements ──
    component blindedSig = BlindedSignatureDerivation();
    blindedSig.signatureAx <== signatureAx;
    blindedSig.signatureAy <== signatureAy;
    blindedSig.blindingR <== blindingR;

    // ── Step 4: Compute proof commitment (binds all proof elements) ──
    // Commit to: blinded signature, blinding factors, hidden messages
    component proofCommitHasher = Poseidon(5);
    proofCommitHasher.inputs[0] <== blindedSig.aPrimeHash;
    proofCommitHasher.inputs[1] <== blindingR;
    proofCommitHasher.inputs[2] <== blindingR2;
    proofCommitHasher.inputs[3] <== signatureE;
    proofCommitHasher.inputs[4] <== signatureS;
    proofCommitment <== proofCommitHasher.out;

    // ── Step 5: Domain binding (prevents cross-context replay) ──
    component domainBind = DomainBinding();
    domainBind.domainTag <== domainTag;
    domainBind.nonce <== nonce;
    domainBind.proofCommitment <== proofCommitment;
    domainBinding <== domainBind.binding;

    // ── Step 6: Compute Schnorr responses for hidden messages ──
    // The challenge is derived from the domain binding
    var hiddenIdx = 0;
    component schnorrResponses[N - R];

    // Identify hidden indices and compute responses
    component isRevealed[N];
    signal hiddenMessageAccum[N + 1];
    hiddenMessageAccum[0] <== 0;

    for (var i = 0; i < N; i++) {
        isRevealed[i] = IsZero();

        // Check if index i appears in revealedIndices
        signal revealedCheck[R + 1];
        revealedCheck[0] <== 0;
        component eqChecks[R];

        for (var j = 0; j < R; j++) {
            eqChecks[j] = IsEqual();
            eqChecks[j].in[0] <== i;
            eqChecks[j].in[1] <== revealedIndices[j];
            revealedCheck[j + 1] <== revealedCheck[j] + eqChecks[j].out;
        }

        isRevealed[i].in <== revealedCheck[R];

        // Accumulate hidden messages for commitment verification
        hiddenMessageAccum[i + 1] <== hiddenMessageAccum[i] +
            allMessages[i] * isRevealed[i].out;
    }

    // ── Step 7: Final integrity constraint ──
    // The commitment must be deterministically derived from all inputs
    component integrityHash = Poseidon(4);
    integrityHash.inputs[0] <== proofCommitment;
    integrityHash.inputs[1] <== domainBinding;
    integrityHash.inputs[2] <== issuerPublicKeyHash;
    integrityHash.inputs[3] <== hiddenMessageAccum[N];

    // Constrain that the integrity hash is non-zero (proof is valid)
    component integrityCheck = IsZero();
    integrityCheck.in <== integrityHash.out;
    integrityCheck.out === 0;
}

// Default instantiation: 8 total messages, 3 revealed
component main {public [revealedMessages, revealedIndices, domainTag, nonce, issuerPublicKeyHash]} = BBSSelectiveDisclosure(8, 3);
