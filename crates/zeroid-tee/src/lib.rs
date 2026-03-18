//! # zeroid-tee
//!
//! TEE attestation engine and secure credential verification for the ZeroID
//! self-sovereign identity protocol.
//!
//! This crate is fully self-contained with zero external dependencies, making
//! it suitable for deployment inside Trusted Execution Environments (Intel SGX,
//! AMD SEV, ARM TrustZone).
//!
//! ## Modules
//!
//! - [`attestation`] — attestation report types, verification, and platform policies.
//! - [`enclave`] — enclave lifecycle, sealed memory, and identity management.
//! - [`credential`] — credential processing, selective disclosure, and schemas.
//! - [`crypto`] — self-contained cryptographic primitives (Keccak-256, SHA-256,
//!   ECDSA, Merkle trees).
//! - [`registry`] — TEE node registration and health monitoring.
//! - [`error`] — error types used throughout the crate.

pub mod attestation;
pub mod credential;
pub mod crypto;
pub mod enclave;
pub mod error;
pub mod registry;

// Re-export key types at the crate root for convenience.

pub use attestation::report::{AttestationReport, Platform};
pub use attestation::verifier::AttestationVerifier;
pub use credential::processor::{
    Credential, CredentialProcessor, CredentialStatus, IdentityStatus, VerificationResult,
};
pub use credential::schema::CredentialSchema;
pub use credential::selective::{AttributeSet, DisclosureProof, DisclosureRequest};
pub use enclave::context::{EnclaveContext, EnclaveState};
pub use enclave::identity::EnclaveIdentity;
pub use error::ZeroIdTeeError;
pub use registry::node::NodeRegistry;
pub use registry::types::{NodeInfo, NodeStatus};

#[cfg(test)]
mod tests {
    use super::*;

    /// Smoke test: build a full pipeline — create enclave, verify attestation,
    /// process a credential, selective-disclose, and register a node.
    #[test]
    fn integration_full_pipeline() {
        // 1. Create enclave
        let identity = EnclaveIdentity::new([0xAA; 32], [0xBB; 32], 1, 1);
        let mut ctx = EnclaveContext::new(identity, Platform::IntelSGX);
        ctx.initialise().unwrap();

        // 2. Generate attestation report
        let report = ctx
            .generate_report(b"payload", [0xCC; 20], 1000, 3600)
            .unwrap();

        // 3. Verify attestation
        let mut verifier = AttestationVerifier::with_defaults();
        verifier.add_trusted_measurement([0xAA; 32]);
        let verified_report = verifier.verify(&report, 1500).unwrap();
        assert!(verified_report.is_valid);

        // 4. Process a credential
        let mut processor = CredentialProcessor::new([0xAA; 32]);
        processor.add_issuer("did:example:issuer");

        let mut attrs = AttributeSet::new();
        attrs.add("name", b"Alice".to_vec());
        attrs.add("age", b"30".to_vec());

        let credential = Credential {
            id: "cred-1".into(),
            issuer: "did:example:issuer".into(),
            subject: "did:example:alice".into(),
            schema_id: "any".into(),
            issued_at: 1000,
            expires_at: 5000,
            status: CredentialStatus::Active,
            attributes: attrs.clone(),
        };

        let result = processor.verify(&credential, 2000).unwrap();
        assert!(result.is_valid);

        // 5. Selective disclosure
        let root = credential::selective::compute_credential_root(&attrs).unwrap();
        let req = DisclosureRequest::new(vec!["name".into()]);
        let proof = credential::selective::create_disclosure_proof(&attrs, &req).unwrap();
        assert!(credential::selective::verify_disclosure_proof(&root, &proof).unwrap());

        // 6. Seal/unseal data
        let sealed = ctx.seal(b"secret").unwrap();
        let recovered = ctx.unseal(&sealed).unwrap();
        assert_eq!(recovered, b"secret");

        // 7. Register TEE node
        let mut registry = NodeRegistry::new(300);
        registry
            .register("node-1", [0xCC; 20], Platform::IntelSGX, [0xAA; 32], 1000)
            .unwrap();
        registry.heartbeat("node-1", 1100).unwrap();
        let node = registry.get("node-1").unwrap();
        assert_eq!(node.status, NodeStatus::Active);

        // 8. Terminate enclave
        ctx.terminate().unwrap();
    }

    /// Verify that the re-exported types are accessible.
    #[test]
    fn reexports_accessible() {
        let _ = Platform::IntelSGX;
        let _ = IdentityStatus::Active;
        let _ = CredentialStatus::Active;
        let _ = NodeStatus::Active;
        let _ = EnclaveState::Uninitialised;
    }
}
