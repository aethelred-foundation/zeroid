package tee

import (
	"testing"
	"time"
)

func fixedTime(t time.Time) func() time.Time {
	return func() time.Time { return t }
}

func validReport() *AttestationReport {
	return &AttestationReport{
		Platform:        PlatformIntelSGX,
		Timestamp:       time.Now().Add(-time.Hour),
		EnclaveHash:     [32]byte{0x01, 0x02, 0x03},
		SignerID:        [32]byte{0x04, 0x05},
		ReportData:      []byte("test"),
		Signature:       []byte("valid-signature"),
		SecurityVersion: 2,
		Debug:           false,
	}
}

func TestNewAttestationVerifier(t *testing.T) {
	av := NewAttestationVerifier()
	if av == nil {
		t.Fatal("NewAttestationVerifier() returned nil")
	}
	if len(av.policies) != 3 {
		t.Errorf("policies length = %d, want 3", len(av.policies))
	}
}

func TestAttestationVerifierVerify(t *testing.T) {
	now := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name    string
		report  *AttestationReport
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid report",
			report: &AttestationReport{
				Platform:        PlatformIntelSGX,
				Timestamp:       now.Add(-time.Hour),
				EnclaveHash:     [32]byte{0x01},
				Signature:       []byte("sig"),
				SecurityVersion: 1,
				Debug:           false,
			},
			wantErr: false,
		},
		{
			name:    "nil report",
			report:  nil,
			wantErr: true,
			errMsg:  "nil report",
		},
		{
			name: "unknown platform",
			report: &AttestationReport{
				Platform:    PlatformUnknown,
				Timestamp:   now.Add(-time.Hour),
				EnclaveHash: [32]byte{0x01},
				Signature:   []byte("sig"),
			},
			wantErr: true,
			errMsg:  "unknown platform",
		},
		{
			name: "debug mode",
			report: &AttestationReport{
				Platform:        PlatformIntelSGX,
				Timestamp:       now.Add(-time.Hour),
				EnclaveHash:     [32]byte{0x01},
				Signature:       []byte("sig"),
				SecurityVersion: 1,
				Debug:           true,
			},
			wantErr: true,
			errMsg:  "debug mode",
		},
		{
			name: "expired report",
			report: &AttestationReport{
				Platform:        PlatformAMDSEV,
				Timestamp:       now.Add(-48 * time.Hour),
				EnclaveHash:     [32]byte{0x01},
				Signature:       []byte("sig"),
				SecurityVersion: 1,
				Debug:           false,
			},
			wantErr: true,
			errMsg:  "expired",
		},
		{
			name: "no signature",
			report: &AttestationReport{
				Platform:        PlatformIntelSGX,
				Timestamp:       now.Add(-time.Hour),
				EnclaveHash:     [32]byte{0x01},
				Signature:       nil,
				SecurityVersion: 1,
			},
			wantErr: true,
			errMsg:  "no signature",
		},
		{
			name: "empty enclave hash",
			report: &AttestationReport{
				Platform:        PlatformIntelSGX,
				Timestamp:       now.Add(-time.Hour),
				EnclaveHash:     [32]byte{},
				Signature:       []byte("sig"),
				SecurityVersion: 1,
			},
			wantErr: true,
			errMsg:  "empty enclave hash",
		},
		{
			name: "low security version",
			report: &AttestationReport{
				Platform:        PlatformArmTrustZone,
				Timestamp:       now.Add(-time.Hour),
				EnclaveHash:     [32]byte{0x01},
				Signature:       []byte("sig"),
				SecurityVersion: 0,
				Debug:           false,
			},
			wantErr: true,
			errMsg:  "security version",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			av := NewAttestationVerifier()
			av.SetTimeFunc(fixedTime(now))

			err := av.Verify(tt.report)
			if tt.wantErr {
				if err == nil {
					t.Error("Verify() expected error")
				}
				return
			}
			if err != nil {
				t.Errorf("Verify() unexpected error: %v", err)
			}
		})
	}
}

