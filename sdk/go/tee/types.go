// Package tee provides types and verification logic for Trusted Execution
// Environment (TEE) attestation in the ZeroID system.
package tee

import (
	"fmt"
	"time"
)

// Platform represents the type of TEE hardware platform.
type Platform int

const (
	// PlatformUnknown indicates an unrecognized TEE platform.
	PlatformUnknown Platform = iota
	// PlatformIntelSGX indicates Intel Software Guard Extensions.
	PlatformIntelSGX
	// PlatformAMDSEV indicates AMD Secure Encrypted Virtualization.
	PlatformAMDSEV
	// PlatformArmTrustZone indicates ARM TrustZone.
	PlatformArmTrustZone
)

// String returns the human-readable name for a Platform.
func (p Platform) String() string {
	switch p {
	case PlatformUnknown:
		return "Unknown"
	case PlatformIntelSGX:
		return "Intel SGX"
	case PlatformAMDSEV:
		return "AMD SEV"
	case PlatformArmTrustZone:
		return "ARM TrustZone"
	default:
		return fmt.Sprintf("Platform(%d)", int(p))
	}
}

// AttestationReport represents a TEE attestation report containing
// evidence of secure execution.
type AttestationReport struct {
	// Platform is the TEE platform that generated this report.
	Platform Platform `json:"platform"`
	// Timestamp is when the attestation was generated.
	Timestamp time.Time `json:"timestamp"`
	// EnclaveHash is the measurement hash of the enclave code.
	EnclaveHash [32]byte `json:"enclaveHash"`
	// SignerID identifies the enclave signer.
	SignerID [32]byte `json:"signerId"`
	// ReportData contains user-supplied data bound to the attestation.
	ReportData []byte `json:"reportData"`
	// Signature is the platform-specific attestation signature.
	Signature []byte `json:"signature"`
	// CertChain contains the certificate chain for signature verification.
	CertChain [][]byte `json:"certChain,omitempty"`
	// SecurityVersion is the security version number of the enclave.
	SecurityVersion uint16 `json:"securityVersion"`
	// Debug indicates whether the enclave is running in debug mode.
	Debug bool `json:"debug"`
}

// VerificationResult contains the result of TEE attestation verification.
type VerificationResult struct {
	// Valid indicates whether the attestation passed all checks.
	Valid bool `json:"valid"`
	// Platform is the verified platform type.
	Platform Platform `json:"platform"`
	// Errors contains any verification errors encountered.
	Errors []string `json:"errors,omitempty"`
	// Checks contains individual check results.
	Checks map[string]bool `json:"checks"`
	// VerifiedAt is when the verification was performed.
	VerifiedAt time.Time `json:"verifiedAt"`
}
