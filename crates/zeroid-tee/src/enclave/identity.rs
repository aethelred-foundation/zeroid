/// Enclave identity and measurement.
///
/// Models MRENCLAVE (code identity) and MRSIGNER (signer identity) used by
/// Intel SGX and analogous concepts on other TEE platforms.

use crate::crypto::hash::{keccak256, sha256};

/// Identity of an enclave, analogous to SGX MRENCLAVE + MRSIGNER.
#[derive(Debug, Clone, PartialEq)]
pub struct EnclaveIdentity {
    /// Hash of the enclave binary (MRENCLAVE equivalent).
    pub mr_enclave: [u8; 32],
    /// Hash of the enclave signer (MRSIGNER equivalent).
    pub mr_signer: [u8; 32],
    /// Product ID.
    pub product_id: u16,
    /// Security version number.
    pub security_version: u16,
    /// Whether the enclave is running in debug mode.
    pub debug_mode: bool,
}

impl EnclaveIdentity {
    /// Create a new enclave identity.
    pub fn new(
        mr_enclave: [u8; 32],
        mr_signer: [u8; 32],
        product_id: u16,
        security_version: u16,
    ) -> Self {
        Self {
            mr_enclave,
            mr_signer,
            product_id,
            security_version,
            debug_mode: false,
        }
    }

    /// Derive an enclave identity from code bytes and a signer key.
    ///
    /// Computes `mr_enclave = keccak256(code)` and `mr_signer = sha256(signer_key)`.
    pub fn from_code_and_signer(
        code: &[u8],
        signer_key: &[u8],
        product_id: u16,
        security_version: u16,
    ) -> Self {
        let mr_enclave = keccak256(code);
        let mr_signer = sha256(signer_key);
        Self::new(mr_enclave, mr_signer, product_id, security_version)
    }

    /// Compute a unique fingerprint of this identity.
    pub fn fingerprint(&self) -> [u8; 32] {
        let mut data = Vec::new();
        data.extend_from_slice(&self.mr_enclave);
        data.extend_from_slice(&self.mr_signer);
        data.extend_from_slice(&self.product_id.to_le_bytes());
        data.extend_from_slice(&self.security_version.to_le_bytes());
        data.push(u8::from(self.debug_mode));
        keccak256(&data)
    }

    /// Check whether this identity matches a given MRENCLAVE.
    pub fn matches_enclave(&self, mr_enclave: &[u8; 32]) -> bool {
        self.mr_enclave == *mr_enclave
    }

    /// Check whether this identity was signed by the given signer.
    pub fn matches_signer(&self, mr_signer: &[u8; 32]) -> bool {
        self.mr_signer == *mr_signer
    }

    /// Check whether the security version meets a minimum requirement.
    pub fn meets_security_version(&self, min_version: u16) -> bool {
        self.security_version >= min_version
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_identity() -> EnclaveIdentity {
        EnclaveIdentity::new([0xAA; 32], [0xBB; 32], 1, 2)
    }

    #[test]
    fn new_not_debug() {
        let id = sample_identity();
        assert!(!id.debug_mode);
        assert_eq!(id.product_id, 1);
        assert_eq!(id.security_version, 2);
    }

    #[test]
    fn from_code_and_signer() {
        let id = EnclaveIdentity::from_code_and_signer(b"code", b"signer", 10, 5);
        assert_eq!(id.mr_enclave, keccak256(b"code"));
        assert_eq!(id.mr_signer, sha256(b"signer"));
        assert_eq!(id.product_id, 10);
        assert_eq!(id.security_version, 5);
    }

    #[test]
    fn fingerprint_deterministic() {
        let id = sample_identity();
        assert_eq!(id.fingerprint(), id.fingerprint());
    }

    #[test]
    fn fingerprint_changes_with_debug() {
        let mut id1 = sample_identity();
        let mut id2 = sample_identity();
        id2.debug_mode = true;
        assert_ne!(id1.fingerprint(), id2.fingerprint());
        id1.debug_mode = true;
        assert_eq!(id1.fingerprint(), id2.fingerprint());
    }

    #[test]
    fn matches_enclave() {
        let id = sample_identity();
        assert!(id.matches_enclave(&[0xAA; 32]));
        assert!(!id.matches_enclave(&[0xFF; 32]));
    }

    #[test]
    fn matches_signer() {
        let id = sample_identity();
        assert!(id.matches_signer(&[0xBB; 32]));
        assert!(!id.matches_signer(&[0xFF; 32]));
    }

    #[test]
    fn meets_security_version() {
        let id = sample_identity(); // version = 2
        assert!(id.meets_security_version(1));
        assert!(id.meets_security_version(2));
        assert!(!id.meets_security_version(3));
    }

    #[test]
    fn clone_eq() {
        let id = sample_identity();
        let id2 = id.clone();
        assert_eq!(id, id2);
    }

    #[test]
    fn debug_format() {
        let id = sample_identity();
        let dbg = format!("{id:?}");
        assert!(dbg.contains("EnclaveIdentity"));
    }

    #[test]
    fn fingerprint_differs_with_product_id() {
        let id1 = EnclaveIdentity::new([0xAA; 32], [0xBB; 32], 1, 2);
        let id2 = EnclaveIdentity::new([0xAA; 32], [0xBB; 32], 2, 2);
        assert_ne!(id1.fingerprint(), id2.fingerprint());
    }

    #[test]
    fn fingerprint_differs_with_version() {
        let id1 = EnclaveIdentity::new([0xAA; 32], [0xBB; 32], 1, 1);
        let id2 = EnclaveIdentity::new([0xAA; 32], [0xBB; 32], 1, 2);
        assert_ne!(id1.fingerprint(), id2.fingerprint());
    }
}
