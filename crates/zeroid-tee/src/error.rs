/// Error types for the ZeroID TEE crate.
///
/// All fallible operations in this crate return `Result<T, ZeroIdTeeError>`.

use std::fmt;

/// Top-level error type for the ZeroID TEE crate.
#[derive(Debug, Clone, PartialEq)]
pub enum ZeroIdTeeError {
    /// The attestation report has expired.
    AttestationExpired {
        /// When the report expired (unix timestamp).
        expired_at: u64,
        /// Current time used for the check (unix timestamp).
        checked_at: u64,
    },
    /// The attestation report is invalid.
    InvalidAttestation(String),
    /// The enclave measurement does not match a known-good value.
    MeasurementMismatch {
        /// The expected measurement hash.
        expected: [u8; 32],
        /// The actual measurement hash.
        actual: [u8; 32],
    },
    /// An unsupported TEE platform was specified.
    UnsupportedPlatform(String),
    /// A credential-related error.
    CredentialError(String),
    /// A credential has expired.
    CredentialExpired {
        /// Credential identifier.
        credential_id: String,
        /// Expiry timestamp.
        expired_at: u64,
    },
    /// The credential schema is invalid.
    InvalidSchema(String),
    /// A cryptographic operation failed.
    CryptoError(String),
    /// A Merkle proof verification failed.
    InvalidMerkleProof(String),
    /// An enclave operation failed.
    EnclaveError(String),
    /// Sealed data could not be unsealed (wrong key or corrupted).
    SealingError(String),
    /// A registry operation failed.
    RegistryError(String),
    /// A node was not found in the registry.
    NodeNotFound(String),
    /// The issuer is not authorized to issue credentials.
    UnauthorizedIssuer(String),
    /// An ECDSA signature is invalid.
    InvalidSignature(String),
    /// A generic internal error.
    InternalError(String),
}

impl fmt::Display for ZeroIdTeeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AttestationExpired {
                expired_at,
                checked_at,
            } => write!(
                f,
                "attestation expired at {expired_at}, checked at {checked_at}"
            ),
            Self::InvalidAttestation(msg) => write!(f, "invalid attestation: {msg}"),
            Self::MeasurementMismatch { expected, actual } => {
                write!(
                    f,
                    "measurement mismatch: expected {:?}, got {:?}",
                    expected, actual
                )
            }
            Self::UnsupportedPlatform(p) => write!(f, "unsupported platform: {p}"),
            Self::CredentialError(msg) => write!(f, "credential error: {msg}"),
            Self::CredentialExpired {
                credential_id,
                expired_at,
            } => write!(
                f,
                "credential {credential_id} expired at {expired_at}"
            ),
            Self::InvalidSchema(msg) => write!(f, "invalid schema: {msg}"),
            Self::CryptoError(msg) => write!(f, "crypto error: {msg}"),
            Self::InvalidMerkleProof(msg) => write!(f, "invalid merkle proof: {msg}"),
            Self::EnclaveError(msg) => write!(f, "enclave error: {msg}"),
            Self::SealingError(msg) => write!(f, "sealing error: {msg}"),
            Self::RegistryError(msg) => write!(f, "registry error: {msg}"),
            Self::NodeNotFound(id) => write!(f, "node not found: {id}"),
            Self::UnauthorizedIssuer(msg) => write!(f, "unauthorized issuer: {msg}"),
            Self::InvalidSignature(msg) => write!(f, "invalid signature: {msg}"),
            Self::InternalError(msg) => write!(f, "internal error: {msg}"),
        }
    }
}

impl std::error::Error for ZeroIdTeeError {}

/// Convenience alias used throughout the crate.
pub type Result<T> = std::result::Result<T, ZeroIdTeeError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_attestation_expired() {
        let e = ZeroIdTeeError::AttestationExpired {
            expired_at: 100,
            checked_at: 200,
        };
        assert_eq!(e.to_string(), "attestation expired at 100, checked at 200");
    }

    #[test]
    fn display_invalid_attestation() {
        let e = ZeroIdTeeError::InvalidAttestation("bad data".into());
        assert_eq!(e.to_string(), "invalid attestation: bad data");
    }

    #[test]
    fn display_measurement_mismatch() {
        let e = ZeroIdTeeError::MeasurementMismatch {
            expected: [1u8; 32],
            actual: [2u8; 32],
        };
        let s = e.to_string();
        assert!(s.contains("measurement mismatch"));
    }

    #[test]
    fn display_unsupported_platform() {
        let e = ZeroIdTeeError::UnsupportedPlatform("RISC-V".into());
        assert_eq!(e.to_string(), "unsupported platform: RISC-V");
    }

    #[test]
    fn display_credential_error() {
        let e = ZeroIdTeeError::CredentialError("missing field".into());
        assert_eq!(e.to_string(), "credential error: missing field");
    }

    #[test]
    fn display_credential_expired() {
        let e = ZeroIdTeeError::CredentialExpired {
            credential_id: "cred-1".into(),
            expired_at: 500,
        };
        assert_eq!(e.to_string(), "credential cred-1 expired at 500");
    }

    #[test]
    fn display_invalid_schema() {
        let e = ZeroIdTeeError::InvalidSchema("bad".into());
        assert_eq!(e.to_string(), "invalid schema: bad");
    }

    #[test]
    fn display_crypto_error() {
        let e = ZeroIdTeeError::CryptoError("hash fail".into());
        assert_eq!(e.to_string(), "crypto error: hash fail");
    }

    #[test]
    fn display_invalid_merkle_proof() {
        let e = ZeroIdTeeError::InvalidMerkleProof("proof bad".into());
        assert_eq!(e.to_string(), "invalid merkle proof: proof bad");
    }

    #[test]
    fn display_enclave_error() {
        let e = ZeroIdTeeError::EnclaveError("init failed".into());
        assert_eq!(e.to_string(), "enclave error: init failed");
    }

    #[test]
    fn display_sealing_error() {
        let e = ZeroIdTeeError::SealingError("bad key".into());
        assert_eq!(e.to_string(), "sealing error: bad key");
    }

    #[test]
    fn display_registry_error() {
        let e = ZeroIdTeeError::RegistryError("down".into());
        assert_eq!(e.to_string(), "registry error: down");
    }

    #[test]
    fn display_node_not_found() {
        let e = ZeroIdTeeError::NodeNotFound("node-42".into());
        assert_eq!(e.to_string(), "node not found: node-42");
    }

    #[test]
    fn display_unauthorized_issuer() {
        let e = ZeroIdTeeError::UnauthorizedIssuer("0xabc".into());
        assert_eq!(e.to_string(), "unauthorized issuer: 0xabc");
    }

    #[test]
    fn display_invalid_signature() {
        let e = ZeroIdTeeError::InvalidSignature("wrong curve".into());
        assert_eq!(e.to_string(), "invalid signature: wrong curve");
    }

    #[test]
    fn display_internal_error() {
        let e = ZeroIdTeeError::InternalError("panic".into());
        assert_eq!(e.to_string(), "internal error: panic");
    }

    #[test]
    fn error_is_clone_and_eq() {
        let e1 = ZeroIdTeeError::InternalError("a".into());
        let e2 = e1.clone();
        assert_eq!(e1, e2);
    }

    #[test]
    fn error_debug_format() {
        let e = ZeroIdTeeError::CryptoError("test".into());
        let dbg = format!("{:?}", e);
        assert!(dbg.contains("CryptoError"));
    }

    #[test]
    fn error_trait_impl() {
        let e = ZeroIdTeeError::InternalError("x".into());
        let _: &dyn std::error::Error = &e;
    }
}
