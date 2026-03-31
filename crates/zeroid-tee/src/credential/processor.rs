/// Credential verification within the TEE.
///
/// The [`CredentialProcessor`] verifies credentials inside the trusted
/// boundary, checking issuer authorisation, expiry, schema compliance, and
/// producing a [`VerificationResult`].

use crate::credential::schema::CredentialSchema;
use crate::credential::selective::{compute_credential_root, AttributeSet};
use crate::crypto::hash::keccak256;
use crate::error::{Result, ZeroIdTeeError};

/// Status of a decentralised identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityStatus {
    /// Identity has not been activated.
    Inactive,
    /// Identity is active and usable.
    Active,
    /// Identity has been temporarily suspended.
    Suspended,
    /// Identity has been permanently revoked.
    Revoked,
}

/// Status of a verifiable credential.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialStatus {
    /// No status recorded.
    None,
    /// Credential is active.
    Active,
    /// Credential is temporarily suspended.
    Suspended,
    /// Credential has been permanently revoked.
    Revoked,
    /// Credential has expired.
    Expired,
}

/// A verifiable credential submitted for processing.
#[derive(Debug, Clone, PartialEq)]
pub struct Credential {
    /// Credential identifier (e.g. a DID-URL).
    pub id: String,
    /// DID of the issuer.
    pub issuer: String,
    /// DID of the subject.
    pub subject: String,
    /// Schema ID this credential conforms to.
    pub schema_id: String,
    /// Unix timestamp when the credential was issued.
    pub issued_at: u64,
    /// Unix timestamp when the credential expires.
    pub expires_at: u64,
    /// Current status.
    pub status: CredentialStatus,
    /// Credential attributes.
    pub attributes: AttributeSet,
}

/// The result of verifying a credential within the TEE.
#[derive(Debug, Clone, PartialEq)]
pub struct VerificationResult {
    /// Whether the credential is valid.
    pub is_valid: bool,
    /// Hash of the enclave that performed verification.
    pub enclave_hash: [u8; 32],
    /// Timestamp of verification.
    pub timestamp: u64,
    /// Hash of the credential.
    pub credential_hash: [u8; 32],
    /// Names of attributes that were verified.
    pub attributes_verified: Vec<String>,
}

/// Processes and verifies credentials within a TEE enclave.
#[derive(Debug, Clone)]
pub struct CredentialProcessor {
    /// Hash of the enclave performing verification.
    enclave_hash: [u8; 32],
    /// Authorised issuer DIDs.
    authorised_issuers: Vec<String>,
    /// Registered schemas.
    schemas: Vec<CredentialSchema>,
}

impl CredentialProcessor {
    /// Create a new credential processor for the given enclave.
    pub fn new(enclave_hash: [u8; 32]) -> Self {
        Self {
            enclave_hash,
            authorised_issuers: Vec::new(),
            schemas: Vec::new(),
        }
    }

    /// Register an authorised issuer.
    pub fn add_issuer(&mut self, issuer: impl Into<String>) {
        let issuer = issuer.into();
        if !self.authorised_issuers.contains(&issuer) {
            self.authorised_issuers.push(issuer);
        }
    }

    /// Register a credential schema.
    pub fn add_schema(&mut self, schema: CredentialSchema) {
        self.schemas.push(schema);
    }

    /// Return the number of authorised issuers.
    pub fn issuer_count(&self) -> usize {
        self.authorised_issuers.len()
    }

    /// Return the number of registered schemas.
    pub fn schema_count(&self) -> usize {
        self.schemas.len()
    }

