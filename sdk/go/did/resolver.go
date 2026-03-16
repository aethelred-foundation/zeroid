package did

import (
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/aethelred/zeroid-sdk-go/crypto"
	"github.com/aethelred/zeroid-sdk-go/registry"
)

// ErrInvalidDID is returned when a DID URI is malformed.
var ErrInvalidDID = errors.New("did: invalid DID format")

// ErrDIDMethodNotSupported is returned when the DID method is not "zero".
var ErrDIDMethodNotSupported = errors.New("did: method not supported")

// ErrDIDNotFound is returned when a DID cannot be resolved.
var ErrDIDNotFound = errors.New("did: not found")

// ErrIdentityNotActive is returned when a resolved identity is not in Active status.
var ErrIdentityNotActive = errors.New("did: identity not active")

// RegistryClient defines the interface for looking up identities on-chain.
type RegistryClient interface {
	// GetIdentity retrieves an identity by its DID hash.
	GetIdentity(didHash [32]byte) (*registry.Identity, error)
}

// Resolver resolves did:zero DIDs into DID Documents by looking up
// on-chain identity data via a RegistryClient.
type Resolver struct {
	registry RegistryClient
}

// NewResolver creates a new DID resolver with the given registry client.
func NewResolver(client RegistryClient) *Resolver {
	return &Resolver{registry: client}
}

// ValidateDID validates a did:zero DID URI format.
// A valid DID has the form did:zero:0x<40 hex chars>.
func ValidateDID(did string) error {
	parts := strings.Split(did, ":")
	if len(parts) != 3 {
		return fmt.Errorf("%w: expected 3 parts, got %d", ErrInvalidDID, len(parts))
	}
	if parts[0] != "did" {
		return fmt.Errorf("%w: scheme must be 'did'", ErrInvalidDID)
	}
	if parts[1] != "zero" {
		return fmt.Errorf("%w: %s", ErrDIDMethodNotSupported, parts[1])
	}
	addr := parts[2]
	if !strings.HasPrefix(addr, "0x") {
		return fmt.Errorf("%w: address must start with 0x", ErrInvalidDID)
	}
	hexPart := addr[2:]
	if len(hexPart) != 40 {
		return fmt.Errorf("%w: address must be 40 hex characters, got %d", ErrInvalidDID, len(hexPart))
	}
	if _, err := hex.DecodeString(hexPart); err != nil {
		return fmt.Errorf("%w: invalid hex in address: %v", ErrInvalidDID, err)
	}
	return nil
}

// Resolve resolves a did:zero DID URI into a DID Document.
// It validates the DID format, computes the keccak256 hash,
// and looks up the identity in the on-chain registry.
func (r *Resolver) Resolve(did string) (*DIDDocument, error) {
	if err := ValidateDID(did); err != nil {
		return nil, err
	}

	didHash := crypto.ComputeDIDHash(did)

	identity, err := r.registry.GetIdentity(didHash)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrDIDNotFound, err)
	}

	status := IdentityStatus(identity.Status)

	doc := &DIDDocument{
		Context:    []string{"https://www.w3.org/ns/did/v1", "https://w3id.org/security/v2"},
		ID:         did,
		Controller: identity.Controller,
		VerificationMethod: []VerificationMethod{
			{
				ID:           did + "#key-1",
				Type:         "EcdsaSecp256k1VerificationKey2019",
				Controller:   did,
				PublicKeyHex: hex.EncodeToString(identity.PublicKey),
			},
		},
		Authentication:  []string{did + "#key-1"},
		AssertionMethod: []string{did + "#key-1"},
		Service:         []Service{},
		Status:          status,
	}

	return doc, nil
}
