package did

import (
	"encoding/json"
	"testing"
)

func TestIdentityStatusString(t *testing.T) {
	tests := []struct {
		status IdentityStatus
		want   string
	}{
		{StatusInactive, "Inactive"},
		{StatusActive, "Active"},
		{StatusSuspended, "Suspended"},
		{StatusRevoked, "Revoked"},
		{IdentityStatus(99), "Unknown(99)"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := tt.status.String(); got != tt.want {
				t.Errorf("IdentityStatus(%d).String() = %q, want %q", int(tt.status), got, tt.want)
			}
		})
	}
}

func TestDIDDocumentJSON(t *testing.T) {
	doc := DIDDocument{
		Context:    []string{"https://www.w3.org/ns/did/v1"},
		ID:         "did:zero:0xabc123",
		Controller: "did:zero:0xabc123",
		VerificationMethod: []VerificationMethod{
			{
				ID:           "did:zero:0xabc123#key-1",
				Type:         "EcdsaSecp256k1VerificationKey2019",
				Controller:   "did:zero:0xabc123",
				PublicKeyHex: "04abcdef",
			},
		},
		Authentication:  []string{"did:zero:0xabc123#key-1"},
		AssertionMethod: []string{"did:zero:0xabc123#key-1"},
		Service: []Service{
			{
				ID:              "did:zero:0xabc123#credential-registry",
				Type:            "CredentialRegistry",
				ServiceEndpoint: "https://registry.zeroid.io",
			},
		},
		Status: StatusActive,
	}

	data, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}

	var decoded DIDDocument
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}

	if decoded.ID != doc.ID {
		t.Errorf("ID = %q, want %q", decoded.ID, doc.ID)
	}
	if decoded.Controller != doc.Controller {
		t.Errorf("Controller = %q, want %q", decoded.Controller, doc.Controller)
	}
	if len(decoded.VerificationMethod) != 1 {
		t.Fatalf("VerificationMethod length = %d, want 1", len(decoded.VerificationMethod))
	}
	if decoded.VerificationMethod[0].PublicKeyHex != "04abcdef" {
		t.Errorf("PublicKeyHex = %q, want %q", decoded.VerificationMethod[0].PublicKeyHex, "04abcdef")
	}
	if len(decoded.Service) != 1 {
		t.Fatalf("Service length = %d, want 1", len(decoded.Service))
	}
	if decoded.Service[0].ServiceEndpoint != "https://registry.zeroid.io" {
		t.Errorf("ServiceEndpoint = %q, want %q", decoded.Service[0].ServiceEndpoint, "https://registry.zeroid.io")
	}
	if decoded.Status != StatusActive {
		t.Errorf("Status = %v, want %v", decoded.Status, StatusActive)
	}
	if len(decoded.Authentication) != 1 {
		t.Errorf("Authentication length = %d, want 1", len(decoded.Authentication))
	}
	if len(decoded.AssertionMethod) != 1 {
		t.Errorf("AssertionMethod length = %d, want 1", len(decoded.AssertionMethod))
	}
}

func TestDIDDocumentJSONMinimal(t *testing.T) {
	doc := DIDDocument{
		Context: []string{"https://www.w3.org/ns/did/v1"},
		ID:      "did:zero:0x0001",
		Status:  StatusInactive,
	}

	data, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}

	var decoded DIDDocument
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}

	if decoded.Controller != "" {
		t.Errorf("Controller should be empty, got %q", decoded.Controller)
	}
	if len(decoded.VerificationMethod) != 0 {
		t.Errorf("VerificationMethod should be empty")
	}
	if len(decoded.Service) != 0 {
		t.Errorf("Service should be empty")
	}
}

func TestVerificationMethodJSON(t *testing.T) {
	vm := VerificationMethod{
		ID:                 "did:zero:0xabc#key-1",
		Type:               "Bls12381G2Key2020",
		Controller:         "did:zero:0xabc",
		PublicKeyMultibase: "zUC7abc123",
	}

	data, err := json.Marshal(vm)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}

	var decoded VerificationMethod
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}

	if decoded.PublicKeyMultibase != "zUC7abc123" {
		t.Errorf("PublicKeyMultibase = %q, want %q", decoded.PublicKeyMultibase, "zUC7abc123")
	}
	if decoded.PublicKeyHex != "" {
		t.Errorf("PublicKeyHex should be empty when not set, got %q", decoded.PublicKeyHex)
	}
}

func TestServiceJSON(t *testing.T) {
	svc := Service{
		ID:              "did:zero:0x1#svc-1",
		Type:            "MessagingService",
		ServiceEndpoint: "https://msg.zeroid.io",
	}

	data, err := json.Marshal(svc)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}

	var decoded Service
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}

	if decoded.ID != svc.ID {
		t.Errorf("ID = %q, want %q", decoded.ID, svc.ID)
	}
	if decoded.Type != svc.Type {
		t.Errorf("Type = %q, want %q", decoded.Type, svc.Type)
	}
}