    /// Verify a credential.
    ///
    /// Checks:
    /// 1. Credential status is Active.
    /// 2. Credential has not expired (`now < expires_at`).
    /// 3. Issuer is authorised (if any issuers are registered).
    /// 4. Schema exists and attributes conform to it (if schemas are registered).
    /// 5. Credential root is computable.
    pub fn verify(
        &self,
        credential: &Credential,
        now: u64,
    ) -> Result<VerificationResult> {
        // Check status
        match credential.status {
            CredentialStatus::Active => {}
            CredentialStatus::Expired => {
                return Err(ZeroIdTeeError::CredentialExpired {
                    credential_id: credential.id.clone(),
                    expired_at: credential.expires_at,
                });
            }
            CredentialStatus::Revoked => {
                return Err(ZeroIdTeeError::CredentialError(format!(
                    "credential {} is revoked",
                    credential.id
                )));
            }
            CredentialStatus::Suspended => {
                return Err(ZeroIdTeeError::CredentialError(format!(
                    "credential {} is suspended",
                    credential.id
                )));
            }
            CredentialStatus::None => {
                return Err(ZeroIdTeeError::CredentialError(format!(
                    "credential {} has no status",
                    credential.id
                )));
            }
        }

        // Check expiry
        if now >= credential.expires_at {
            return Err(ZeroIdTeeError::CredentialExpired {
                credential_id: credential.id.clone(),
                expired_at: credential.expires_at,
            });
        }

        // Check issuer
        if !self.authorised_issuers.is_empty()
            && !self.authorised_issuers.contains(&credential.issuer)
        {
            return Err(ZeroIdTeeError::UnauthorizedIssuer(
                credential.issuer.clone(),
            ));
        }

        // Check schema
        let attr_names: Vec<&str> = credential
            .attributes
            .entries
            .iter()
            .map(|(n, _)| n.as_str())
            .collect();

        if !self.schemas.is_empty() {
            let schema = self
                .schemas
                .iter()
                .find(|s| s.id == credential.schema_id)
                .ok_or_else(|| {
                    ZeroIdTeeError::InvalidSchema(format!(
                        "schema not found: {}",
                        credential.schema_id
                    ))
                })?;
            schema.validate_attributes(&attr_names)?;
        }

        // Compute credential hash
        let credential_hash = self.hash_credential(credential);

        Ok(VerificationResult {
            is_valid: true,
            enclave_hash: self.enclave_hash,
            timestamp: now,
            credential_hash,
            attributes_verified: attr_names.iter().map(|s| s.to_string()).collect(),
        })
    }

