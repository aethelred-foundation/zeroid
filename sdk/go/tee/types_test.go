package tee

import (
	"testing"
	"time"
)

func TestPlatformString(t *testing.T) {
	tests := []struct {
		platform Platform
		want     string
	}{
		{PlatformUnknown, "Unknown"},
		{PlatformIntelSGX, "Intel SGX"},
		{PlatformAMDSEV, "AMD SEV"},
		{PlatformArmTrustZone, "ARM TrustZone"},
		{Platform(99), "Platform(99)"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := tt.platform.String(); got != tt.want {
				t.Errorf("Platform(%d).String() = %q, want %q", int(tt.platform), got, tt.want)
			}
		})
	}
}

func TestAttestationReportFields(t *testing.T) {
	now := time.Now()
	report := AttestationReport{
		Platform:        PlatformIntelSGX,
		Timestamp:       now,
		EnclaveHash:     [32]byte{0x01, 0x02},
		SignerID:        [32]byte{0x03, 0x04},
		ReportData:      []byte("test-data"),
		Signature:       []byte("test-sig"),
		CertChain:       [][]byte{[]byte("cert1"), []byte("cert2")},
		SecurityVersion: 3,
		Debug:           false,
	}

	if report.Platform != PlatformIntelSGX {
		t.Errorf("Platform = %v, want %v", report.Platform, PlatformIntelSGX)
	}
	if !report.Timestamp.Equal(now) {
		t.Errorf("Timestamp mismatch")
	}
	if report.EnclaveHash[0] != 0x01 {
		t.Errorf("EnclaveHash[0] = %x, want 0x01", report.EnclaveHash[0])
	}
	if report.SignerID[0] != 0x03 {
		t.Errorf("SignerID[0] = %x, want 0x03", report.SignerID[0])
	}
	if string(report.ReportData) != "test-data" {
		t.Errorf("ReportData = %q", report.ReportData)
	}
	if len(report.CertChain) != 2 {
		t.Errorf("CertChain length = %d, want 2", len(report.CertChain))
	}
	if report.SecurityVersion != 3 {
		t.Errorf("SecurityVersion = %d, want 3", report.SecurityVersion)
	}
	if report.Debug {
		t.Error("Debug should be false")
	}
}

func TestVerificationResultFields(t *testing.T) {
	now := time.Now()
	result := VerificationResult{
		Valid:    true,
		Platform: PlatformAMDSEV,
		Errors:   nil,
		Checks: map[string]bool{
			"signature": true,
			"freshness": true,
		},
		VerifiedAt: now,
	}

	if !result.Valid {
		t.Error("Valid should be true")
	}
	if result.Platform != PlatformAMDSEV {
		t.Errorf("Platform = %v, want %v", result.Platform, PlatformAMDSEV)
	}
	if len(result.Errors) != 0 {
		t.Errorf("Errors length = %d, want 0", len(result.Errors))
	}
	if len(result.Checks) != 2 {
		t.Errorf("Checks length = %d, want 2", len(result.Checks))
	}
	if !result.VerifiedAt.Equal(now) {
		t.Error("VerifiedAt mismatch")
	}
}

func TestVerificationResultWithErrors(t *testing.T) {
	result := VerificationResult{
		Valid:    false,
		Platform: PlatformUnknown,
		Errors:   []string{"signature invalid", "report expired"},
		Checks: map[string]bool{
			"signature": false,
			"freshness": false,
		},
	}

	if result.Valid {
		t.Error("Valid should be false")
	}
	if len(result.Errors) != 2 {
		t.Errorf("Errors length = %d, want 2", len(result.Errors))
	}
}

func TestAttestationReportMinimal(t *testing.T) {
	report := AttestationReport{
		Platform:  PlatformArmTrustZone,
		Timestamp: time.Now(),
		Debug:     true,
	}

	if report.Platform != PlatformArmTrustZone {
		t.Errorf("Platform = %v", report.Platform)
	}
	if !report.Debug {
		t.Error("Debug should be true")
	}
	if report.CertChain != nil {
		t.Error("CertChain should be nil")
	}
	if report.ReportData != nil {
		t.Error("ReportData should be nil")
	}
}
