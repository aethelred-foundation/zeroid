package credential

import (
	"errors"
	"strings"
	"testing"
	"time"
)

const (
	testIssuerDID = "did:zero:0x1111111111111111111111111111111111111111"
	testIssuerKey = "issuer-signing-key"
)

type mockSchemaRegistry struct {
	schemas map[string]*CredentialSchema
}

func (m *mockSchemaRegistry) GetSchema(schemaID string) (*CredentialSchema, error) {
	s, ok := m.schemas[schemaID]
	if !ok {
		return nil, ErrSchemaNotFound
	}
	return s, nil
}

type errorSchemaRegistry struct{}

func (e *errorSchemaRegistry) GetSchema(schemaID string) (*CredentialSchema, error) {
	return nil, errors.New("registry unavailable")
}

type mockIssuerRegistry struct {
	approved map[string]bool
}

func (m *mockIssuerRegistry) IsApprovedIssuer(did string) (bool, error) {
	a, ok := m.approved[did]
	if !ok {
		return false, nil
	}
	return a, nil
}

type errorIssuerRegistry struct{}

func (e *errorIssuerRegistry) IsApprovedIssuer(did string) (bool, error) {
	return false, errors.New("registry unavailable")
}

func newTestVerifier() (*Verifier, *mockSchemaRegistry, *mockIssuerRegistry) {
	schemas := &mockSchemaRegistry{schemas: make(map[string]*CredentialSchema)}
	issuers := &mockIssuerRegistry{approved: make(map[string]bool)}
	v := NewVerifierWithTrustedIssuerKeys(schemas, issuers, map[string]string{
		testIssuerDID: testIssuerKey,
	})
	return v, schemas, issuers
}

func fixedTime(t time.Time) func() time.Time {
	return func() time.Time { return t }
}

func validCred() *VerifiableCredential {
	cred := &VerifiableCredential{
		Context:      []string{"https://www.w3.org/2018/credentials/v1"},
		ID:           "urn:uuid:test-1",
		Type:         []string{"VerifiableCredential"},
		Issuer:       testIssuerDID,
		IssuanceDate: time.Now().Add(-time.Hour),
		Status:       StatusActive,
		Proof: &Proof{
			Type:               "ZeroIDCredentialProof2026",
			Created:            time.Now(),
			VerificationMethod: testIssuerDID + "#key-1",
			ProofPurpose:       "assertionMethod",
		},
		CredentialSubject: CredentialSubject{
			ID: "did:zero:0x2222222222222222222222222222222222222222",
		},
	}
	signCredential(cred, testIssuerKey)
	return cred
}

func signCredential(cred *VerifiableCredential, key string) {
	root, err := ComputeCredentialSubjectMerkleRoot(cred.CredentialSubject)
	if err != nil {
		panic(err)
	}
	payload, err := BuildCredentialProofPayload(cred, root)
	if err != nil {
		panic(err)
	}
	cred.Proof.MerkleRoot = root
	cred.Proof.ProofValue = ComputeCredentialProofValue(key, payload)
}

func TestNewVerifier(t *testing.T) {
	v, _, _ := newTestVerifier()
	if v == nil {
		t.Fatal("NewVerifier() returned nil")
	}
}

