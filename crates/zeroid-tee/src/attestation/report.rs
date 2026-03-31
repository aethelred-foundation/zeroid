/// Attestation report types and parsing.
///
/// An [`AttestationReport`] represents a signed statement from a TEE platform
/// asserting properties about an enclave (measurement, operator, etc.).

use crate::crypto::hash::keccak256;
use crate::error::{Result, ZeroIdTeeError};

/// TEE platform type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Platform {
    /// Unknown or unrecognised platform.
    Unknown,
    /// Intel Software Guard Extensions.
    IntelSGX,
    /// AMD Secure Encrypted Virtualisation.
    AMDSEV,
    /// ARM TrustZone.
    ArmTrustZone,
}

impl Platform {
    /// Return the human-readable name of the platform.
    pub fn name(&self) -> &'static str {
        match self {
            Self::Unknown => "Unknown",
            Self::IntelSGX => "Intel SGX",
            Self::AMDSEV => "AMD SEV",
            Self::ArmTrustZone => "ARM TrustZone",
        }
    }

    /// Parse a platform from its `u8` discriminant (matching the Solidity enum).
    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::IntelSGX,
            2 => Self::AMDSEV,
            3 => Self::ArmTrustZone,
            _ => Self::Unknown,
        }
    }

    /// Convert to the `u8` discriminant.
    pub fn to_u8(self) -> u8 {
        match self {
            Self::Unknown => 0,
            Self::IntelSGX => 1,
            Self::AMDSEV => 2,
            Self::ArmTrustZone => 3,
        }
    }
}

impl std::fmt::Display for Platform {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.name())
    }
}

/// An attestation report from a TEE platform.
#[derive(Debug, Clone, PartialEq)]
pub struct AttestationReport {
    /// Hash of the enclave binary (MRENCLAVE equivalent).
    pub enclave_hash: [u8; 32],
    /// The TEE platform that produced this report.
    pub platform: Platform,
    /// Unix timestamp when the attestation was created.
    pub attested_at: u64,
    /// Unix timestamp when the attestation expires.
    pub expires_at: u64,
    /// Hash of the report data (application-specific payload).
    pub report_data_hash: [u8; 32],
    /// Ethereum address of the node operator (20 bytes).
    pub node_operator: [u8; 20],
    /// Whether the report has been validated.
    pub is_valid: bool,
}

impl AttestationReport {
    /// Create a new attestation report.
    pub fn new(
        enclave_hash: [u8; 32],
        platform: Platform,
        attested_at: u64,
        expires_at: u64,
        report_data_hash: [u8; 32],
        node_operator: [u8; 20],
    ) -> Self {
        Self {
            enclave_hash,
            platform,
            attested_at,
            expires_at,
            report_data_hash,
            node_operator,
            is_valid: false,
        }
    }

    /// Check whether the report has expired relative to `now`.
    pub fn is_expired(&self, now: u64) -> bool {
        now >= self.expires_at
    }

    /// Check whether the report is fresh (not expired) relative to `now`.
    pub fn is_fresh(&self, now: u64) -> bool {
        !self.is_expired(now)
    }

    /// Compute a unique identifier for this report by hashing its fields.
    pub fn report_id(&self) -> [u8; 32] {
        let mut data = Vec::new();
        data.extend_from_slice(&self.enclave_hash);
        data.push(self.platform.to_u8());
        data.extend_from_slice(&self.attested_at.to_le_bytes());
        data.extend_from_slice(&self.expires_at.to_le_bytes());
        data.extend_from_slice(&self.report_data_hash);
        data.extend_from_slice(&self.node_operator);
        keccak256(&data)
    }

