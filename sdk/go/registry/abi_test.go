package registry

import (
	"errors"
	"testing"
)

func TestPackUnpackIdentity(t *testing.T) {
	tests := []struct {
		name    string
		id      *Identity
		wantErr bool
	}{
		{
			name: "full identity",
			id: &Identity{
				DIDHash:    [32]byte{0x01, 0x02, 0x03},
				Controller: "did:zero:0x1234567890abcdef1234567890abcdef12345678",
				PublicKey:  []byte{0x04, 0xab, 0xcd, 0xef},
				Status:     1,
				CreatedAt:  1000000,
				UpdatedAt:  2000000,
			},
			wantErr: false,
		},
		{
			name: "empty controller and pubkey",
			id: &Identity{
				DIDHash:    [32]byte{},
				Controller: "",
				PublicKey:  []byte{},
				Status:     0,
				CreatedAt:  0,
				UpdatedAt:  0,
			},
			wantErr: false,
		},
		{
			name:    "nil identity",
			id:      nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := PackIdentity(tt.id)
			if tt.wantErr {
				if err == nil {
					t.Error("PackIdentity() expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("PackIdentity() error: %v", err)
			}

			got, err := UnpackIdentity(data)
			if err != nil {
				t.Fatalf("UnpackIdentity() error: %v", err)
			}

			if got.DIDHash != tt.id.DIDHash {
				t.Errorf("DIDHash mismatch")
			}
			if got.Controller != tt.id.Controller {
				t.Errorf("Controller = %q, want %q", got.Controller, tt.id.Controller)
			}
			if len(got.PublicKey) != len(tt.id.PublicKey) {
				t.Errorf("PublicKey length = %d, want %d", len(got.PublicKey), len(tt.id.PublicKey))
			}
			if got.Status != tt.id.Status {
				t.Errorf("Status = %d, want %d", got.Status, tt.id.Status)
			}
			if got.CreatedAt != tt.id.CreatedAt {
				t.Errorf("CreatedAt = %d, want %d", got.CreatedAt, tt.id.CreatedAt)
			}
			if got.UpdatedAt != tt.id.UpdatedAt {
				t.Errorf("UpdatedAt = %d, want %d", got.UpdatedAt, tt.id.UpdatedAt)
			}
		})
	}
}

func TestUnpackIdentityErrors(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{
			name: "too short",
			data: make([]byte, 10),
		},
		{
			name: "truncated at controller length",
			data: make([]byte, 49),
		},
		{
			name: "controller length exceeds data",
			data: func() []byte {
				// 53 bytes for fixed header, controller length at offset 49
				d := make([]byte, 53)
				// Set controller length = 255 at offset 49..52
				d[49] = 0
				d[50] = 0
				d[51] = 0
				d[52] = 255 // controller length = 255 but only 0 bytes remain after offset 53
				return d
			}(),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := UnpackIdentity(tt.data)
			if err == nil {
				t.Error("UnpackIdentity() expected error")
			}
			if !errors.Is(err, ErrInvalidABIData) {
				t.Errorf("error should wrap ErrInvalidABIData, got: %v", err)
			}
		})
	}
}

