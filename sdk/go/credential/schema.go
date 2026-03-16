package credential

import (
	"errors"
	"fmt"
)

// ErrSchemaValidation is returned when a credential fails schema validation.
var ErrSchemaValidation = errors.New("schema: validation failed")

// ErrMissingAttribute is returned when a required attribute is missing.
var ErrMissingAttribute = errors.New("schema: missing required attribute")

// CredentialSchema defines the structure and requirements for a credential type.
type CredentialSchema struct {
	// ID is the unique identifier for this schema.
	ID string `json:"id"`
	// Type is the schema type (e.g., "JsonSchema2023").
	Type string `json:"type"`
	// Name is the human-readable name of the schema.
	Name string `json:"name"`
	// Version is the schema version.
	Version string `json:"version"`
	// RequiredAttributes lists the attribute names that must be present.
	RequiredAttributes []string `json:"requiredAttributes"`
	// OptionalAttributes lists the attribute names that may be present.
	OptionalAttributes []string `json:"optionalAttributes,omitempty"`
}

// SchemaValidator validates verifiable credentials against their schemas.
type SchemaValidator struct{}

// NewSchemaValidator creates a new SchemaValidator.
func NewSchemaValidator() *SchemaValidator {
	return &SchemaValidator{}
}

// Validate checks that a credential's subject attributes satisfy all
// requirements defined in the schema. It verifies that all required
// attributes are present.
func (sv *SchemaValidator) Validate(cred *VerifiableCredential, schema *CredentialSchema) error {
	if cred == nil {
		return fmt.Errorf("%w: nil credential", ErrSchemaValidation)
	}
	if schema == nil {
		return fmt.Errorf("%w: nil schema", ErrSchemaValidation)
	}

	attrs := cred.CredentialSubject.Attributes
	if attrs == nil && len(schema.RequiredAttributes) > 0 {
		return fmt.Errorf("%w: %s (no attributes present)", ErrMissingAttribute, schema.RequiredAttributes[0])
	}

	for _, req := range schema.RequiredAttributes {
		if _, ok := attrs[req]; !ok {
			return fmt.Errorf("%w: %s", ErrMissingAttribute, req)
		}
	}

	return nil
}
