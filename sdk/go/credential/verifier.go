package credential

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Verification error sentinel values.
var (
	// ErrCredentialExpired is returned when a credential has passed its expiration date.
	ErrCredentialExpired = errors.New("credential: expired")
	// ErrCredentialRevoked is returned when a credential has been revoked.
	ErrCredentialRevoked = errors.New("credential: revoked")
	// ErrCredentialSuspended is returned when a credential has been suspended.
	ErrCredentialSuspended = errors.New("credential: suspended")
	// ErrCredentialInactive is returned when a credential has no active status.
	ErrCredentialInactive = errors.New("credential: inactive")
	// ErrIssuerNotApproved is returned when the issuer is not an approved issuer.
	ErrIssuerNotApproved = errors.New("credential: issuer not approved")
	// ErrNoProof is returned when a credential has no proof.
	ErrNoProof = errors.New("credential: no proof")
	// ErrInvalidProof is returned when a credential proof is malformed or invalid.
	ErrInvalidProof = errors.New("credential: invalid proof")
	// ErrIssuerKeyNotTrusted is returned when no trusted proof key is configured for the issuer.
	ErrIssuerKeyNotTrusted = errors.New("credential: issuer proof key not trusted")
	// ErrSchemaNotFound is returned when the credential schema is not found.
	ErrSchemaNotFound = errors.New("credential: schema not found")
)

// SchemaRegistry defines the interface for looking up credential schemas.
type SchemaRegistry interface {
	// GetSchema retrieves a credential schema by its ID.
	GetSchema(schemaID string) (*CredentialSchema, error)
}

// IssuerRegistry defines the interface for checking issuer authorization.
type IssuerRegistry interface {
	// IsApprovedIssuer checks whether a DID is an approved credential issuer.
	IsApprovedIssuer(did string) (bool, error)
}

// VerificationResult contains the result of credential verification.
type VerificationResult struct {
	// Valid indicates whether the credential passed all verification checks.
	Valid bool
	// Errors contains any verification errors encountered.
	Errors []string
	// Checks contains the individual check results.
	Checks map[string]bool
}

// Verifier verifies verifiable credentials against on-chain status,
// expiry, and issuer authorization.
type Verifier struct {
	schemas           SchemaRegistry
	issuers           IssuerRegistry
	trustedIssuerKeys map[string]string
	now               func() time.Time
}

// NewVerifier creates a new credential verifier with the given registries.
func NewVerifier(schemas SchemaRegistry, issuers IssuerRegistry) *Verifier {
	return &Verifier{
		schemas:           schemas,
		issuers:           issuers,
		trustedIssuerKeys: make(map[string]string),
		now:               time.Now,
	}
}

// NewVerifierWithTrustedIssuerKeys creates a verifier with issuer-scoped proof keys.
func NewVerifierWithTrustedIssuerKeys(schemas SchemaRegistry, issuers IssuerRegistry, keys map[string]string) *Verifier {
	v := NewVerifier(schemas, issuers)
	v.SetTrustedIssuerKeys(keys)
	return v
}

// SetTrustedIssuerKeys replaces the issuer DID to proof-key mapping used to
// authenticate credential proofs. Keys are copied so callers can safely mutate
// their input map after configuration.
func (v *Verifier) SetTrustedIssuerKeys(keys map[string]string) {
	v.trustedIssuerKeys = make(map[string]string, len(keys))
	for issuer, key := range keys {
		v.trustedIssuerKeys[issuer] = key
	}
}

// SetTimeFunc overrides the time function used for expiry checks. This is
// primarily useful for testing.
func (v *Verifier) SetTimeFunc(fn func() time.Time) {
	v.now = fn
}

// Verify performs a full verification of a verifiable credential, checking
// status, expiry, issuer authorization, and schema compliance.
func (v *Verifier) Verify(cred *VerifiableCredential) (*VerificationResult, error) {
	if cred == nil {
		return nil, errors.New("credential: nil credential")
	}

	result := &VerificationResult{
		Valid:  true,
		Checks: make(map[string]bool),
	}

	// Check status
	v.checkStatus(cred, result)

	// Check expiry
	v.checkExpiry(cred, result)

	// Check proof exists
	v.checkProof(cred, result)

	// Check issuer authorization
	if err := v.checkIssuer(cred, result); err != nil {
		return nil, fmt.Errorf("credential: issuer check failed: %w", err)
	}

	// Check schema if specified
	if err := v.checkSchema(cred, result); err != nil {
		return nil, fmt.Errorf("credential: schema check failed: %w", err)
	}

	return result, nil
}