func TestPackUnpackCredential(t *testing.T) {
	tests := []struct {
		name    string
		cred    *Credential
		wantErr bool
	}{
		{
			name: "full credential",
			cred: &Credential{
				CredentialHash: [32]byte{0xaa, 0xbb},
				IssuerDID:      "did:zero:0x1111111111111111111111111111111111111111",
				SubjectDID:     "did:zero:0x2222222222222222222222222222222222222222",
				SchemaHash:     [32]byte{0xcc, 0xdd},
				Status:         1,
				IssuedAt:       1000000,
				ExpiresAt:      2000000,
			},
			wantErr: false,
		},
		{
			name: "empty strings",
			cred: &Credential{
				CredentialHash: [32]byte{},
				IssuerDID:      "",
				SubjectDID:     "",
				SchemaHash:     [32]byte{},
				Status:         0,
				IssuedAt:       0,
				ExpiresAt:      0,
			},
			wantErr: false,
		},
		{
			name:    "nil credential",
			cred:    nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := PackCredential(tt.cred)
			if tt.wantErr {
				if err == nil {
					t.Error("PackCredential() expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("PackCredential() error: %v", err)
			}

			got, err := UnpackCredential(data)
			if err != nil {
				t.Fatalf("UnpackCredential() error: %v", err)
			}

			if got.CredentialHash != tt.cred.CredentialHash {
				t.Error("CredentialHash mismatch")
			}
			if got.IssuerDID != tt.cred.IssuerDID {
				t.Errorf("IssuerDID = %q, want %q", got.IssuerDID, tt.cred.IssuerDID)
			}
			if got.SubjectDID != tt.cred.SubjectDID {
				t.Errorf("SubjectDID = %q, want %q", got.SubjectDID, tt.cred.SubjectDID)
			}
			if got.SchemaHash != tt.cred.SchemaHash {
				t.Error("SchemaHash mismatch")
			}
			if got.Status != tt.cred.Status {
				t.Errorf("Status = %d, want %d", got.Status, tt.cred.Status)
			}
			if got.IssuedAt != tt.cred.IssuedAt {
				t.Errorf("IssuedAt = %d, want %d", got.IssuedAt, tt.cred.IssuedAt)
			}
			if got.ExpiresAt != tt.cred.ExpiresAt {
				t.Errorf("ExpiresAt = %d, want %d", got.ExpiresAt, tt.cred.ExpiresAt)
			}
		})
	}
}

func TestUnpackCredentialErrors(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{
			name: "too short",
			data: make([]byte, 20),
		},
		{
			name: "truncated at issuer length",
			data: make([]byte, 81),
		},
		{
			name: "issuer length exceeds data",
			data: func() []byte {
				// 85 bytes minimum for fixed header, issuer length at offset 81
				d := make([]byte, 85)
				// Set issuer length = 255 at offset 81..84
				d[81] = 0
				d[82] = 0
				d[83] = 0
				d[84] = 255 // issuer length = 255 but only 0 bytes remain after offset 85
				return d
			}(),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := UnpackCredential(tt.data)
			if err == nil {
				t.Error("UnpackCredential() expected error")
			}
			if !errors.Is(err, ErrInvalidABIData) {
				t.Errorf("error should wrap ErrInvalidABIData, got: %v", err)
			}
		})
	}
}

func TestUnpackIdentityPubkeyEdgeCases(t *testing.T) {
	// Test where controller is present but pubkey length field is missing
	id := &Identity{
		DIDHash:    [32]byte{0x01},
		Controller: "ctrl",
		PublicKey:  []byte{},
		Status:     1,
		CreatedAt:  100,
		UpdatedAt:  200,
	}
	data, err := PackIdentity(id)
	if err != nil {
		t.Fatalf("PackIdentity() error: %v", err)
	}
	// Truncate to remove pubkey length
	truncated := data[:len(data)-4]
	_, err = UnpackIdentity(truncated)
	if err == nil {
		t.Error("expected error for truncated pubkey length")
	}
}

func TestUnpackCredentialSubjectEdgeCases(t *testing.T) {
	cred := &Credential{
		CredentialHash: [32]byte{0x01},
		IssuerDID:      "iss",
		SubjectDID:     "sub",
		SchemaHash:     [32]byte{0x02},
		Status:         1,
		IssuedAt:       100,
		ExpiresAt:      200,
	}
	data, err := PackCredential(cred)
	if err != nil {
		t.Fatalf("PackCredential() error: %v", err)
	}

	// Truncate to remove subject length field
	// Find where subject length starts: after issuer data
	// 32+32+1+8+8+4+3 = 88, then we need 4 more for subject len
	truncatedSubjectLen := data[:88]
	_, err = UnpackCredential(truncatedSubjectLen)
	if err == nil {
		t.Error("expected error for truncated subject length")
	}

	// Create data where subject length exceeds remaining data
	badData := make([]byte, 92)
	copy(badData, data[:88])
	badData[88] = 0
	badData[89] = 0
	badData[90] = 0
	badData[91] = 255 // subject length = 255, but no data remains
	_, err = UnpackCredential(badData)
	if err == nil {
		t.Error("expected error for subject length exceeding data")
	}
}

func TestUnpackIdentityPubkeyLengthExceeds(t *testing.T) {
	id := &Identity{
		DIDHash:    [32]byte{},
		Controller: "",
		PublicKey:  []byte{0x01},
		Status:     0,
		CreatedAt:  0,
		UpdatedAt:  0,
	}
	data, err := PackIdentity(id)
	if err != nil {
		t.Fatalf("PackIdentity() error: %v", err)
	}
	// Overwrite pubkey length to be larger than remaining data
	// pubkey length is at offset 32+1+8+8+4+0+4 = 57, wait:
	// 32 (hash) + 1 (status) + 8 (created) + 8 (updated) + 4 (ctrl len=0) + 0 (ctrl) = 53
	// Then pubkey len at 53..56, pubkey at 57
	data[53] = 0
	data[54] = 0
	data[55] = 0
	data[56] = 255
	_, err = UnpackIdentity(data)
	if err == nil {
		t.Error("expected error for pubkey length exceeding data")
	}
}
