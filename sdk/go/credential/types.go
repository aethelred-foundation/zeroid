// Package credential provides types and verification logic for W3C
// Verifiable Credentials and Verifiable Presentations in the ZeroID system.
package credential

import (
	"fmt"
	"time"
)

// CredentialStatus represents the lifecycle status of a verifiable credential.
type CredentialStatus int

const (
	// StatusNone indicates no status has been set.
	StatusNone CredentialStatus = iota
	// StatusActive indicates the credential is active and valid.
	StatusActive
	// StatusSuspended indicates the credential has been temporarily suspended.
	StatusSuspended
	// StatusRevoked indicates the credential has been permanently revoked.
	StatusRevoked
	// StatusExpired indicates the credential has expired.
	StatusExpired
)

// String returns the human-readable name for a CredentialStatus.
func (s CredentialStatus) String() string {
	switch s {
	case StatusNone:
		return "None"
	case StatusActive:
		return "Active"
	case StatusSuspended:
		return "Suspended"
	case StatusRevoked:
		return "Revoked"
	case StatusExpired:
		return "Expired"
	default:
		return fmt.Sprintf("Unknown(%d)", int(s))
	}
}

// VerifiableCredential represents a W3C Verifiable Credential.
type VerifiableCredential struct {
	// Context is the JSON-LD context.
	Context []string `json:"@context"`
	// ID is the unique identifier for this credential.
	ID string `json:"id"`
	// Type is the list of credential types.
	Type []string `json:"type"`
	// Issuer is the DID of the credential issuer.
	Issuer string `json:"issuer"`
	// IssuanceDate is when the credential was issued.
	IssuanceDate time.Time `json:"issuanceDate"`
	// ExpirationDate is when the credential expires (zero value means no expiry).
	ExpirationDate time.Time `json:"expirationDate,omitempty"`
	// CredentialSubject contains the claims about the subject.
	CredentialSubject CredentialSubject `json:"credentialSubject"`
	// Proof contains the cryptographic proof.
	Proof *Proof `json:"proof,omitempty"`
	// Status is the current lifecycle status.
	Status CredentialStatus `json:"status"`
	// SchemaID is the identifier of the credential schema.
	SchemaID string `json:"credentialSchema,omitempty"`
}

// CredentialSubject contains the claims made about the subject of a credential.
type CredentialSubject struct {
	// ID is the DID of the subject.
	ID string `json:"id"`
	// Attributes holds the key-value claims.
	Attributes map[string]interface{} `json:"attributes,omitempty"`
}

// Proof represents the cryptographic proof attached to a verifiable credential
// or presentation.
type Proof struct {
	// Type is the proof type (e.g., "BbsBlsSignature2020").
	Type string `json:"type"`
	// Created is when the proof was created.
	Created time.Time `json:"created"`
	// VerificationMethod is the ID of the verification method used.
	VerificationMethod string `json:"verificationMethod"`
	// ProofPurpose is the purpose of the proof (e.g., "assertionMethod").
	ProofPurpose string `json:"proofPurpose"`
	// ProofValue is the encoded proof value.
	ProofValue string `json:"proofValue"`
}

// VerifiablePresentation represents a W3C Verifiable Presentation.
type VerifiablePresentation struct {
	// Context is the JSON-LD context.
	Context []string `json:"@context"`
	// ID is the unique identifier for this presentation.
	ID string `json:"id"`
	// Type is the list of presentation types.
	Type []string `json:"type"`
	// Holder is the DID of the entity presenting the credentials.
	Holder string `json:"holder"`
	// VerifiableCredential contains the credentials being presented.
	VerifiableCredential []VerifiableCredential `json:"verifiableCredential"`
	// Proof contains the cryptographic proof of the presentation.
	Proof *Proof `json:"proof,omitempty"`
}
