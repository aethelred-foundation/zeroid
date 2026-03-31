/// Credential schema types.
///
/// A schema defines the structure of a verifiable credential: which attributes
/// it contains and their types.

use crate::crypto::hash::keccak256;
use crate::error::{Result, ZeroIdTeeError};

/// The type of a credential attribute.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttributeType {
    /// A UTF-8 string value.
    String,
    /// An unsigned 64-bit integer.
    Uint,
    /// A boolean value.
    Bool,
    /// Raw bytes.
    Bytes,
    /// An ISO-8601 date string.
    Date,
}

impl AttributeType {
    /// Return the name of the attribute type.
    pub fn name(&self) -> &'static str {
        match self {
            Self::String => "string",
            Self::Uint => "uint",
            Self::Bool => "bool",
            Self::Bytes => "bytes",
            Self::Date => "date",
        }
    }
}

/// A single attribute definition in a schema.
#[derive(Debug, Clone, PartialEq)]
pub struct AttributeDefinition {
    /// The attribute name.
    pub name: String,
    /// The attribute type.
    pub attr_type: AttributeType,
    /// Whether the attribute is required.
    pub required: bool,
}

/// A credential schema.
#[derive(Debug, Clone, PartialEq)]
pub struct CredentialSchema {
    /// Unique identifier (e.g. "IdentityCredentialV1").
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Schema version.
    pub version: u32,
    /// The attribute definitions.
    pub attributes: Vec<AttributeDefinition>,
}

impl CredentialSchema {
    /// Create a new empty schema.
    pub fn new(id: impl Into<String>, name: impl Into<String>, version: u32) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            version,
            attributes: Vec::new(),
        }
    }

    /// Add an attribute definition.
    pub fn add_attribute(
        &mut self,
        name: impl Into<String>,
        attr_type: AttributeType,
        required: bool,
    ) {
        self.attributes.push(AttributeDefinition {
            name: name.into(),
            attr_type,
            required,
        });
    }

    /// Compute a hash of the schema for on-chain registration.
    pub fn schema_hash(&self) -> [u8; 32] {
        let mut data = Vec::new();
        data.extend_from_slice(self.id.as_bytes());
        data.extend_from_slice(&self.version.to_le_bytes());
        for attr in &self.attributes {
            data.extend_from_slice(attr.name.as_bytes());
            data.extend_from_slice(attr.attr_type.name().as_bytes());
            data.push(u8::from(attr.required));
        }
        keccak256(&data)
    }

    /// Validate that a set of attribute names satisfies the schema.
    ///
    /// Checks that all required attributes are present and all provided
    /// attributes exist in the schema.
    pub fn validate_attributes(&self, provided: &[&str]) -> Result<()> {
        // Check required attributes are present
        for attr in &self.attributes {
            if attr.required && !provided.contains(&attr.name.as_str()) {
                return Err(ZeroIdTeeError::InvalidSchema(format!(
                    "missing required attribute: {}",
                    attr.name
                )));
            }
        }

        // Check all provided attributes exist in schema
        for name in provided {
            if !self.attributes.iter().any(|a| a.name == *name) {
                return Err(ZeroIdTeeError::InvalidSchema(format!(
                    "unknown attribute: {name}"
                )));
            }
        }

        Ok(())
    }

    /// Return the names of all required attributes.
    pub fn required_attributes(&self) -> Vec<&str> {
        self.attributes
            .iter()
            .filter(|a| a.required)
            .map(|a| a.name.as_str())
            .collect()
    }

    /// Return the total number of attributes.
    pub fn attribute_count(&self) -> usize {
        self.attributes.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity_schema() -> CredentialSchema {
        let mut s = CredentialSchema::new("id-v1", "Identity Credential", 1);
        s.add_attribute("name", AttributeType::String, true);
        s.add_attribute("age", AttributeType::Uint, false);
        s.add_attribute("verified", AttributeType::Bool, true);
        s
    }

    #[test]
    fn attribute_type_name() {
        assert_eq!(AttributeType::String.name(), "string");
        assert_eq!(AttributeType::Uint.name(), "uint");
        assert_eq!(AttributeType::Bool.name(), "bool");
        assert_eq!(AttributeType::Bytes.name(), "bytes");
        assert_eq!(AttributeType::Date.name(), "date");
    }

    #[test]
    fn new_schema() {
        let s = CredentialSchema::new("test", "Test", 1);
        assert_eq!(s.id, "test");
        assert_eq!(s.name, "Test");
        assert_eq!(s.version, 1);
        assert!(s.attributes.is_empty());
    }

    #[test]
    fn add_attribute() {
        let s = identity_schema();
        assert_eq!(s.attribute_count(), 3);
    }

    #[test]
    fn schema_hash_deterministic() {
        let s = identity_schema();
        assert_eq!(s.schema_hash(), s.schema_hash());
    }

    #[test]
    fn schema_hash_changes_with_version() {
        let s1 = identity_schema();
        let mut s2 = identity_schema();
        s2.version = 2;
        assert_ne!(s1.schema_hash(), s2.schema_hash());
    }

    #[test]
    fn validate_all_required_present() {
        let s = identity_schema();
        assert!(s.validate_attributes(&["name", "verified"]).is_ok());
    }

    #[test]
    fn validate_all_attributes_present() {
        let s = identity_schema();
        assert!(s
            .validate_attributes(&["name", "age", "verified"])
            .is_ok());
    }

    #[test]
    fn validate_missing_required() {
        let s = identity_schema();
        let result = s.validate_attributes(&["age"]); // missing "name" and "verified"
        assert!(result.is_err());
    }

    #[test]
    fn validate_unknown_attribute() {
        let s = identity_schema();
        let result = s.validate_attributes(&["name", "verified", "unknown"]);
        assert!(result.is_err());
    }

    #[test]
    fn required_attributes() {
        let s = identity_schema();
        let req = s.required_attributes();
        assert!(req.contains(&"name"));
        assert!(req.contains(&"verified"));
        assert!(!req.contains(&"age"));
    }

    #[test]
    fn schema_clone_eq() {
        let s = identity_schema();
        let s2 = s.clone();
        assert_eq!(s, s2);
    }

    #[test]
    fn schema_debug() {
        let s = identity_schema();
        let dbg = format!("{s:?}");
        assert!(dbg.contains("CredentialSchema"));
    }

    #[test]
    fn attribute_definition_clone_eq() {
        let a = AttributeDefinition {
            name: "x".into(),
            attr_type: AttributeType::String,
            required: true,
        };
        let a2 = a.clone();
        assert_eq!(a, a2);
    }

    #[test]
    fn attribute_type_clone_eq() {
        let t = AttributeType::Date;
        let t2 = t.clone();
        assert_eq!(t, t2);
    }

    #[test]
    fn empty_schema_validate_no_attrs() {
        let s = CredentialSchema::new("e", "Empty", 1);
        assert!(s.validate_attributes(&[]).is_ok());
    }

    #[test]
    fn empty_schema_validate_unknown_fails() {
        let s = CredentialSchema::new("e", "Empty", 1);
        assert!(s.validate_attributes(&["x"]).is_err());
    }
}
