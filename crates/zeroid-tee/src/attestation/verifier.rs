/// Attestation report verification.
///
/// The [`AttestationVerifier`] checks reports against platform policies and
/// a set of known-good enclave measurements.

use crate::attestation::policy::AttestationPolicy;
use crate::attestation::report::{AttestationReport, Platform};
use crate::error::{Result, ZeroIdTeeError};

/// Verifies attestation reports from TEE platforms.
#[derive(Debug, Clone)]
pub struct AttestationVerifier {
    /// Per-platform policies.
    policies: Vec<AttestationPolicy>,
    /// Known-good enclave measurements across all platforms.
    trusted_measurements: Vec<[u8; 32]>,
}

impl AttestationVerifier {
    /// Create a new verifier with no policies or trusted measurements.
    pub fn new() -> Self {
        Self {
            policies: Vec::new(),
            trusted_measurements: Vec::new(),
        }
    }

    /// Create a verifier with default policies for all supported platforms.
    pub fn with_defaults() -> Self {
        Self {
            policies: vec![
                AttestationPolicy::new(Platform::IntelSGX),
                AttestationPolicy::new(Platform::AMDSEV),
                AttestationPolicy::new(Platform::ArmTrustZone),
            ],
            trusted_measurements: Vec::new(),
        }
    }

    /// Register a platform-specific attestation policy.
    pub fn add_policy(&mut self, policy: AttestationPolicy) {
        // Replace existing policy for the same platform.
        self.policies.retain(|p| p.platform != policy.platform);
        self.policies.push(policy);
    }

    /// Register a trusted enclave measurement.
    pub fn add_trusted_measurement(&mut self, measurement: [u8; 32]) {
        if !self.trusted_measurements.contains(&measurement) {
            self.trusted_measurements.push(measurement);
        }
    }

    /// Verify an attestation report.
    ///
    /// Checks:
    /// 1. The platform is supported and has a policy.
    /// 2. The report satisfies the policy (freshness, window, measurement).
    /// 3. The enclave measurement is in the trusted set (if any are registered).
    ///
    /// On success, returns a copy of the report with `is_valid` set to `true`.
    pub fn verify(
        &self,
        report: &AttestationReport,
        now: u64,
    ) -> Result<AttestationReport> {
        if report.platform == Platform::Unknown {
            return Err(ZeroIdTeeError::UnsupportedPlatform(
                "cannot verify Unknown platform".into(),
            ));
        }

        // Find the matching policy
        let policy = self
            .policies
            .iter()
            .find(|p| p.platform == report.platform)
            .ok_or_else(|| {
                ZeroIdTeeError::UnsupportedPlatform(format!(
                    "no policy registered for {:?}",
                    report.platform
                ))
            })?;

        // Evaluate the policy
        policy.evaluate(report, now)?;

        // Check trusted measurements (if any registered)
        if !self.trusted_measurements.is_empty()
            && !self.trusted_measurements.contains(&report.enclave_hash)
        {
            return Err(ZeroIdTeeError::MeasurementMismatch {
                expected: self.trusted_measurements[0],
                actual: report.enclave_hash,
            });
        }

        let mut verified = report.clone();
        verified.is_valid = true;
        Ok(verified)
    }

    /// Return the number of registered policies.
    pub fn policy_count(&self) -> usize {
        self.policies.len()
    }

    /// Return the number of trusted measurements.
    pub fn trusted_measurement_count(&self) -> usize {
        self.trusted_measurements.len()
    }
}

impl Default for AttestationVerifier {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sgx_report(attested_at: u64, expires_at: u64) -> AttestationReport {
        AttestationReport::new(
            [0xAA; 32],
            Platform::IntelSGX,
            attested_at,
            expires_at,
            [0xBB; 32],
            [0xCC; 20],
        )
    }

    #[test]
    fn new_verifier_has_no_policies() {
        let v = AttestationVerifier::new();
        assert_eq!(v.policy_count(), 0);
        assert_eq!(v.trusted_measurement_count(), 0);
    }

    #[test]
    fn default_verifier_same_as_new() {
        let v = AttestationVerifier::default();
        assert_eq!(v.policy_count(), 0);
    }

    #[test]
    fn with_defaults_has_three_policies() {
        let v = AttestationVerifier::with_defaults();
        assert_eq!(v.policy_count(), 3);
    }

    #[test]
    fn add_policy_replaces_existing() {
        let mut v = AttestationVerifier::new();
        let mut p1 = AttestationPolicy::new(Platform::IntelSGX);
        p1.max_report_age_secs = 100;
        v.add_policy(p1);
        assert_eq!(v.policy_count(), 1);

        let mut p2 = AttestationPolicy::new(Platform::IntelSGX);
        p2.max_report_age_secs = 200;
        v.add_policy(p2);
        assert_eq!(v.policy_count(), 1);
    }

    #[test]
    fn add_trusted_measurement_dedup() {
        let mut v = AttestationVerifier::new();
        v.add_trusted_measurement([0xAA; 32]);
        v.add_trusted_measurement([0xAA; 32]);
        assert_eq!(v.trusted_measurement_count(), 1);
    }

    #[test]
    fn verify_valid_report() {
        let mut v = AttestationVerifier::with_defaults();
        v.add_trusted_measurement([0xAA; 32]);
        let report = sgx_report(1000, 2000);
        let result = v.verify(&report, 1500).unwrap();
        assert!(result.is_valid);
    }

    #[test]
    fn verify_unknown_platform() {
        let v = AttestationVerifier::with_defaults();
        let report = AttestationReport::new(
            [0xAA; 32],
            Platform::Unknown,
            1000,
            2000,
            [0xBB; 32],
            [0xCC; 20],
        );
        let result = v.verify(&report, 1500);
        assert!(result.is_err());
        match result.unwrap_err() {
            ZeroIdTeeError::UnsupportedPlatform(_) => {}
            other => panic!("expected UnsupportedPlatform, got: {other}"),
        }
    }

    #[test]
    fn verify_no_policy() {
        let v = AttestationVerifier::new();
        let report = sgx_report(1000, 2000);
        let result = v.verify(&report, 1500);
        assert!(result.is_err());
    }

    #[test]
    fn verify_expired() {
        let v = AttestationVerifier::with_defaults();
        let report = sgx_report(1000, 2000);
        let result = v.verify(&report, 3000);
        assert!(result.is_err());
    }

    #[test]
    fn verify_untrusted_measurement() {
        let mut v = AttestationVerifier::with_defaults();
        v.add_trusted_measurement([0xFF; 32]);
        let report = sgx_report(1000, 2000);
        let result = v.verify(&report, 1500);
        assert!(result.is_err());
    }

    #[test]
    fn verify_no_trusted_measurements_accepts_any() {
        let v = AttestationVerifier::with_defaults();
        let report = sgx_report(1000, 2000);
        let result = v.verify(&report, 1500).unwrap();
        assert!(result.is_valid);
    }

    #[test]
    fn verifier_debug() {
        let v = AttestationVerifier::new();
        let dbg = format!("{v:?}");
        assert!(dbg.contains("AttestationVerifier"));
    }

    #[test]
    fn verifier_clone() {
        let v = AttestationVerifier::with_defaults();
        let v2 = v.clone();
        assert_eq!(v.policy_count(), v2.policy_count());
    }
}
