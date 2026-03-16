// Package compliance provides jurisdiction-specific compliance checking
// and sanctions screening for the ZeroID identity system.
package compliance

import (
	"errors"
	"fmt"
	"strings"
)

// ErrUnsupportedJurisdiction is returned when a jurisdiction code is not recognized.
var ErrUnsupportedJurisdiction = errors.New("compliance: unsupported jurisdiction")

// ErrComplianceFailed is returned when a compliance check fails.
var ErrComplianceFailed = errors.New("compliance: check failed")

// Rule represents a single compliance rule that must be satisfied.
type Rule struct {
	// ID is the unique identifier for this rule.
	ID string
	// Name is the human-readable name of the rule.
	Name string
	// Description explains what the rule requires.
	Description string
	// Required indicates whether this rule is mandatory.
	Required bool
}

// Jurisdiction represents a regulatory jurisdiction with its compliance rules.
type Jurisdiction struct {
	// Code is the ISO 3166-1 alpha-2 country code.
	Code string
	// Name is the human-readable jurisdiction name.
	Name string
	// Rules is the set of compliance rules for this jurisdiction.
	Rules []Rule
	// RequiresKYC indicates whether KYC is required.
	RequiresKYC bool
	// RequiresAML indicates whether AML checks are required.
	RequiresAML bool
	// RequiresTEE indicates whether TEE attestation is required.
	RequiresTEE bool
}

// ComplianceResult contains the result of a jurisdiction compliance check.
type ComplianceResult struct {
	// Compliant indicates whether all required rules are satisfied.
	Compliant bool
	// Jurisdiction is the jurisdiction code that was checked.
	Jurisdiction string
	// PassedRules lists the rule IDs that passed.
	PassedRules []string
	// FailedRules lists the rule IDs that failed.
	FailedRules []string
	// Errors contains descriptive error messages.
	Errors []string
}

// ComplianceRequest contains the data needed for a compliance check.
type ComplianceRequest struct {
	// JurisdictionCode is the ISO country code to check against.
	JurisdictionCode string
	// HasKYC indicates whether the subject has completed KYC.
	HasKYC bool
	// HasAML indicates whether the subject has passed AML checks.
	HasAML bool
	// HasTEE indicates whether the subject has TEE attestation.
	HasTEE bool
	// Attributes contains additional compliance-relevant attributes.
	Attributes map[string]string
}

// SupportedJurisdictions contains the compliance rules for supported jurisdictions.
var SupportedJurisdictions = map[string]*Jurisdiction{
	"US": {
		Code: "US", Name: "United States",
		RequiresKYC: true, RequiresAML: true, RequiresTEE: false,
		Rules: []Rule{
			{ID: "us-kyc", Name: "KYC Verification", Description: "Know Your Customer verification required", Required: true},
			{ID: "us-aml", Name: "AML Screening", Description: "Anti-Money Laundering screening required", Required: true},
			{ID: "us-ofac", Name: "OFAC Check", Description: "Office of Foreign Assets Control screening", Required: true},
		},
	},
	"EU": {
		Code: "EU", Name: "European Union",
		RequiresKYC: true, RequiresAML: true, RequiresTEE: false,
		Rules: []Rule{
			{ID: "eu-kyc", Name: "KYC Verification", Description: "eIDAS-compliant identity verification", Required: true},
			{ID: "eu-aml", Name: "AML Screening", Description: "AMLD6 compliance screening", Required: true},
			{ID: "eu-gdpr", Name: "GDPR Compliance", Description: "General Data Protection Regulation compliance", Required: true},
		},
	},
	"AE": {
		Code: "AE", Name: "United Arab Emirates",
		RequiresKYC: true, RequiresAML: true, RequiresTEE: true,
		Rules: []Rule{
			{ID: "ae-kyc", Name: "KYC Verification", Description: "UAE KYC requirements", Required: true},
			{ID: "ae-aml", Name: "AML Screening", Description: "UAE AML requirements", Required: true},
			{ID: "ae-tee", Name: "TEE Attestation", Description: "Trusted execution environment required", Required: true},
		},
	},
	"SG": {
		Code: "SG", Name: "Singapore",
		RequiresKYC: true, RequiresAML: true, RequiresTEE: false,
		Rules: []Rule{
			{ID: "sg-kyc", Name: "KYC Verification", Description: "MAS KYC requirements", Required: true},
			{ID: "sg-aml", Name: "AML Screening", Description: "MAS AML/CFT requirements", Required: true},
		},
	},
	"JP": {
		Code: "JP", Name: "Japan",
		RequiresKYC: true, RequiresAML: true, RequiresTEE: false,
		Rules: []Rule{
			{ID: "jp-kyc", Name: "KYC Verification", Description: "FSA KYC requirements", Required: true},
			{ID: "jp-aml", Name: "AML Screening", Description: "JAFIC AML requirements", Required: true},
		},
	},
	"GB": {
		Code: "GB", Name: "United Kingdom",
		RequiresKYC: true, RequiresAML: true, RequiresTEE: false,
		Rules: []Rule{
			{ID: "gb-kyc", Name: "KYC Verification", Description: "FCA KYC requirements", Required: true},
			{ID: "gb-aml", Name: "AML Screening", Description: "UK AML regulations", Required: true},
		},
	},
}

// GetJurisdiction returns the jurisdiction configuration for the given code.
// Returns ErrUnsupportedJurisdiction if the code is not recognized.
func GetJurisdiction(code string) (*Jurisdiction, error) {
	code = strings.ToUpper(code)
	j, ok := SupportedJurisdictions[code]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnsupportedJurisdiction, code)
	}
	return j, nil
}

// CheckCompliance verifies that the given request satisfies all required
// compliance rules for the specified jurisdiction.
func CheckCompliance(req *ComplianceRequest) (*ComplianceResult, error) {
	if req == nil {
		return nil, errors.New("compliance: nil request")
	}

	jurisdiction, err := GetJurisdiction(req.JurisdictionCode)
	if err != nil {
		return nil, err
	}

	result := &ComplianceResult{
		Compliant:    true,
		Jurisdiction: jurisdiction.Code,
	}

	// Check KYC requirement
	if jurisdiction.RequiresKYC {
		if req.HasKYC {
			result.PassedRules = append(result.PassedRules, jurisdiction.Code+"-kyc")
		} else {
			result.Compliant = false
			result.FailedRules = append(result.FailedRules, jurisdiction.Code+"-kyc")
			result.Errors = append(result.Errors, "KYC verification required")
		}
	}

	// Check AML requirement
	if jurisdiction.RequiresAML {
		if req.HasAML {
			result.PassedRules = append(result.PassedRules, jurisdiction.Code+"-aml")
		} else {
			result.Compliant = false
			result.FailedRules = append(result.FailedRules, jurisdiction.Code+"-aml")
			result.Errors = append(result.Errors, "AML screening required")
		}
	}

	// Check TEE requirement
	if jurisdiction.RequiresTEE {
		if req.HasTEE {
			result.PassedRules = append(result.PassedRules, jurisdiction.Code+"-tee")
		} else {
			result.Compliant = false
			result.FailedRules = append(result.FailedRules, jurisdiction.Code+"-tee")
			result.Errors = append(result.Errors, "TEE attestation required")
		}
	}

	return result, nil
}
