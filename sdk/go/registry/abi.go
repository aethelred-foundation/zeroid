// Package registry provides ABI type definitions and client interfaces for
// interacting with the ZeroID on-chain identity and credential registry.
package registry

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// ErrInvalidABIData is returned when ABI-encoded data cannot be decoded.
var ErrInvalidABIData = errors.New("registry: invalid ABI data")

// Identity represents an on-chain identity record matching the Solidity struct.
type Identity struct {
	// DIDHash is the keccak256 hash of the DID URI.
	DIDHash [32]byte
	// Controller is the DID of the controlling entity.
	Controller string
	// PublicKey is the raw public key bytes.
	PublicKey []byte
	// Status is the identity status (0=Inactive, 1=Active, 2=Suspended, 3=Revoked).
	Status uint8
	// CreatedAt is the Unix timestamp when the identity was created.
	CreatedAt uint64
	// UpdatedAt is the Unix timestamp when the identity was last updated.
	UpdatedAt uint64
}

// Credential represents an on-chain credential record matching the Solidity struct.
type Credential struct {
	// CredentialHash is the keccak256 hash of the credential.
	CredentialHash [32]byte
	// IssuerDID is the DID of the credential issuer.
	IssuerDID string
	// SubjectDID is the DID of the credential subject.
	SubjectDID string
	// SchemaHash is the hash of the credential schema.
	SchemaHash [32]byte
	// Status is the credential status (0=None, 1=Active, 2=Suspended, 3=Revoked, 4=Expired).
	Status uint8
	// IssuedAt is the Unix timestamp when the credential was issued.
	IssuedAt uint64
	// ExpiresAt is the Unix timestamp when the credential expires (0 = no expiry).
	ExpiresAt uint64
}

// AttestationRecord represents an on-chain TEE attestation record.
type AttestationRecord struct {
	// ReportHash is the keccak256 hash of the attestation report.
	ReportHash [32]byte
	// Platform is the TEE platform identifier.
	Platform uint8
	// VerifiedAt is the Unix timestamp when the attestation was verified.
	VerifiedAt uint64
	// IsValid indicates whether the attestation is currently valid.
	IsValid bool
}

// PackIdentity encodes an Identity into ABI-compatible bytes.
// Format: DIDHash(32) + Status(1) + CreatedAt(8) + UpdatedAt(8) + ControllerLen(4) + Controller + PubKeyLen(4) + PubKey
func PackIdentity(id *Identity) ([]byte, error) {
	if id == nil {
		return nil, errors.New("registry: nil identity")
	}
	controllerBytes := []byte(id.Controller)
	size := 32 + 1 + 8 + 8 + 4 + len(controllerBytes) + 4 + len(id.PublicKey)
	buf := make([]byte, size)
	offset := 0

	copy(buf[offset:offset+32], id.DIDHash[:])
	offset += 32

	buf[offset] = id.Status
	offset++

	binary.BigEndian.PutUint64(buf[offset:offset+8], id.CreatedAt)
	offset += 8

	binary.BigEndian.PutUint64(buf[offset:offset+8], id.UpdatedAt)
	offset += 8

	binary.BigEndian.PutUint32(buf[offset:offset+4], uint32(len(controllerBytes)))
	offset += 4
	copy(buf[offset:offset+len(controllerBytes)], controllerBytes)
	offset += len(controllerBytes)

	binary.BigEndian.PutUint32(buf[offset:offset+4], uint32(len(id.PublicKey)))
	offset += 4
	copy(buf[offset:], id.PublicKey)

	return buf, nil
}