func TestVerifierVerify(t *testing.T) {
	now := time.Date(2025, 6, 1, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name       string
		cred       *VerifiableCredential
		setupFunc  func(*mockSchemaRegistry, *mockIssuerRegistry)
		timeFunc   func() time.Time
		wantValid  bool
		wantChecks map[string]bool
		wantErr    bool
	}{
		{
			name: "fully valid credential",
			cred: validCred(),
			setupFunc: func(s *mockSchemaRegistry, i *mockIssuerRegistry) {
				i.approved[testIssuerDID] = true
			},
			timeFunc:  fixedTime(now),
			wantValid: true,
			wantChecks: map[string]bool{
				"status": true, "expiry": true, "proof": true, "issuer": true, "schema": true,
			},
		},
		{
			name: "revoked credential",
			cred: func() *VerifiableCredential {
				c := validCred()
				c.Status = StatusRevoked
				return c
			}(),
			setupFunc: func(s *mockSchemaRegistry, i *mockIssuerRegistry) {
				i.approved[testIssuerDID] = true
			},
			timeFunc:  fixedTime(now),
			wantValid: false,
			wantChecks: map[string]bool{
				"status": false, "expiry": true, "proof": true, "issuer": true, "schema": true,
			},
		},
		{
			name: "suspended credential",
			cred: func() *VerifiableCredential {
				c := validCred()
				c.Status = StatusSuspended
				return c
			}(),
			setupFunc: func(s *mockSchemaRegistry, i *mockIssuerRegistry) {
				i.approved[testIssuerDID] = true
			},
			timeFunc:  fixedTime(now),
			wantValid: false,
			wantChecks: map[string]bool{
				"status": false,
			},
		},
		{
			name: "expired status credential",
			cred: func() *VerifiableCredential {
				c := validCred()
				c.Status = StatusExpired
				return c
			}(),
			setupFunc: func(s *mockSchemaRegistry, i *mockIssuerRegistry) {
				i.approved[testIssuerDID] = true
			},
			timeFunc:  fixedTime(now),
			wantValid: false,
			wantChecks: map[string]bool{
				"status": false,
			},
		},
		{
			name: "inactive credential (StatusNone)",
			cred: func() *VerifiableCredential {
				c := validCred()
				c.Status = StatusNone
				return c
			}(),
			setupFunc: func(s *mockSchemaRegistry, i *mockIssuerRegistry) {
				i.approved[testIssuerDID] = true
			},
			timeFunc:  fixedTime(now),
			wantValid: false,
			wantChecks: map[string]bool{
				"status": false,
			},
		},
		{
			name: "expired by date",
			cred: func() *VerifiableCredential {
				c := validCred()
				c.ExpirationDate = now.Add(-24 * time.Hour)
				signCredential(c, testIssuerKey)
				return c
			}(),
			setupFunc: func(s *mockSchemaRegistry, i *mockIssuerRegistry) {
				i.approved[testIssuerDID] = true
			},
			timeFunc:  fixedTime(now),
			wantValid: false,
			wantChecks: map[string]bool{
				"expiry": false,
			},
		},
		{
			name: "not expired with future date",
			cred: func() *VerifiableCredential {
				c := validCred()
				c.ExpirationDate = now.Add(24 * time.Hour)
				signCredential(c, testIssuerKey)
				return c
			}(),
			setupFunc: func(s *mockSchemaRegistry, i *mockIssuerRegistry) {
				i.approved[testIssuerDID] = true
			},
			timeFunc:  fixedTime(now),
			wantValid: true,
			wantChecks: map[string]bool{
				"expiry": true,
			},
		},
		{
			name: "no proof",
			cred: func() *VerifiableCredential {
				c := validCred()
				c.Proof = nil
				return c
			}(),
			setupFunc: func(s *mockSchemaRegistry, i *mockIssuerRegistry) {
				i.approved[testIssuerDID] = true
			},
			timeFunc:  fixedTime(now),
			wantValid: false,
			wantChecks: map[string]bool{
				"proof": false,
			},
		},
		{
			name: "unapproved issuer",
			cred: validCred(),
			setupFunc: func(s *mockSchemaRegistry, i *mockIssuerRegistry) {
				// issuer not in approved map
			},
			timeFunc:  fixedTime(now),
			wantValid: false,
			wantChecks: map[string]bool{
				"issuer": false,
			},
		},
		{
			name: "schema not found",
			cred: func() *VerifiableCredential {
				c := validCred()
				c.SchemaID = "unknown-schema"
				signCredential(c, testIssuerKey)
				return c
			}(),
			setupFunc: func(s *mockSchemaRegistry, i *mockIssuerRegistry) {
				i.approved[testIssuerDID] = true
			},
			timeFunc:  fixedTime(now),
			wantValid: false,
			wantChecks: map[string]bool{
				"schema": false,
			},
		},
		{
			name: "schema validation fails",
			cred: func() *VerifiableCredential {
				c := validCred()
				c.SchemaID = "kyc-schema"
				signCredential(c, testIssuerKey)
				return c
			}(),
			setupFunc: func(s *mockSchemaRegistry, i *mockIssuerRegistry) {
				i.approved[testIssuerDID] = true
				s.schemas["kyc-schema"] = &CredentialSchema{
					ID:                 "kyc-schema",
					RequiredAttributes: []string{"name", "country"},
				}
			},
			timeFunc:  fixedTime(now),
			wantValid: false,
			wantChecks: map[string]bool{
				"schema": false,
			},
		},
		{
			name: "schema validation passes",
			cred: func() *VerifiableCredential {
				c := validCred()
				c.SchemaID = "kyc-schema"
				c.CredentialSubject.Attributes = map[string]interface{}{
					"name":    "Alice",
					"country": "US",
				}
				signCredential(c, testIssuerKey)
				return c
			}(),
			setupFunc: func(s *mockSchemaRegistry, i *mockIssuerRegistry) {
				i.approved[testIssuerDID] = true
				s.schemas["kyc-schema"] = &CredentialSchema{
					ID:                 "kyc-schema",
					RequiredAttributes: []string{"name", "country"},
				}
			},
			timeFunc:  fixedTime(now),
			wantValid: true,
			wantChecks: map[string]bool{
				"schema": true,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v, schemas, issuers := newTestVerifier()
			tt.setupFunc(schemas, issuers)
			v.SetTimeFunc(tt.timeFunc)

			result, err := v.Verify(tt.cred)
			if tt.wantErr {
				if err == nil {
					t.Error("Verify() expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("Verify() unexpected error: %v", err)
			}

			if result.Valid != tt.wantValid {
				t.Errorf("Valid = %v, want %v, errors: %v", result.Valid, tt.wantValid, result.Errors)
			}

			for check, want := range tt.wantChecks {
				got, ok := result.Checks[check]
				if !ok {
					t.Errorf("check %q not found in results", check)
					continue
				}
				if got != want {
					t.Errorf("check %q = %v, want %v", check, got, want)
				}
			}
		})
	}
}

func TestVerifierRejectsCredentialWithoutTrustedIssuerKey(t *testing.T) {
	schemas := &mockSchemaRegistry{schemas: make(map[string]*CredentialSchema)}
	issuers := &mockIssuerRegistry{approved: map[string]bool{testIssuerDID: true}}
	v := NewVerifier(schemas, issuers)

	result, err := v.Verify(validCred())
	if err != nil {
		t.Fatalf("Verify() unexpected error: %v", err)
	}
	if result.Valid {
		t.Fatal("credential without trusted issuer key should be invalid")
	}
	if result.Checks["proof"] {
		t.Fatal("proof check should fail without a trusted issuer key")
	}
	if !errorsContain(result.Errors, "issuer proof key not trusted") {
		t.Fatalf("expected untrusted key error, got %v", result.Errors)
	}
}

func TestVerifierRejectsTamperedCredentialSubject(t *testing.T) {
	v, _, issuers := newTestVerifier()
	issuers.approved[testIssuerDID] = true

	cred := validCred()
	cred.CredentialSubject.ID = "did:zero:0x3333333333333333333333333333333333333333"

	result, err := v.Verify(cred)
	if err != nil {
		t.Fatalf("Verify() unexpected error: %v", err)
	}
	if result.Valid || result.Checks["proof"] {
		t.Fatalf("tampered subject should fail proof verification: %+v", result)
	}
	if !errorsContain(result.Errors, "subject does not match proof root") {
		t.Fatalf("expected subject root error, got %v", result.Errors)
	}
}

func TestVerifierRejectsTamperedProofValue(t *testing.T) {
	v, _, issuers := newTestVerifier()
	issuers.approved[testIssuerDID] = true

	cred := validCred()
	cred.Proof.ProofValue = "00" + cred.Proof.ProofValue[2:]

	result, err := v.Verify(cred)
	if err != nil {
		t.Fatalf("Verify() unexpected error: %v", err)
	}
	if result.Valid || result.Checks["proof"] {
		t.Fatalf("tampered proof value should fail verification: %+v", result)
	}
	if !errorsContain(result.Errors, "proof signature is invalid") {
		t.Fatalf("expected signature error, got %v", result.Errors)
	}
}

func TestVerifierRejectsRelabelledIssuer(t *testing.T) {
	v, _, issuers := newTestVerifier()
	issuers.approved["did:zero:evil"] = true

	cred := validCred()
	cred.Issuer = "did:zero:evil"

	result, err := v.Verify(cred)
	if err != nil {
		t.Fatalf("Verify() unexpected error: %v", err)
	}
	if result.Valid || result.Checks["proof"] {
		t.Fatalf("relabelled issuer should fail proof verification: %+v", result)
	}
	if !errorsContain(result.Errors, "verification method is not controlled by issuer") {
		t.Fatalf("expected verification method error, got %v", result.Errors)
	}
}

func errorsContain(errors []string, substr string) bool {
	for _, err := range errors {
		if strings.Contains(err, substr) {
			return true
		}
	}
	return false
}

func TestVerifierVerifyNilCredential(t *testing.T) {
	v, _, _ := newTestVerifier()
	_, err := v.Verify(nil)
	if err == nil {
		t.Error("Verify(nil) expected error")
	}
}

func TestVerifierVerifyIssuerRegistryError(t *testing.T) {
	schemas := &mockSchemaRegistry{schemas: make(map[string]*CredentialSchema)}
	issuers := &errorIssuerRegistry{}
	v := NewVerifierWithTrustedIssuerKeys(schemas, issuers, map[string]string{
		testIssuerDID: testIssuerKey,
	})

	cred := validCred()
	_, err := v.Verify(cred)
	if err == nil {
		t.Error("Verify() expected error when issuer registry fails")
	}
}

func TestVerifierVerifySchemaRegistryError(t *testing.T) {
	schemas := &errorSchemaRegistry{}
	issuers := &mockIssuerRegistry{approved: map[string]bool{
		testIssuerDID: true,
	}}
	v := NewVerifierWithTrustedIssuerKeys(schemas, issuers, map[string]string{
		testIssuerDID: testIssuerKey,
	})

	cred := validCred()
	cred.SchemaID = "some-schema"
	signCredential(cred, testIssuerKey)
	_, err := v.Verify(cred)
	if err == nil {
		t.Error("Verify() expected error when schema registry fails")
	}
}

func TestVerifierSetTimeFunc(t *testing.T) {
	v, _, _ := newTestVerifier()
	fixed := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	v.SetTimeFunc(fixedTime(fixed))
	if got := v.now(); !got.Equal(fixed) {
		t.Errorf("time func not set correctly, got %v", got)
	}
}
