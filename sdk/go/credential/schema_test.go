package credential

import (
	"errors"
	"testing"
)

func TestNewSchemaValidator(t *testing.T) {
	sv := NewSchemaValidator()
	if sv == nil {
		t.Fatal("NewSchemaValidator() returned nil")
	}
}

func TestSchemaValidatorValidate(t *testing.T) {
	tests := []struct {
		name    string
		cred    *VerifiableCredential
		schema  *CredentialSchema
		wantErr error
	}{
		{
			name: "valid credential with all required attributes",
			cred: &VerifiableCredential{
				CredentialSubject: CredentialSubject{
					ID: "did:zero:0x0001",
					Attributes: map[string]interface{}{
						"name":    "Alice",
						"country": "US",
					},
				},
			},
			schema: &CredentialSchema{
				ID:                 "schema-1",
				RequiredAttributes: []string{"name", "country"},
			},
			wantErr: nil,
		},
		{
			name: "valid credential with extra attributes",
			cred: &VerifiableCredential{
				CredentialSubject: CredentialSubject{
					ID: "did:zero:0x0001",
					Attributes: map[string]interface{}{
						"name":    "Alice",
						"country": "US",
						"age":     float64(30),
					},
				},
			},
			schema: &CredentialSchema{
				ID:                 "schema-1",
				RequiredAttributes: []string{"name"},
				OptionalAttributes: []string{"age"},
			},
			wantErr: nil,
		},
		{
			name: "missing required attribute",
			cred: &VerifiableCredential{
				CredentialSubject: CredentialSubject{
					ID: "did:zero:0x0001",
					Attributes: map[string]interface{}{
						"name": "Alice",
					},
				},
			},
			schema: &CredentialSchema{
				ID:                 "schema-1",
				RequiredAttributes: []string{"name", "country"},
			},
			wantErr: ErrMissingAttribute,
		},
		{
			name: "nil attributes with required fields",
			cred: &VerifiableCredential{
				CredentialSubject: CredentialSubject{
					ID: "did:zero:0x0001",
				},
			},
			schema: &CredentialSchema{
				ID:                 "schema-1",
				RequiredAttributes: []string{"name"},
			},
			wantErr: ErrMissingAttribute,
		},
		{
			name:   "nil credential",
			cred:   nil,
			schema: &CredentialSchema{ID: "schema-1"},
			wantErr: ErrSchemaValidation,
		},
		{
			name: "nil schema",
			cred: &VerifiableCredential{
				CredentialSubject: CredentialSubject{ID: "did:zero:0x0001"},
			},
			schema:  nil,
			wantErr: ErrSchemaValidation,
		},
		{
			name: "no required attributes",
			cred: &VerifiableCredential{
				CredentialSubject: CredentialSubject{
					ID: "did:zero:0x0001",
				},
			},
			schema: &CredentialSchema{
				ID:                 "schema-1",
				RequiredAttributes: []string{},
			},
			wantErr: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sv := NewSchemaValidator()
			err := sv.Validate(tt.cred, tt.schema)
			if tt.wantErr == nil {
				if err != nil {
					t.Errorf("Validate() unexpected error: %v", err)
				}
				return
			}
			if err == nil {
				t.Error("Validate() expected error, got nil")
				return
			}
			if !errors.Is(err, tt.wantErr) {
				t.Errorf("Validate() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestCredentialSchemaFields(t *testing.T) {
	schema := CredentialSchema{
		ID:                 "https://schema.zeroid.io/kyc/v1",
		Type:               "JsonSchema2023",
		Name:               "KYC Credential",
		Version:            "1.0.0",
		RequiredAttributes: []string{"name", "dob", "country"},
		OptionalAttributes: []string{"address", "phone"},
	}

	if schema.ID != "https://schema.zeroid.io/kyc/v1" {
		t.Errorf("ID = %q", schema.ID)
	}
	if schema.Type != "JsonSchema2023" {
		t.Errorf("Type = %q", schema.Type)
	}
	if schema.Name != "KYC Credential" {
		t.Errorf("Name = %q", schema.Name)
	}
	if schema.Version != "1.0.0" {
		t.Errorf("Version = %q", schema.Version)
	}
	if len(schema.RequiredAttributes) != 3 {
		t.Errorf("RequiredAttributes length = %d", len(schema.RequiredAttributes))
	}
	if len(schema.OptionalAttributes) != 2 {
		t.Errorf("OptionalAttributes length = %d", len(schema.OptionalAttributes))
	}
}
