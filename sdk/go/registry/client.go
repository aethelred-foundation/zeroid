package registry

import (
	"errors"
	"fmt"
)

// ErrNotFound is returned when a requested record is not found in the registry.
var ErrNotFound = errors.New("registry: not found")

// Client defines the interface for interacting with the ZeroID on-chain registry.
type Client interface {
	// GetIdentity retrieves an identity by its DID hash.
	GetIdentity(didHash [32]byte) (*Identity, error)
	// GetCredential retrieves a credential by its hash.
	GetCredential(credHash [32]byte) (*Credential, error)
	// IsApprovedIssuer checks whether a DID is an approved credential issuer.
	IsApprovedIssuer(did string) (bool, error)
}

// MockClient is an in-memory implementation of Client for testing.
type MockClient struct {
	// Identities maps DID hashes to identities.
	Identities map[[32]byte]*Identity
	// Credentials maps credential hashes to credentials.
	Credentials map[[32]byte]*Credential
	// ApprovedIssuers maps DIDs to their approval status.
	ApprovedIssuers map[string]bool
}

// NewMockClient creates a new MockClient with initialized maps.
func NewMockClient() *MockClient {
	return &MockClient{
		Identities:      make(map[[32]byte]*Identity),
		Credentials:     make(map[[32]byte]*Credential),
		ApprovedIssuers: make(map[string]bool),
	}
}

// GetIdentity retrieves an identity by its DID hash from the mock store.
func (m *MockClient) GetIdentity(didHash [32]byte) (*Identity, error) {
	id, ok := m.Identities[didHash]
	if !ok {
		return nil, fmt.Errorf("%w: identity %x", ErrNotFound, didHash[:8])
	}
	return id, nil
}

// GetCredential retrieves a credential by its hash from the mock store.
func (m *MockClient) GetCredential(credHash [32]byte) (*Credential, error) {
	cred, ok := m.Credentials[credHash]
	if !ok {
		return nil, fmt.Errorf("%w: credential %x", ErrNotFound, credHash[:8])
	}
	return cred, nil
}

// IsApprovedIssuer checks whether a DID is an approved credential issuer in the mock store.
func (m *MockClient) IsApprovedIssuer(did string) (bool, error) {
	approved, ok := m.ApprovedIssuers[did]
	if !ok {
		return false, nil
	}
	return approved, nil
}
