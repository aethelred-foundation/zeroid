package did

import (
	"errors"
	"testing"

	"github.com/aethelred/zeroid-sdk-go/crypto"
	"github.com/aethelred/zeroid-sdk-go/registry"
)

type mockRegistryClient struct {
	identities map[[32]byte]*registry.Identity
}

func (m *mockRegistryClient) GetIdentity(didHash [32]byte) (*registry.Identity, error) {
	id, ok := m.identities[didHash]
	if !ok {
		return nil, errors.New("identity not found")
	}
	return id, nil
}

func newMockClient() *mockRegistryClient {
	return &mockRegistryClient{
		identities: make(map[[32]byte]*registry.Identity),
	}
}

func TestValidateDID(t *testing.T) {
	tests := []struct {
		name    string
		did     string
		wantErr bool
		errIs   error
	}{
		{
			name:    "valid DID",
			did:     "did:zero:0x1234567890abcdef1234567890abcdef12345678",
			wantErr: false,
		},
		{
			name:    "too few parts",
			did:     "did:zero",
			wantErr: true,
			errIs:   ErrInvalidDID,
		},
		{
			name:    "too many parts",
			did:     "did:zero:0x1234:extra",
			wantErr: true,
			errIs:   ErrInvalidDID,
		},
		{
			name:    "wrong scheme",
			did:     "foo:zero:0x1234567890abcdef1234567890abcdef12345678",
			wantErr: true,
			errIs:   ErrInvalidDID,
		},
		{
			name:    "wrong method",
			did:     "did:ethr:0x1234567890abcdef1234567890abcdef12345678",
			wantErr: true,
			errIs:   ErrDIDMethodNotSupported,
		},
		{
			name:    "missing 0x prefix",
			did:     "did:zero:1234567890abcdef1234567890abcdef12345678",
			wantErr: true,
			errIs:   ErrInvalidDID,
		},
		{
			name:    "short address",
			did:     "did:zero:0x1234",
			wantErr: true,
			errIs:   ErrInvalidDID,
		},
		{
			name:    "invalid hex",
			did:     "did:zero:0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
			wantErr: true,
			errIs:   ErrInvalidDID,
		},
		{
			name:    "uppercase hex is valid",
			did:     "did:zero:0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateDID(tt.did)
			if tt.wantErr {
				if err == nil {
					t.Error("ValidateDID() expected error, got nil")
				}
				if tt.errIs != nil && !errors.Is(err, tt.errIs) {
					t.Errorf("ValidateDID() error = %v, want %v", err, tt.errIs)
				}
			} else {
				if err != nil {
					t.Errorf("ValidateDID() unexpected error: %v", err)
				}
			}
		})
	}
}

func TestResolverResolve(t *testing.T) {
	validDID := "did:zero:0x1234567890abcdef1234567890abcdef12345678"

	tests := []struct {
		name       string
		did        string
		setup      func(*mockRegistryClient)
		wantErr    bool
		errIs      error
		wantStatus IdentityStatus
	}{
		{
			name: "successful resolve",
			did:  validDID,
			setup: func(m *mockRegistryClient) {
				hash := crypto.ComputeDIDHash(validDID)
				m.identities[hash] = &registry.Identity{
					DIDHash:    hash,
					Controller: validDID,
					PublicKey:  []byte{0x04, 0xab, 0xcd},
					Status:     uint8(StatusActive),
				}
			},
			wantErr:    false,
			wantStatus: StatusActive,
		},
		{
			name:    "invalid DID format",
			did:     "not-a-did",
			setup:   func(m *mockRegistryClient) {},
			wantErr: true,
			errIs:   ErrInvalidDID,
		},
		{
			name:    "identity not found",
			did:     validDID,
			setup:   func(m *mockRegistryClient) {},
			wantErr: true,
			errIs:   ErrDIDNotFound,
		},
		{
			name: "suspended identity still resolves",
			did:  validDID,
			setup: func(m *mockRegistryClient) {
				hash := crypto.ComputeDIDHash(validDID)
				m.identities[hash] = &registry.Identity{
					DIDHash:    hash,
					Controller: validDID,
					PublicKey:  []byte{0x04, 0xde, 0xad},
					Status:     uint8(StatusSuspended),
				}
			},
			wantErr:    false,
			wantStatus: StatusSuspended,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := newMockClient()
			tt.setup(client)
			resolver := NewResolver(client)

			doc, err := resolver.Resolve(tt.did)
			if tt.wantErr {
				if err == nil {
					t.Error("Resolve() expected error, got nil")
				}
				if tt.errIs != nil && !errors.Is(err, tt.errIs) {
					t.Errorf("Resolve() error = %v, want %v", err, tt.errIs)
				}
				return
			}
			if err != nil {
				t.Fatalf("Resolve() unexpected error: %v", err)
			}
			if doc.ID != tt.did {
				t.Errorf("doc.ID = %q, want %q", doc.ID, tt.did)
			}
			if doc.Status != tt.wantStatus {
				t.Errorf("doc.Status = %v, want %v", doc.Status, tt.wantStatus)
			}
			if len(doc.Context) != 2 {
				t.Errorf("Context length = %d, want 2", len(doc.Context))
			}
			if len(doc.VerificationMethod) != 1 {
				t.Errorf("VerificationMethod length = %d, want 1", len(doc.VerificationMethod))
			}
			if len(doc.Authentication) != 1 {
				t.Errorf("Authentication length = %d, want 1", len(doc.Authentication))
			}
			if len(doc.AssertionMethod) != 1 {
				t.Errorf("AssertionMethod length = %d, want 1", len(doc.AssertionMethod))
			}
		})
	}
}

func TestNewResolver(t *testing.T) {
	client := newMockClient()
	r := NewResolver(client)
	if r == nil {
		t.Fatal("NewResolver() returned nil")
	}
	if r.registry == nil {
		t.Error("resolver.registry should not be nil")
	}
}