// UnpackIdentity decodes ABI-compatible bytes into an Identity.
func UnpackIdentity(data []byte) (*Identity, error) {
	if len(data) < 53 { // 32 + 1 + 8 + 8 + 4
		return nil, fmt.Errorf("%w: data too short for identity", ErrInvalidABIData)
	}

	id := &Identity{}
	offset := 0

	copy(id.DIDHash[:], data[offset:offset+32])
	offset += 32

	id.Status = data[offset]
	offset++

	id.CreatedAt = binary.BigEndian.Uint64(data[offset : offset+8])
	offset += 8

	id.UpdatedAt = binary.BigEndian.Uint64(data[offset : offset+8])
	offset += 8

	controllerLen := binary.BigEndian.Uint32(data[offset : offset+4])
	offset += 4

	if offset+int(controllerLen) > len(data) {
		return nil, fmt.Errorf("%w: data too short for controller", ErrInvalidABIData)
	}
	id.Controller = string(data[offset : offset+int(controllerLen)])
	offset += int(controllerLen)

	if offset+4 > len(data) {
		return nil, fmt.Errorf("%w: data too short for pubkey length", ErrInvalidABIData)
	}
	pubKeyLen := binary.BigEndian.Uint32(data[offset : offset+4])
	offset += 4

	if offset+int(pubKeyLen) > len(data) {
		return nil, fmt.Errorf("%w: data too short for pubkey", ErrInvalidABIData)
	}
	id.PublicKey = make([]byte, pubKeyLen)
	copy(id.PublicKey, data[offset:offset+int(pubKeyLen)])

	return id, nil
}

// PackCredential encodes a Credential into ABI-compatible bytes.
func PackCredential(cred *Credential) ([]byte, error) {
	if cred == nil {
		return nil, errors.New("registry: nil credential")
	}
	issuerBytes := []byte(cred.IssuerDID)
	subjectBytes := []byte(cred.SubjectDID)
	size := 32 + 32 + 1 + 8 + 8 + 4 + len(issuerBytes) + 4 + len(subjectBytes)
	buf := make([]byte, size)
	offset := 0

	copy(buf[offset:offset+32], cred.CredentialHash[:])
	offset += 32

	copy(buf[offset:offset+32], cred.SchemaHash[:])
	offset += 32

	buf[offset] = cred.Status
	offset++

	binary.BigEndian.PutUint64(buf[offset:offset+8], cred.IssuedAt)
	offset += 8

	binary.BigEndian.PutUint64(buf[offset:offset+8], cred.ExpiresAt)
	offset += 8

	binary.BigEndian.PutUint32(buf[offset:offset+4], uint32(len(issuerBytes)))
	offset += 4
	copy(buf[offset:offset+len(issuerBytes)], issuerBytes)
	offset += len(issuerBytes)

	binary.BigEndian.PutUint32(buf[offset:offset+4], uint32(len(subjectBytes)))
	offset += 4
	copy(buf[offset:], subjectBytes)

	return buf, nil
}

// UnpackCredential decodes ABI-compatible bytes into a Credential.
func UnpackCredential(data []byte) (*Credential, error) {
	if len(data) < 85 { // 32 + 32 + 1 + 8 + 8 + 4
		return nil, fmt.Errorf("%w: data too short for credential", ErrInvalidABIData)
	}

	cred := &Credential{}
	offset := 0

	copy(cred.CredentialHash[:], data[offset:offset+32])
	offset += 32

	copy(cred.SchemaHash[:], data[offset:offset+32])
	offset += 32

	cred.Status = data[offset]
	offset++

	cred.IssuedAt = binary.BigEndian.Uint64(data[offset : offset+8])
	offset += 8

	cred.ExpiresAt = binary.BigEndian.Uint64(data[offset : offset+8])
	offset += 8

	issuerLen := binary.BigEndian.Uint32(data[offset : offset+4])
	offset += 4

	if offset+int(issuerLen) > len(data) {
		return nil, fmt.Errorf("%w: data too short for issuer", ErrInvalidABIData)
	}
	cred.IssuerDID = string(data[offset : offset+int(issuerLen)])
	offset += int(issuerLen)

	if offset+4 > len(data) {
		return nil, fmt.Errorf("%w: data too short for subject length", ErrInvalidABIData)
	}
	subjectLen := binary.BigEndian.Uint32(data[offset : offset+4])
	offset += 4

	if offset+int(subjectLen) > len(data) {
		return nil, fmt.Errorf("%w: data too short for subject", ErrInvalidABIData)
	}
	cred.SubjectDID = string(data[offset : offset+int(subjectLen)])

	return cred, nil
}
