// Package did implements W3C Decentralized Identifier (DID) document types
// and resolution for the ZeroID did:zero method.
package did

import "fmt"

// IdentityStatus represents the lifecycle status of a DID identity on-chain.
type IdentityStatus int

const (
	// StatusInactive indicates the identity has not been activated.
	StatusInactive IdentityStatus = iota
	// StatusActive indicates the identity is active and usable.
	StatusActive
	// StatusSuspended indicates the identity has been temporarily suspended.
	StatusSuspended
	// StatusRevoked indicates the identity has been permanently revoked.
	StatusRevoked
)

// String returns the human-readable name for an IdentityStatus.
func (s IdentityStatus) String() string {
	switch s {
	case StatusInactive:
		return "Inactive"
	case StatusActive:
		return "Active"
	case StatusSuspended:
		return "Suspended"
	case StatusRevoked:
		return "Revoked"
	default:
		return fmt.Sprintf("Unknown(%d)", int(s))
	}
}

// DIDDocument represents a W3C DID Document as defined in
// https://www.w3.org/TR/did-core/.
type DIDDocument struct {
	// Context is the JSON-LD context for the DID document.
	Context []string `json:"@context"`
	// ID is the DID URI that identifies this document.
	ID string `json:"id"`
	// Controller is the DID of the entity controlling this document.
	Controller string `json:"controller,omitempty"`
	// VerificationMethod lists the verification methods associated with this DID.
	VerificationMethod []VerificationMethod `json:"verificationMethod,omitempty"`
	// Authentication lists verification method IDs used for authentication.
	Authentication []string `json:"authentication,omitempty"`
	// AssertionMethod lists verification method IDs used for assertions.
	AssertionMethod []string `json:"assertionMethod,omitempty"`
	// Service lists service endpoints associated with this DID.
	Service []Service `json:"service,omitempty"`
	// Status is the current lifecycle status of this identity.
	Status IdentityStatus `json:"status"`
}

// VerificationMethod represents a cryptographic public key or verification
// method associated with a DID, as defined in the W3C DID Core specification.
type VerificationMethod struct {
	// ID is the unique identifier for this verification method.
	ID string `json:"id"`
	// Type is the type of verification method (e.g., "EcdsaSecp256k1VerificationKey2019").
	Type string `json:"type"`
	// Controller is the DID that controls this verification method.
	Controller string `json:"controller"`
	// PublicKeyHex is the hex-encoded public key.
	PublicKeyHex string `json:"publicKeyHex,omitempty"`
	// PublicKeyMultibase is the multibase-encoded public key.
	PublicKeyMultibase string `json:"publicKeyMultibase,omitempty"`
}

// Service represents a service endpoint associated with a DID,
// such as a messaging or credential exchange service.
type Service struct {
	// ID is the unique identifier for this service.
	ID string `json:"id"`
	// Type is the type of service (e.g., "CredentialRegistry").
	Type string `json:"type"`
	// ServiceEndpoint is the URL of the service endpoint.
	ServiceEndpoint string `json:"serviceEndpoint"`
}