func (v *Verifier) checkStatus(cred *VerifiableCredential, result *VerificationResult) {
	switch cred.Status {
	case StatusActive:
		result.Checks["status"] = true
	case StatusRevoked:
		result.Valid = false
		result.Checks["status"] = false
		result.Errors = append(result.Errors, ErrCredentialRevoked.Error())
	case StatusSuspended:
		result.Valid = false
		result.Checks["status"] = false
		result.Errors = append(result.Errors, ErrCredentialSuspended.Error())
	case StatusExpired:
		result.Valid = false
		result.Checks["status"] = false
		result.Errors = append(result.Errors, ErrCredentialExpired.Error())
	default:
		result.Valid = false
		result.Checks["status"] = false
		result.Errors = append(result.Errors, ErrCredentialInactive.Error())
	}
}

func (v *Verifier) checkExpiry(cred *VerifiableCredential, result *VerificationResult) {
	if cred.ExpirationDate.IsZero() {
		result.Checks["expiry"] = true
		return
	}
	if v.now().After(cred.ExpirationDate) {
		result.Valid = false
		result.Checks["expiry"] = false
		result.Errors = append(result.Errors, ErrCredentialExpired.Error())
	} else {
		result.Checks["expiry"] = true
	}
}

func (v *Verifier) checkProof(cred *VerifiableCredential, result *VerificationResult) {
	if cred.Proof == nil {
		result.Valid = false
		result.Checks["proof"] = false
		result.Errors = append(result.Errors, ErrNoProof.Error())
		return
	}

	proofErrors := make([]string, 0)
	proof := cred.Proof

	if proof.Type != "ZeroIDCredentialProof2026" {
		proofErrors = append(proofErrors, "credential: unsupported proof type")
	}
	if proof.ProofPurpose != "assertionMethod" {
		proofErrors = append(proofErrors, "credential: unsupported proof purpose")
	}
	if proof.Created.IsZero() {
		proofErrors = append(proofErrors, "credential: missing proof creation time")
	}
	if proof.VerificationMethod == "" {
		proofErrors = append(proofErrors, "credential: missing verification method")
	} else if !strings.HasPrefix(proof.VerificationMethod, cred.Issuer+"#") {
		proofErrors = append(proofErrors, "credential: verification method is not controlled by issuer")
	}
	if proof.ProofValue == "" {
		proofErrors = append(proofErrors, "credential: missing proof value")
	}
	if proof.MerkleRoot == "" {
		proofErrors = append(proofErrors, "credential: missing subject Merkle root")
	}

	subjectRoot, err := ComputeCredentialSubjectMerkleRoot(cred.CredentialSubject)
	if err != nil {
		proofErrors = append(proofErrors, err.Error())
	} else if proof.MerkleRoot != "" && proof.MerkleRoot != subjectRoot {
		proofErrors = append(proofErrors, "credential: subject does not match proof root")
	}

	issuerKey := v.trustedIssuerKeys[cred.Issuer]
	if issuerKey == "" {
		proofErrors = append(proofErrors, ErrIssuerKeyNotTrusted.Error())
	} else if proof.ProofValue != "" && proof.MerkleRoot != "" {
		payload, err := BuildCredentialProofPayload(cred, proof.MerkleRoot)
		if err != nil {
			proofErrors = append(proofErrors, err.Error())
		} else {
			expected := ComputeCredentialProofValue(issuerKey, payload)
			if subtle.ConstantTimeCompare([]byte(proof.ProofValue), []byte(expected)) != 1 {
				proofErrors = append(proofErrors, "credential: proof signature is invalid")
			}
		}
	}

	if len(proofErrors) > 0 {
		result.Valid = false
		result.Checks["proof"] = false
		result.Errors = append(result.Errors, proofErrors...)
		return
	}

	result.Checks["proof"] = true
}

func (v *Verifier) checkIssuer(cred *VerifiableCredential, result *VerificationResult) error {
	approved, err := v.issuers.IsApprovedIssuer(cred.Issuer)
	if err != nil {
		return err
	}
	if !approved {
		result.Valid = false
		result.Checks["issuer"] = false
		result.Errors = append(result.Errors, ErrIssuerNotApproved.Error())
	} else {
		result.Checks["issuer"] = true
	}
	return nil
}

func (v *Verifier) checkSchema(cred *VerifiableCredential, result *VerificationResult) error {
	if cred.SchemaID == "" {
		result.Checks["schema"] = true
		return nil
	}
	schema, err := v.schemas.GetSchema(cred.SchemaID)
	if err != nil {
		if errors.Is(err, ErrSchemaNotFound) {
			result.Valid = false
			result.Checks["schema"] = false
			result.Errors = append(result.Errors, ErrSchemaNotFound.Error())
			return nil
		}
		return err
	}
	validator := NewSchemaValidator()
	if err := validator.Validate(cred, schema); err != nil {
		result.Valid = false
		result.Checks["schema"] = false
		result.Errors = append(result.Errors, err.Error())
	} else {
		result.Checks["schema"] = true
	}
	return nil
}
