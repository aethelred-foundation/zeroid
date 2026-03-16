package credential

import (
	"encoding/json"
	"testing"
	"time"
)

func TestCredentialStatusString(t *testing.T) {
	tests := []struct {
		status CredentialStatus
		want   string
	}{
		{StatusNone, "None"},
		{StatusActive, "Active"},
		{StatusSuspended, "Suspended"},
		{StatusRevoked, "Revoked"},
		{StatusExpired, "Expired"},
		{CredentialStatus(99), "Unknown(99)"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := tt.status.String(); got != tt.want {
				t.Errorf("CredentialStatus(%d).String() = %q, want %q", int(tt.status), got, tt.want)
			}
		})
	}
}

func TestVerifiableCredentialJSON(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	exp := now.Add(24 * time.Hour)

	cred := VerifiableCredential{
		Context:        []string{"https://www.w3.org/2018/credentials/v1"},
		ID:             "urn:uuid:test-credential-1",
		Type:           []string{"VerifiableCredential", "IdentityCredential"},
		Issuer:         "did:zero:0x1111111111111111111111111111111111111111",
		IssuanceDate:   now,
		ExpirationDate: exp,
		CredentialSubject: CredentialSubject{
			ID: "did:zero:0x2222222222222222222222222222222222222222",
			Attributes: map[string]interface{}{
				"name":     "Alice",
				"verified": true,
			},
		},
		Proof: &Proof{
			Type:               "BbsBlsSignature2020",
			Created:            now,
			VerificationMethod: "did:zero:0x1111#key-1",
			ProofPurpose:       "assertionMethod",
			ProofValue:         "z3abc123",
		},
		Status:   StatusActive,
		SchemaID: "https://schema.zeroid.io/identity/v1",
	}

	data, err := json.Marshal(cred)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}

	var decoded VerifiableCredential
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}

	if decoded.ID != cred.ID {
		t.Errorf("ID = %q, want %q", decoded.ID, cred.ID)
	}
	if decoded.Issuer != cred.Issuer {
		t.Errorf("Issuer = %q, want %q", decoded.Issuer, cred.Issuer)
	}
	if decoded.CredentialSubject.ID != cred.CredentialSubject.ID {
		t.Errorf("Subject ID = %q, want %q", decoded.CredentialSubject.ID, cred.CredentialSubject.ID)
	}
	if decoded.Proof == nil {
		t.Fatal("Proof should not be nil")
	}
	if decoded.Proof.Type != "BbsBlsSignature2020" {
		t.Errorf("Proof.Type = %q, want %q", decoded.Proof.Type, "BbsBlsSignature2020")
	}
	if decoded.SchemaID != cred.SchemaID {
		t.Errorf("SchemaID = %q, want %q", decoded.SchemaID, cred.SchemaID)
	}
	if len(decoded.Type) != 2 {
		t.Errorf("Type length = %d, want 2", len(decoded.Type))
	}
}

func TestVerifiableCredentialJSONMinimal(t *testing.T) {
	cred := VerifiableCredential{
		Context: []string{"https://www.w3.org/2018/credentials/v1"},
		ID:      "urn:uuid:minimal",
		Type:    []string{"VerifiableCredential"},
		Issuer:  "did:zero:0x0001000000000000000000000000000000000001",
		CredentialSubject: CredentialSubject{
			ID: "did:zero:0x0002000000000000000000000000000000000002",
		},
		Status: StatusNone,
	}

	data, err := json.Marshal(cred)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}

	var decoded VerifiableCredential
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}

	if decoded.Proof != nil {
		t.Error("Proof should be nil for minimal credential")
	}
	if decoded.CredentialSubject.Attributes != nil {
		t.Error("Attributes should be nil for minimal credential")
	}
}

func TestVerifiablePresentationJSON(t *testing.T) {
	now := time.Now().Truncate(time.Second)

	vp := VerifiablePresentation{
		Context: []string{"https://www.w3.org/2018/credentials/v1"},
		ID:      "urn:uuid:presentation-1",
		Type:    []string{"VerifiablePresentation"},
		Holder:  "did:zero:0x3333333333333333333333333333333333333333",
		VerifiableCredential: []VerifiableCredential{
			{
				Context: []string{"https://www.w3.org/2018/credentials/v1"},
				ID:      "urn:uuid:cred-1",
				Type:    []string{"VerifiableCredential"},
				Issuer:  "did:zero:0x1111111111111111111111111111111111111111",
				CredentialSubject: CredentialSubject{
					ID: "did:zero:0x3333333333333333333333333333333333333333",
				},
				Status: StatusActive,
			},
		},
		Proof: &Proof{
			Type:               "BbsBlsSignatureProof2020",
			Created:            now,
			VerificationMethod: "did:zero:0x3333#key-1",
			ProofPurpose:       "authentication",
			ProofValue:         "z3proof",
		},
	}

	data, err := json.Marshal(vp)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}

	var decoded VerifiablePresentation
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}

	if decoded.Holder != vp.Holder {
		t.Errorf("Holder = %q, want %q", decoded.Holder, vp.Holder)
	}
	if len(decoded.VerifiableCredential) != 1 {
		t.Fatalf("VerifiableCredential length = %d, want 1", len(decoded.VerifiableCredential))
	}
	if decoded.Proof == nil {
		t.Error("Proof should not be nil")
	}
}

func TestCredentialSubjectJSON(t *testing.T) {
	cs := CredentialSubject{
		ID: "did:zero:0xaaaa",
		Attributes: map[string]interface{}{
			"age":      float64(25),
			"verified": true,
		},
	}

	data, err := json.Marshal(cs)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}

	var decoded CredentialSubject
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}

	if decoded.ID != cs.ID {
		t.Errorf("ID = %q, want %q", decoded.ID, cs.ID)
	}
	if len(decoded.Attributes) != 2 {
		t.Errorf("Attributes length = %d, want 2", len(decoded.Attributes))
	}
}

func TestProofJSON(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	p := Proof{
		Type:               "BbsBlsSignature2020",
		Created:            now,
		VerificationMethod: "did:zero:0xabc#key-1",
		ProofPurpose:       "assertionMethod",
		ProofValue:         "z3signature",
	}

	data, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}

	var decoded Proof
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}

	if decoded.Type != p.Type {
		t.Errorf("Type = %q, want %q", decoded.Type, p.Type)
	}
	if decoded.ProofValue != p.ProofValue {
		t.Errorf("ProofValue = %q, want %q", decoded.ProofValue, p.ProofValue)
	}
	if decoded.ProofPurpose != p.ProofPurpose {
		t.Errorf("ProofPurpose = %q, want %q", decoded.ProofPurpose, p.ProofPurpose)
	}
}
