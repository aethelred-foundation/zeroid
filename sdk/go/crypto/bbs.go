package crypto

import (
	"errors"
)

// ErrInvalidSignature is returned when a BBS+ signature verification fails.
var ErrInvalidSignature = errors.New("bbs: invalid signature")

// ErrInvalidProof is returned when a BBS+ proof verification fails.
var ErrInvalidProof = errors.New("bbs: invalid proof")

// ErrNoMessages is returned when no messages are provided for signing or verification.
var ErrNoMessages = errors.New("bbs: no messages provided")

// ErrNilPublicKey is returned when a nil public key is provided.
var ErrNilPublicKey = errors.New("bbs: nil public key")

// BBSPublicKey represents a BBS+ public key used for signature verification
// and selective disclosure proof verification.
type BBSPublicKey struct {
	// Key is the raw public key bytes.
	Key []byte
	// MessageCount is the maximum number of messages this key can sign.
	MessageCount int
}

// BBSSignature represents a BBS+ signature over a set of messages.
type BBSSignature struct {
	// Data is the raw signature bytes.
	Data []byte
}

// BBSProof represents a BBS+ zero-knowledge proof for selective disclosure.
type BBSProof struct {
	// Data is the raw proof bytes.
	Data []byte
	// RevealedIndexes indicates which message indexes are disclosed.
	RevealedIndexes []int
}

// BBSVerify verifies a BBS+ signature against the given public key and messages.
// This is a stub implementation that validates inputs and simulates verification.
func BBSVerify(pk *BBSPublicKey, signature *BBSSignature, messages [][]byte) error {
	if pk == nil {
		return ErrNilPublicKey
	}
	if len(messages) == 0 {
		return ErrNoMessages
	}
	if signature == nil || len(signature.Data) == 0 {
		return ErrInvalidSignature
	}
	if len(pk.Key) == 0 {
		return ErrInvalidSignature
	}
	// Stub: in a real implementation, this would perform BLS pairing checks.
	// For now, a valid signature is one with exactly 48 bytes (simulated G1 point).
	if len(signature.Data) != 48 {
		return ErrInvalidSignature
	}
	return nil
}

// BBSCreateProof creates a zero-knowledge proof for selective disclosure of
// messages from a BBS+ signature. Only messages at the specified revealedIndexes
// are disclosed; all others remain hidden.
func BBSCreateProof(pk *BBSPublicKey, signature *BBSSignature, messages [][]byte, revealedIndexes []int) (*BBSProof, error) {
	if pk == nil {
		return nil, ErrNilPublicKey
	}
	if len(messages) == 0 {
		return nil, ErrNoMessages
	}
	if signature == nil || len(signature.Data) == 0 {
		return nil, ErrInvalidSignature
	}
	if len(pk.Key) == 0 {
		return nil, ErrInvalidSignature
	}
	for _, idx := range revealedIndexes {
		if idx < 0 || idx >= len(messages) {
			return nil, errors.New("bbs: revealed index out of range")
		}
	}
	// Stub: produce a deterministic proof from a hash of the inputs.
	h := Keccak256(signature.Data)
	return &BBSProof{
		Data:            h[:],
		RevealedIndexes: revealedIndexes,
	}, nil
}

// BBSVerifyProof verifies a BBS+ zero-knowledge proof for selective disclosure.
// The revealedMessages must correspond to the indexes specified in the proof.
func BBSVerifyProof(pk *BBSPublicKey, proof *BBSProof, revealedMessages [][]byte) error {
	if pk == nil {
		return ErrNilPublicKey
	}
	if proof == nil || len(proof.Data) == 0 {
		return ErrInvalidProof
	}
	if len(pk.Key) == 0 {
		return ErrInvalidProof
	}
	if len(revealedMessages) == 0 {
		return ErrNoMessages
	}
	if len(revealedMessages) != len(proof.RevealedIndexes) {
		return ErrInvalidProof
	}
	// Stub: in a real implementation, this would verify the ZK proof.
	// We accept proofs with 32-byte data (matching our Keccak256 output).
	if len(proof.Data) != 32 {
		return ErrInvalidProof
	}
	return nil
}
