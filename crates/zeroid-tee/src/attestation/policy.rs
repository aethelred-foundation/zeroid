/// Platform-specific attestation policies.
///
/// Each TEE platform can define minimum freshness windows, required features,
/// and allowed enclave measurements.
use crate::attestation::report::{AttestationReport, Platform};
use crate::error::{Result, ZeroIdTeeError};

/// Policy configuration for a particular TEE platform.
#[derive(Debug, Clone, PartialEq)]
pub struct AttestationPolicy {
    /// The platform this policy applies to.
    pub platform: Platform,
    /// Maximum age of an attestation report in seconds.
    pub max_report_age_secs: u64,
    /// Minimum validity window (expires_at - attested_at) in seconds.
    pub min_validity_window_secs: u64,
    /// Allowed enclave measurements (empty = allow all).
    pub allowed_measurements: Vec<[u8; 32]>,
    /// Whether the platform requires debug mode to be disabled.
    pub require_production_mode: bool,
}

impl AttestationPolicy {
    /// Create a new policy with sensible defaults for `platform`.
    pub fn new(platform: Platform) -> Self {
        let (max_age, min_window) = match platform {
            Platform::IntelSGX => (3600, 300), // 1 hour max age, 5 min window
            Platform::AMDSEV => (7200, 600),   // 2 hours, 10 min
            Platform::ArmTrustZone => (3600, 300), // 1 hour, 5 min
            Platform::Unknown => (1800, 60),   // strict for unknown
        };
        Self {
            platform,
            max_report_age_secs: max_age,
            min_validity_window_secs: min_window,
            allowed_measurements: Vec::new(),
            require_production_mode: true,
        }
    }

    /// Add an allowed enclave measurement hash.
    pub fn allow_measurement(&mut self, measurement: [u8; 32]) {
        if !self.allowed_measurements.contains(&measurement) {
            self.allowed_measurements.push(measurement);
        }
    }

