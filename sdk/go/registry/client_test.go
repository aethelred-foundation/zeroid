package registry

import (
	"errors"
	"testing"
)

func TestNewMockClient(t *testing.T) {
	c := NewMockClient()
	if c == nil {
		t.Fatal("NewMockClient() returned nil")
	}
	if c.Identities == nil {
		t.Error("Identities map should be initialized")
	}
	if c.Credentials == nil {
		t.Error("Credentials map should be initialized")
	}
	if c.ApprovedIssuers == nil {
		t.Error("ApprovedIssuers map should be initialized")
	}
}

func TestMockClientGetIdentity(t *testing.T) {
	c := NewMockClient()
	hash := [32]byte{0x01, 0x02}
	id := &Identity{
		DIDHash:    hash,
		Controller: "did:zero:0x0001",
		Status:     1,
	}
	c.Identities[hash] = id

	tests := []struct {
		name    string
		hash    [32]byte
		wantErr bool
	}{
		{
			name:    "found",
			hash:    hash,
			wantErr: false,
		},
		{
			name:    "not found",
			hash:    [32]byte{0xff},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := c.GetIdentity(tt.hash)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error")
				}
				if !errors.Is(err, ErrNotFound) {
					t.Errorf("error should wrap ErrNotFound, got: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Controller != id.Controller {
				t.Errorf("Controller = %q, want %q", got.Controller, id.Controller)
			}
		})
	}
}

func TestMockClientGetCredential(t *testing.T) {
	c := NewMockClient()
	hash := [32]byte{0xaa, 0xbb}
	cred := &Credential{
		CredentialHash: hash,
		IssuerDID:      "did:zero:0x0001",
		Status:         1,
	}
	c.Credentials[hash] = cred

	tests := []struct {
		name    string
		hash    [32]byte
		wantErr bool
	}{
		{
			name:    "found",
			hash:    hash,
			wantErr: false,
		},
		{
			name:    "not found",
			hash:    [32]byte{0xff},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := c.GetCredential(tt.hash)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error")
				}
				if !errors.Is(err, ErrNotFound) {
					t.Errorf("error should wrap ErrNotFound, got: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.IssuerDID != cred.IssuerDID {
				t.Errorf("IssuerDID = %q, want %q", got.IssuerDID, cred.IssuerDID)
			}
		})
	}
}

func TestMockClientIsApprovedIssuer(t *testing.T) {
	c := NewMockClient()
	c.ApprovedIssuers["did:zero:0x0001"] = true
	c.ApprovedIssuers["did:zero:0x0002"] = false

	tests := []struct {
		name string
		did  string
		want bool
	}{
		{
			name: "approved",
			did:  "did:zero:0x0001",
			want: true,
		},
		{
			name: "explicitly not approved",
			did:  "did:zero:0x0002",
			want: false,
		},
		{
			name: "unknown issuer",
			did:  "did:zero:0x9999",
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := c.IsApprovedIssuer(tt.did)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("IsApprovedIssuer(%q) = %v, want %v", tt.did, got, tt.want)
			}
		})
	}
}

// Verify MockClient implements Client interface.
var _ Client = (*MockClient)(nil)
