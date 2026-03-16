package compliance

import (
	"errors"
	"testing"
)

func TestGetJurisdiction(t *testing.T) {
	tests := []struct {
		name    string
		code    string
		wantErr bool
	}{
		{"US", "US", false},
		{"EU", "EU", false},
		{"UAE", "AE", false},
		{"Singapore", "SG", false},
		{"Japan", "JP", false},
		{"UK", "GB", false},
		{"lowercase us", "us", false},
		{"mixed case", "Eu", false},
		{"unsupported", "XX", true},
		{"empty", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			j, err := GetJurisdiction(tt.code)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error")
				}
				if !errors.Is(err, ErrUnsupportedJurisdiction) {
					t.Errorf("error should wrap ErrUnsupportedJurisdiction, got: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if j == nil {
				t.Fatal("jurisdiction should not be nil")
			}
			if j.Name == "" {
				t.Error("jurisdiction name should not be empty")
			}
		})
	}
}

func TestCheckCompliance(t *testing.T) {
	tests := []struct {
		name          string
		req           *ComplianceRequest
		wantCompliant bool
		wantErr       bool
		wantPassed    int
		wantFailed    int
	}{
		{
			name: "US fully compliant",
			req: &ComplianceRequest{
				JurisdictionCode: "US",
				HasKYC:           true,
				HasAML:           true,
			},
			wantCompliant: true,
			wantPassed:    2,
			wantFailed:    0,
		},
		{
			name: "US missing KYC",
			req: &ComplianceRequest{
				JurisdictionCode: "US",
				HasKYC:           false,
				HasAML:           true,
			},
			wantCompliant: false,
			wantPassed:    1,
			wantFailed:    1,
		},
		{
			name: "US missing AML",
			req: &ComplianceRequest{
				JurisdictionCode: "US",
				HasKYC:           true,
				HasAML:           false,
			},
			wantCompliant: false,
			wantPassed:    1,
			wantFailed:    1,
		},
		{
			name: "US missing both",
			req: &ComplianceRequest{
				JurisdictionCode: "US",
				HasKYC:           false,
				HasAML:           false,
			},
			wantCompliant: false,
			wantPassed:    0,
			wantFailed:    2,
		},
		{
			name: "UAE fully compliant with TEE",
			req: &ComplianceRequest{
				JurisdictionCode: "AE",
				HasKYC:           true,
				HasAML:           true,
				HasTEE:           true,
			},
			wantCompliant: true,
			wantPassed:    3,
			wantFailed:    0,
		},
		{
			name: "UAE missing TEE",
			req: &ComplianceRequest{
				JurisdictionCode: "AE",
				HasKYC:           true,
				HasAML:           true,
				HasTEE:           false,
			},
			wantCompliant: false,
			wantPassed:    2,
			wantFailed:    1,
		},
		{
			name: "EU fully compliant",
			req: &ComplianceRequest{
				JurisdictionCode: "EU",
				HasKYC:           true,
				HasAML:           true,
			},
			wantCompliant: true,
			wantPassed:    2,
			wantFailed:    0,
		},
		{
			name: "SG fully compliant",
			req: &ComplianceRequest{
				JurisdictionCode: "SG",
				HasKYC:           true,
				HasAML:           true,
			},
			wantCompliant: true,
			wantPassed:    2,
			wantFailed:    0,
		},
		{
			name: "JP missing AML",
			req: &ComplianceRequest{
				JurisdictionCode: "JP",
				HasKYC:           true,
				HasAML:           false,
			},
			wantCompliant: false,
			wantPassed:    1,
			wantFailed:    1,
		},
		{
			name: "GB fully compliant",
			req: &ComplianceRequest{
				JurisdictionCode: "GB",
				HasKYC:           true,
				HasAML:           true,
			},
			wantCompliant: true,
			wantPassed:    2,
			wantFailed:    0,
		},
		{
			name:    "unsupported jurisdiction",
			req:     &ComplianceRequest{JurisdictionCode: "XX"},
			wantErr: true,
		},
		{
			name:    "nil request",
			req:     nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := CheckCompliance(tt.req)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Compliant != tt.wantCompliant {
				t.Errorf("Compliant = %v, want %v, errors: %v", result.Compliant, tt.wantCompliant, result.Errors)
			}
			if len(result.PassedRules) != tt.wantPassed {
				t.Errorf("PassedRules = %d, want %d: %v", len(result.PassedRules), tt.wantPassed, result.PassedRules)
			}
			if len(result.FailedRules) != tt.wantFailed {
				t.Errorf("FailedRules = %d, want %d: %v", len(result.FailedRules), tt.wantFailed, result.FailedRules)
			}
		})
	}
}

func TestJurisdictionFields(t *testing.T) {
	for code, j := range SupportedJurisdictions {
		t.Run(code, func(t *testing.T) {
			if j.Code == "" {
				t.Error("Code should not be empty")
			}
			if j.Name == "" {
				t.Error("Name should not be empty")
			}
			if len(j.Rules) == 0 {
				t.Error("Rules should not be empty")
			}
			for _, r := range j.Rules {
				if r.ID == "" {
					t.Error("Rule ID should not be empty")
				}
				if r.Name == "" {
					t.Error("Rule Name should not be empty")
				}
			}
		})
	}
}

func TestComplianceResultErrors(t *testing.T) {
	result, err := CheckCompliance(&ComplianceRequest{
		JurisdictionCode: "AE",
		HasKYC:           false,
		HasAML:           false,
		HasTEE:           false,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Compliant {
		t.Error("should not be compliant")
	}
	if len(result.Errors) != 3 {
		t.Errorf("Errors length = %d, want 3", len(result.Errors))
	}
}
