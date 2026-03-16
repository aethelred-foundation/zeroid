// Package crypto provides cryptographic primitives for the ZeroID SDK,
// including Keccak256 hashing, BBS+ signatures, and cryptographic accumulators.
package crypto

import (
	"golang.org/x/crypto/sha3"
)

// Keccak256 computes the Keccak-256 hash of the given data, returning
// a 32-byte array. This is the same hash function used by Ethereum.
func Keccak256(data []byte) [32]byte {
	h := sha3.NewLegacyKeccak256()
	h.Write(data)
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

// ComputeDIDHash computes the Keccak-256 hash of a DID string.
// This is used to derive the on-chain identity hash from a DID URI.
func ComputeDIDHash(did string) [32]byte {
	return Keccak256([]byte(did))
}