    /// Serialize the report to bytes for signing / transmission.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&self.enclave_hash);
        buf.push(self.platform.to_u8());
        buf.extend_from_slice(&self.attested_at.to_le_bytes());
        buf.extend_from_slice(&self.expires_at.to_le_bytes());
        buf.extend_from_slice(&self.report_data_hash);
        buf.extend_from_slice(&self.node_operator);
        buf.push(u8::from(self.is_valid));
        buf
    }

    /// Deserialize a report from bytes produced by [`to_bytes`].
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        // 32 + 1 + 8 + 8 + 32 + 20 + 1 = 102
        if data.len() < 102 {
            return Err(ZeroIdTeeError::InvalidAttestation(format!(
                "report too short: {} bytes, need 102",
                data.len()
            )));
        }

        let mut enclave_hash = [0u8; 32];
        enclave_hash.copy_from_slice(&data[0..32]);

        let platform = Platform::from_u8(data[32]);

        let attested_at = u64::from_le_bytes(data[33..41].try_into().unwrap());
        let expires_at = u64::from_le_bytes(data[41..49].try_into().unwrap());

        let mut report_data_hash = [0u8; 32];
        report_data_hash.copy_from_slice(&data[49..81]);

        let mut node_operator = [0u8; 20];
        node_operator.copy_from_slice(&data[81..101]);

        let is_valid = data[101] != 0;

        Ok(Self {
            enclave_hash,
            platform,
            attested_at,
            expires_at,
            report_data_hash,
            node_operator,
            is_valid,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_report() -> AttestationReport {
        AttestationReport::new(
            [0xAA; 32],
            Platform::IntelSGX,
            1000,
            2000,
            [0xBB; 32],
            [0xCC; 20],
        )
    }

    #[test]
    fn platform_name() {
        assert_eq!(Platform::Unknown.name(), "Unknown");
        assert_eq!(Platform::IntelSGX.name(), "Intel SGX");
        assert_eq!(Platform::AMDSEV.name(), "AMD SEV");
        assert_eq!(Platform::ArmTrustZone.name(), "ARM TrustZone");
    }

    #[test]
    fn platform_display() {
        assert_eq!(format!("{}", Platform::IntelSGX), "Intel SGX");
    }

    #[test]
    fn platform_roundtrip_u8() {
        for p in [
            Platform::Unknown,
            Platform::IntelSGX,
            Platform::AMDSEV,
            Platform::ArmTrustZone,
        ] {
            assert_eq!(Platform::from_u8(p.to_u8()), p);
        }
    }

    #[test]
    fn platform_from_u8_unknown() {
        assert_eq!(Platform::from_u8(99), Platform::Unknown);
    }

    #[test]
    fn platform_hash_and_eq() {
        use std::collections::HashSet;
        let mut set = HashSet::new();
        set.insert(Platform::IntelSGX);
        set.insert(Platform::IntelSGX);
        assert_eq!(set.len(), 1);
    }

    #[test]
    fn new_report_not_valid() {
        let r = sample_report();
        assert!(!r.is_valid);
    }

    #[test]
    fn is_expired_and_fresh() {
        let r = sample_report();
        assert!(!r.is_expired(999));
        assert!(r.is_fresh(999));
        assert!(!r.is_expired(1999));
        assert!(r.is_fresh(1999));
        assert!(r.is_expired(2000));
        assert!(!r.is_fresh(2000));
        assert!(r.is_expired(3000));
        assert!(!r.is_fresh(3000));
    }

    #[test]
    fn report_id_deterministic() {
        let r = sample_report();
        assert_eq!(r.report_id(), r.report_id());
    }

    #[test]
    fn report_id_differs_for_different_reports() {
        let r1 = sample_report();
        let mut r2 = sample_report();
        r2.enclave_hash = [0x11; 32];
        assert_ne!(r1.report_id(), r2.report_id());
    }

    #[test]
    fn to_bytes_from_bytes_roundtrip() {
        let r = sample_report();
        let bytes = r.to_bytes();
        let r2 = AttestationReport::from_bytes(&bytes).unwrap();
        assert_eq!(r, r2);
    }

    #[test]
    fn to_bytes_from_bytes_with_valid_flag() {
        let mut r = sample_report();
        r.is_valid = true;
        let bytes = r.to_bytes();
        let r2 = AttestationReport::from_bytes(&bytes).unwrap();
        assert!(r2.is_valid);
    }

    #[test]
    fn from_bytes_too_short() {
        let result = AttestationReport::from_bytes(&[0u8; 50]);
        assert!(result.is_err());
    }

    #[test]
    fn report_clone_eq() {
        let r = sample_report();
        let r2 = r.clone();
        assert_eq!(r, r2);
    }

    #[test]
    fn report_debug() {
        let r = sample_report();
        let dbg = format!("{r:?}");
        assert!(dbg.contains("AttestationReport"));
    }

    #[test]
    fn platform_clone_copy() {
        let p = Platform::AMDSEV;
        let p2 = p;
        assert_eq!(p, p2);
    }
}