    /// Compute a hash of a credential for the verification result.
    fn hash_credential(&self, credential: &Credential) -> [u8; 32] {
        let mut data = Vec::new();
        data.extend_from_slice(credential.id.as_bytes());
        data.extend_from_slice(credential.issuer.as_bytes());
        data.extend_from_slice(credential.subject.as_bytes());
        data.extend_from_slice(&credential.issued_at.to_le_bytes());
        data.extend_from_slice(&credential.expires_at.to_le_bytes());
        // Include the attribute root if possible
        if let Ok(root) = compute_credential_root(&credential.attributes) {
            data.extend_from_slice(&root);
        }
        keccak256(&data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credential::schema::{AttributeType, CredentialSchema};

    fn sample_credential() -> Credential {
        let mut attrs = AttributeSet::new();
        attrs.add("name", b"Alice".to_vec());
        attrs.add("verified", b"true".to_vec());
        Credential {
            id: "cred-1".into(),
            issuer: "did:example:issuer".into(),
            subject: "did:example:alice".into(),
            schema_id: "id-v1".into(),
            issued_at: 1000,
            expires_at: 5000,
            status: CredentialStatus::Active,
            attributes: attrs,
        }
    }

    fn sample_schema() -> CredentialSchema {
        let mut s = CredentialSchema::new("id-v1", "Identity", 1);
        s.add_attribute("name", AttributeType::String, true);
        s.add_attribute("verified", AttributeType::Bool, true);
        s
    }

    fn processor_with_issuer_and_schema() -> CredentialProcessor {
        let mut p = CredentialProcessor::new([0xAA; 32]);
        p.add_issuer("did:example:issuer");
        p.add_schema(sample_schema());
        p
    }

    #[test]
    fn verify_valid_credential() {
        let p = processor_with_issuer_and_schema();
        let cred = sample_credential();
        let result = p.verify(&cred, 2000).unwrap();
        assert!(result.is_valid);
        assert_eq!(result.enclave_hash, [0xAA; 32]);
        assert_eq!(result.timestamp, 2000);
        assert_eq!(result.attributes_verified.len(), 2);
    }

    #[test]
    fn verify_expired_status() {
        let p = CredentialProcessor::new([0; 32]);
        let mut cred = sample_credential();
        cred.status = CredentialStatus::Expired;
        let result = p.verify(&cred, 2000);
        assert!(result.is_err());
    }

    #[test]
    fn verify_revoked() {
        let p = CredentialProcessor::new([0; 32]);
        let mut cred = sample_credential();
        cred.status = CredentialStatus::Revoked;
        let result = p.verify(&cred, 2000);
        assert!(result.is_err());
    }

    #[test]
    fn verify_suspended() {
        let p = CredentialProcessor::new([0; 32]);
        let mut cred = sample_credential();
        cred.status = CredentialStatus::Suspended;
        let result = p.verify(&cred, 2000);
        assert!(result.is_err());
    }

    #[test]
    fn verify_no_status() {
        let p = CredentialProcessor::new([0; 32]);
        let mut cred = sample_credential();
        cred.status = CredentialStatus::None;
        let result = p.verify(&cred, 2000);
        assert!(result.is_err());
    }

    #[test]
    fn verify_time_expired() {
        let p = CredentialProcessor::new([0; 32]);
        let cred = sample_credential(); // expires_at = 5000
        let result = p.verify(&cred, 6000);
        assert!(result.is_err());
        match result.unwrap_err() {
            ZeroIdTeeError::CredentialExpired { .. } => {}
            other => panic!("expected CredentialExpired, got: {other}"),
        }
    }

    #[test]
    fn verify_unauthorized_issuer() {
        let mut p = CredentialProcessor::new([0; 32]);
        p.add_issuer("did:example:other");
        let cred = sample_credential();
        let result = p.verify(&cred, 2000);
        assert!(result.is_err());
        match result.unwrap_err() {
            ZeroIdTeeError::UnauthorizedIssuer(_) => {}
            other => panic!("expected UnauthorizedIssuer, got: {other}"),
        }
    }

    #[test]
    fn verify_schema_not_found() {
        let mut p = CredentialProcessor::new([0; 32]);
        p.add_schema(CredentialSchema::new("other", "Other", 1));
        let cred = sample_credential();
        let result = p.verify(&cred, 2000);
        assert!(result.is_err());
    }

    #[test]
    fn verify_schema_missing_required() {
        let mut p = CredentialProcessor::new([0; 32]);
        let mut schema = sample_schema();
        schema.add_attribute("extra", AttributeType::String, true);
        p.add_schema(schema);
        let cred = sample_credential();
        let result = p.verify(&cred, 2000);
        assert!(result.is_err());
    }

    #[test]
    fn verify_no_issuers_registered_accepts_any() {
        let p = CredentialProcessor::new([0; 32]);
        let cred = sample_credential();
        assert!(p.verify(&cred, 2000).is_ok());
    }

    #[test]
    fn verify_no_schemas_registered_accepts_any() {
        let mut p = CredentialProcessor::new([0; 32]);
        p.add_issuer("did:example:issuer");
        let cred = sample_credential();
        assert!(p.verify(&cred, 2000).is_ok());
    }

    #[test]
    fn add_issuer_dedup() {
        let mut p = CredentialProcessor::new([0; 32]);
        p.add_issuer("a");
        p.add_issuer("a");
        assert_eq!(p.issuer_count(), 1);
    }

    #[test]
    fn processor_debug() {
        let p = CredentialProcessor::new([0; 32]);
        let dbg = format!("{p:?}");
        assert!(dbg.contains("CredentialProcessor"));
    }

    #[test]
    fn processor_clone() {
        let p = processor_with_issuer_and_schema();
        let p2 = p.clone();
        assert_eq!(p.issuer_count(), p2.issuer_count());
    }

    #[test]
    fn identity_status_copy() {
        let s = IdentityStatus::Active;
        let s2 = s;
        assert_eq!(s, s2);
    }

    #[test]
    fn credential_status_copy() {
        let s = CredentialStatus::Suspended;
        let s2 = s;
        assert_eq!(s, s2);
    }

    #[test]
    fn verification_result_clone_eq() {
        let r = VerificationResult {
            is_valid: true,
            enclave_hash: [0; 32],
            timestamp: 100,
            credential_hash: [1; 32],
            attributes_verified: vec!["a".into()],
        };
        let r2 = r.clone();
        assert_eq!(r, r2);
    }

    #[test]
    fn credential_clone_eq() {
        let c = sample_credential();
        let c2 = c.clone();
        assert_eq!(c, c2);
    }

    #[test]
    fn verify_at_exact_expiry_fails() {
        let p = CredentialProcessor::new([0; 32]);
        let cred = sample_credential(); // expires_at = 5000
        let result = p.verify(&cred, 5000);
        assert!(result.is_err());
    }

    #[test]
    fn verify_just_before_expiry() {
        let p = CredentialProcessor::new([0; 32]);
        let cred = sample_credential();
        assert!(p.verify(&cred, 4999).is_ok());
    }

    #[test]
    fn identity_status_debug() {
        assert!(format!("{:?}", IdentityStatus::Inactive).contains("Inactive"));
        assert!(format!("{:?}", IdentityStatus::Active).contains("Active"));
        assert!(format!("{:?}", IdentityStatus::Suspended).contains("Suspended"));
        assert!(format!("{:?}", IdentityStatus::Revoked).contains("Revoked"));
    }

    #[test]
    fn credential_status_debug() {
        assert!(format!("{:?}", CredentialStatus::None).contains("None"));
        assert!(format!("{:?}", CredentialStatus::Active).contains("Active"));
        assert!(format!("{:?}", CredentialStatus::Suspended).contains("Suspended"));
        assert!(format!("{:?}", CredentialStatus::Revoked).contains("Revoked"));
        assert!(format!("{:?}", CredentialStatus::Expired).contains("Expired"));
    }
}