    /// Evaluate the policy against an attestation report.
    ///
    /// `now` is the current unix timestamp.
    ///
    /// Returns `Ok(())` if the report satisfies all policy constraints.
    pub fn evaluate(&self, report: &AttestationReport, now: u64) -> Result<()> {
        // Platform must match
        if report.platform != self.platform {
            return Err(ZeroIdTeeError::InvalidAttestation(format!(
                "policy is for {:?} but report is for {:?}",
                self.platform, report.platform
            )));
        }

        // Report must not be expired
        if report.is_expired(now) {
            return Err(ZeroIdTeeError::AttestationExpired {
                expired_at: report.expires_at,
                checked_at: now,
            });
        }

        // Check report age
        if now > report.attested_at && (now - report.attested_at) > self.max_report_age_secs {
            return Err(ZeroIdTeeError::InvalidAttestation(format!(
                "report is {} seconds old, max allowed is {}",
                now - report.attested_at,
                self.max_report_age_secs
            )));
        }

        // Check validity window
        let window = report.expires_at.saturating_sub(report.attested_at);
        if window < self.min_validity_window_secs {
            return Err(ZeroIdTeeError::InvalidAttestation(format!(
                "validity window {window}s is below minimum {}s",
                self.min_validity_window_secs
            )));
        }

        // Check measurement allowlist
        if !self.allowed_measurements.is_empty()
            && !self.allowed_measurements.contains(&report.enclave_hash)
        {
            return Err(ZeroIdTeeError::MeasurementMismatch {
                expected: self.allowed_measurements[0],
                actual: report.enclave_hash,
            });
        }

        Ok(())
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
    fn default_policies_per_platform() {
        let sgx = AttestationPolicy::new(Platform::IntelSGX);
        assert_eq!(sgx.max_report_age_secs, 3600);
        assert_eq!(sgx.min_validity_window_secs, 300);

        let sev = AttestationPolicy::new(Platform::AMDSEV);
        assert_eq!(sev.max_report_age_secs, 7200);

        let tz = AttestationPolicy::new(Platform::ArmTrustZone);
        assert_eq!(tz.max_report_age_secs, 3600);

        let unk = AttestationPolicy::new(Platform::Unknown);
        assert_eq!(unk.max_report_age_secs, 1800);
    }

    #[test]
    fn evaluate_valid_report() {
        let policy = AttestationPolicy::new(Platform::IntelSGX);
        let report = sgx_report(1000, 2000);
        assert!(policy.evaluate(&report, 1500).is_ok());
    }

    #[test]
    fn evaluate_expired_report() {
        let policy = AttestationPolicy::new(Platform::IntelSGX);
        let report = sgx_report(1000, 2000);
        let result = policy.evaluate(&report, 2001);
        assert!(result.is_err());
        match result.unwrap_err() {
            ZeroIdTeeError::AttestationExpired { .. } => {}
            other => panic!("expected AttestationExpired, got: {other}"),
        }
    }

    #[test]
    fn evaluate_too_old_report() {
        let policy = AttestationPolicy::new(Platform::IntelSGX);
        // attested_at = 0, expires_at = 100000, now = 5000 => age = 5000 > 3600
        let report = sgx_report(0, 100_000);
        let result = policy.evaluate(&report, 5000);
        assert!(result.is_err());
    }

    #[test]
    fn evaluate_small_validity_window() {
        let mut policy = AttestationPolicy::new(Platform::IntelSGX);
        policy.min_validity_window_secs = 1000;
        let report = sgx_report(1000, 1100); // 100s window
        let result = policy.evaluate(&report, 1050);
        assert!(result.is_err());
    }

    #[test]
    fn evaluate_platform_mismatch() {
        let policy = AttestationPolicy::new(Platform::AMDSEV);
        let report = sgx_report(1000, 2000);
        let result = policy.evaluate(&report, 1500);
        assert!(result.is_err());
    }

    #[test]
    fn evaluate_measurement_allowlist_pass() {
        let mut policy = AttestationPolicy::new(Platform::IntelSGX);
        policy.allow_measurement([0xAA; 32]);
        let report = sgx_report(1000, 2000);
        assert!(policy.evaluate(&report, 1500).is_ok());
    }

    #[test]
    fn evaluate_measurement_allowlist_fail() {
        let mut policy = AttestationPolicy::new(Platform::IntelSGX);
        policy.allow_measurement([0xFF; 32]);
        let report = sgx_report(1000, 2000);
        let result = policy.evaluate(&report, 1500);
        assert!(result.is_err());
        match result.unwrap_err() {
            ZeroIdTeeError::MeasurementMismatch { .. } => {}
            other => panic!("expected MeasurementMismatch, got: {other}"),
        }
    }

    #[test]
    fn allow_measurement_deduplicates() {
        let mut policy = AttestationPolicy::new(Platform::IntelSGX);
        policy.allow_measurement([0xAA; 32]);
        policy.allow_measurement([0xAA; 32]);
        assert_eq!(policy.allowed_measurements.len(), 1);
    }

    #[test]
    fn policy_clone_eq() {
        let p = AttestationPolicy::new(Platform::IntelSGX);
        let p2 = p.clone();
        assert_eq!(p, p2);
    }

    #[test]
    fn policy_debug() {
        let p = AttestationPolicy::new(Platform::AMDSEV);
        let dbg = format!("{p:?}");
        assert!(dbg.contains("AttestationPolicy"));
    }

    #[test]
    fn evaluate_now_equals_attested_at() {
        let policy = AttestationPolicy::new(Platform::IntelSGX);
        let report = sgx_report(1000, 2000);
        assert!(policy.evaluate(&report, 1000).is_ok());
    }

    #[test]
    fn evaluate_now_just_before_expiry() {
        let policy = AttestationPolicy::new(Platform::IntelSGX);
        let report = sgx_report(1000, 2000);
        assert!(policy.evaluate(&report, 1999).is_ok());
    }
}
