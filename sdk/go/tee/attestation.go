package tee

import (
	"errors"
	"fmt"
	"time"
)

// Attestation verification error sentinel values.
var (
	// ErrNilReport is returned when a nil attestation report is provided.
	ErrNilReport = errors.New("attestation: nil report")
	// ErrUnknownPlatform is returned when the report platform is unknown.
	ErrUnknownPlatform = errors.New("attestation: unknown platform")
	// ErrDebugEnclave is returned when the enclave is running in debug mode.
	ErrDebugEnclave = errors.New("attestation: debug mode not allowed")
	// ErrReportExpired is returned when the attestation report is too old.
	ErrReportExpired = errors.New("attestation: report expired")
	// ErrNoSignature is returned when the report has no signature.
	ErrNoSignature = errors.New("attestation: no signature")
	// ErrEmptyEnclaveHash is returned when the enclave hash is zero.
	ErrEmptyEnclaveHash = errors.New("attestation: empty enclave hash")
	// ErrLowSecurityVersion is returned when the security version is below the minimum.
	ErrLowSecurityVersion = errors.New("attestation: security version too low")
)

// PlatformPolicy defines verification requirements for a specific TEE platform.
type PlatformPolicy struct {
	// AllowDebug determines whether debug enclaves are permitted.
	AllowDebug bool
	// MaxReportAge is the maximum age of an attestation report.
	MaxReportAge time.Duration
	// MinSecurityVersion is the minimum required security version.
	MinSecurityVersion uint16
}

// DefaultPolicies contains the default verification policies for each platform.
var DefaultPolicies = map[Platform]PlatformPolicy{
	PlatformIntelSGX: {
		AllowDebug:         false,
		MaxReportAge:       24 * time.Hour,
		MinSecurityVersion: 1,
	},
	PlatformAMDSEV: {
		AllowDebug:         false,
		MaxReportAge:       24 * time.Hour,
		MinSecurityVersion: 1,
	},
	PlatformArmTrustZone: {
		AllowDebug:         false,
		MaxReportAge:       24 * time.Hour,
		MinSecurityVersion: 1,
	},
}

// AttestationVerifier verifies TEE attestation reports against platform
// policies and freshness requirements.
type AttestationVerifier struct {
	policies map[Platform]PlatformPolicy
	now      func() time.Time
}

// NewAttestationVerifier creates a new verifier with default platform policies.
func NewAttestationVerifier() *AttestationVerifier {
	policies := make(map[Platform]PlatformPolicy)
	for k, v := range DefaultPolicies {
		policies[k] = v
	}
	return &AttestationVerifier{
		policies: policies,
		now:      time.Now,
	}
}

// SetTimeFunc overrides the time function for freshness checks.
// This is primarily useful for testing.
func (av *AttestationVerifier) SetTimeFunc(fn func() time.Time) {
	av.now = fn
}

// SetPolicy sets the verification policy for a specific platform.
func (av *AttestationVerifier) SetPolicy(platform Platform, policy PlatformPolicy) {
	av.policies[platform] = policy
}

// Verify performs a full verification of an attestation report, checking
// platform validity, freshness, signature presence, enclave hash, debug
// status, and security version.
func (av *AttestationVerifier) Verify(report *AttestationReport) error {
	result := av.verify(report)
	if !result.Valid {
		return fmt.Errorf("%s", result.Errors[0])
	}
	return nil
}

// IsValid checks whether an attestation report passes all verification checks.
func (av *AttestationVerifier) IsValid(report *AttestationReport) bool {
	result := av.verify(report)
	return result.Valid
}

// VerifyFull performs verification and returns the full result with details.
func (av *AttestationVerifier) VerifyFull(report *AttestationReport) *VerificationResult {
	return av.verify(report)
}

func (av *AttestationVerifier) verify(report *AttestationReport) *VerificationResult {
	result := &VerificationResult{
		Valid:      true,
		Checks:    make(map[string]bool),
		VerifiedAt: av.now(),
	}

	if report == nil {
		result.Valid = false
		result.Errors = append(result.Errors, ErrNilReport.Error())
		return result
	}

	result.Platform = report.Platform

	// Check platform
	av.checkPlatform(report, result)

	// Check signature
	av.checkSignature(report, result)

	// Check enclave hash
	av.checkEnclaveHash(report, result)

	// Get policy for platform-specific checks
	policy, hasPol := av.policies[report.Platform]
	if hasPol {
		// Check debug mode
		av.checkDebug(report, policy, result)

		// Check freshness
		av.checkFreshness(report, policy, result)

		// Check security version
		av.checkSecurityVersion(report, policy, result)
	}

	return result
}

func (av *AttestationVerifier) checkPlatform(report *AttestationReport, result *VerificationResult) {
	if report.Platform == PlatformUnknown {
		result.Valid = false
		result.Checks["platform"] = false
		result.Errors = append(result.Errors, ErrUnknownPlatform.Error())
	} else {
		result.Checks["platform"] = true
	}
}

func (av *AttestationVerifier) checkSignature(report *AttestationReport, result *VerificationResult) {
	if len(report.Signature) == 0 {
		result.Valid = false
		result.Checks["signature"] = false
		result.Errors = append(result.Errors, ErrNoSignature.Error())
	} else {
		result.Checks["signature"] = true
	}
}

func (av *AttestationVerifier) checkEnclaveHash(report *AttestationReport, result *VerificationResult) {
	var zero [32]byte
	if report.EnclaveHash == zero {
		result.Valid = false
		result.Checks["enclaveHash"] = false
		result.Errors = append(result.Errors, ErrEmptyEnclaveHash.Error())
	} else {
		result.Checks["enclaveHash"] = true
	}
}

func (av *AttestationVerifier) checkDebug(report *AttestationReport, policy PlatformPolicy, result *VerificationResult) {
	if report.Debug && !policy.AllowDebug {
		result.Valid = false
		result.Checks["debug"] = false
		result.Errors = append(result.Errors, ErrDebugEnclave.Error())
	} else {
		result.Checks["debug"] = true
	}
}

func (av *AttestationVerifier) checkFreshness(report *AttestationReport, policy PlatformPolicy, result *VerificationResult) {
	age := av.now().Sub(report.Timestamp)
	if age > policy.MaxReportAge {
		result.Valid = false
		result.Checks["freshness"] = false
		result.Errors = append(result.Errors, ErrReportExpired.Error())
	} else {
		result.Checks["freshness"] = true
	}
}

func (av *AttestationVerifier) checkSecurityVersion(report *AttestationReport, policy PlatformPolicy, result *VerificationResult) {
	if report.SecurityVersion < policy.MinSecurityVersion {
		result.Valid = false
		result.Checks["securityVersion"] = false
		result.Errors = append(result.Errors, ErrLowSecurityVersion.Error())
	} else {
		result.Checks["securityVersion"] = true
	}
}