func TestAttestationVerifierIsValid(t *testing.T) {
	now := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	av := NewAttestationVerifier()
	av.SetTimeFunc(fixedTime(now))

	validRep := &AttestationReport{
		Platform:        PlatformIntelSGX,
		Timestamp:       now.Add(-time.Hour),
		EnclaveHash:     [32]byte{0x01},
		Signature:       []byte("sig"),
		SecurityVersion: 1,
	}

	if !av.IsValid(validRep) {
		t.Error("IsValid() should return true for valid report")
	}

	if av.IsValid(nil) {
		t.Error("IsValid(nil) should return false")
	}

	invalidRep := &AttestationReport{
		Platform:    PlatformUnknown,
		Timestamp:   now,
		EnclaveHash: [32]byte{0x01},
		Signature:   []byte("sig"),
	}
	if av.IsValid(invalidRep) {
		t.Error("IsValid() should return false for unknown platform")
	}
}

func TestAttestationVerifierVerifyFull(t *testing.T) {
	now := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	av := NewAttestationVerifier()
	av.SetTimeFunc(fixedTime(now))

	report := &AttestationReport{
		Platform:        PlatformIntelSGX,
		Timestamp:       now.Add(-time.Hour),
		EnclaveHash:     [32]byte{0x01},
		Signature:       []byte("sig"),
		SecurityVersion: 2,
	}

	result := av.VerifyFull(report)
	if !result.Valid {
		t.Errorf("VerifyFull() Valid = false, errors: %v", result.Errors)
	}
	if result.Platform != PlatformIntelSGX {
		t.Errorf("Platform = %v, want %v", result.Platform, PlatformIntelSGX)
	}
	if !result.VerifiedAt.Equal(now) {
		t.Error("VerifiedAt should match current time")
	}

	expectedChecks := []string{"platform", "signature", "enclaveHash", "debug", "freshness", "securityVersion"}
	for _, check := range expectedChecks {
		if !result.Checks[check] {
			t.Errorf("check %q should be true", check)
		}
	}
}

func TestAttestationVerifierSetPolicy(t *testing.T) {
	now := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	av := NewAttestationVerifier()
	av.SetTimeFunc(fixedTime(now))

	// Set policy that allows debug
	av.SetPolicy(PlatformIntelSGX, PlatformPolicy{
		AllowDebug:         true,
		MaxReportAge:       48 * time.Hour,
		MinSecurityVersion: 0,
	})

	report := &AttestationReport{
		Platform:        PlatformIntelSGX,
		Timestamp:       now.Add(-36 * time.Hour),
		EnclaveHash:     [32]byte{0x01},
		Signature:       []byte("sig"),
		SecurityVersion: 0,
		Debug:           true,
	}

	if err := av.Verify(report); err != nil {
		t.Errorf("Verify() should pass with relaxed policy: %v", err)
	}
}

func TestAttestationVerifierSetTimeFunc(t *testing.T) {
	av := NewAttestationVerifier()
	fixed := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	av.SetTimeFunc(fixedTime(fixed))
	if got := av.now(); !got.Equal(fixed) {
		t.Errorf("time func not set correctly, got %v", got)
	}
}

func TestVerifyFullNilReport(t *testing.T) {
	av := NewAttestationVerifier()
	result := av.VerifyFull(nil)
	if result.Valid {
		t.Error("VerifyFull(nil) should not be valid")
	}
	if len(result.Errors) == 0 {
		t.Error("should have errors for nil report")
	}
}

func TestVerifyEmptySignatureSlice(t *testing.T) {
	now := time.Now()
	av := NewAttestationVerifier()
	av.SetTimeFunc(fixedTime(now))

	report := &AttestationReport{
		Platform:        PlatformIntelSGX,
		Timestamp:       now.Add(-time.Hour),
		EnclaveHash:     [32]byte{0x01},
		Signature:       []byte{},
		SecurityVersion: 1,
	}

	if av.IsValid(report) {
		t.Error("empty signature should fail")
	}
}
