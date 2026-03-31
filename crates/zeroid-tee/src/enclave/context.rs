/// Secure enclave execution context.
///
/// The [`EnclaveContext`] manages the lifecycle of a TEE session: initialising
/// the enclave, sealing/unsealing data, and executing credential operations
/// within the trusted boundary.
use crate::attestation::report::{AttestationReport, Platform};
use crate::crypto::hash::keccak256;
use crate::enclave::identity::EnclaveIdentity;
use crate::enclave::memory::{seal_simple, unseal_simple, SealedData};
use crate::error::{Result, ZeroIdTeeError};

/// State of the enclave context.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnclaveState {
    /// The enclave has not been initialised.
    Uninitialised,
    /// The enclave is initialised and ready for operations.
    Ready,
    /// The enclave has been shut down.
    Terminated,
}

/// A secure enclave execution context.
#[derive(Debug, Clone)]
pub struct EnclaveContext {
    /// Identity of this enclave.
    identity: EnclaveIdentity,
    /// Current state.
    state: EnclaveState,
    /// Sealing key derived from the enclave identity.
    sealing_key: [u8; 32],
    /// The TEE platform.
    platform: Platform,
    /// Monotonic counter for operation sequencing.
    operation_counter: u64,
}

impl EnclaveContext {
    /// Create a new enclave context (uninitialised).
    pub fn new(identity: EnclaveIdentity, platform: Platform) -> Self {
        let sealing_key = keccak256(&identity.fingerprint());
        Self {
            identity,
            state: EnclaveState::Uninitialised,
            sealing_key,
            platform,
            operation_counter: 0,
        }
    }

    /// Initialise the enclave, transitioning to [`EnclaveState::Ready`].
    pub fn initialise(&mut self) -> Result<()> {
        match self.state {
            EnclaveState::Uninitialised => {
                self.state = EnclaveState::Ready;
                Ok(())
            }
            EnclaveState::Ready => Err(ZeroIdTeeError::EnclaveError(
                "enclave already initialised".into(),
            )),
            EnclaveState::Terminated => Err(ZeroIdTeeError::EnclaveError(
                "cannot re-initialise terminated enclave".into(),
            )),
        }
    }

    /// Terminate the enclave.
    pub fn terminate(&mut self) -> Result<()> {
        match self.state {
            EnclaveState::Ready => {
                self.state = EnclaveState::Terminated;
                Ok(())
            }
            EnclaveState::Uninitialised => Err(ZeroIdTeeError::EnclaveError(
                "enclave not initialised".into(),
            )),
            EnclaveState::Terminated => Err(ZeroIdTeeError::EnclaveError(
                "enclave already terminated".into(),
            )),
        }
    }

    /// Return the current enclave state.
    pub fn state(&self) -> EnclaveState {
        self.state
    }

    /// Return a reference to the enclave identity.
    pub fn identity(&self) -> &EnclaveIdentity {
        &self.identity
    }

    /// Return the TEE platform.
    pub fn platform(&self) -> Platform {
        self.platform
    }

    /// Return the current operation counter.
    pub fn operation_counter(&self) -> u64 {
        self.operation_counter
    }

    /// Seal (encrypt) data using the enclave's sealing key.
    ///
    /// The enclave must be in the [`EnclaveState::Ready`] state.
    pub fn seal(&mut self, plaintext: &[u8]) -> Result<SealedData> {
        self.require_ready()?;
        self.operation_counter += 1;
        Ok(seal_simple(&self.sealing_key, plaintext))
    }

    /// Unseal (decrypt) data using the enclave's sealing key.
    ///
    /// The enclave must be in the [`EnclaveState::Ready`] state.
    pub fn unseal(&mut self, sealed: &SealedData) -> Result<Vec<u8>> {
        self.require_ready()?;
        self.operation_counter += 1;
        unseal_simple(&self.sealing_key, sealed)
    }

    /// Generate an attestation report for this enclave.
    ///
    /// `now` is the current unix timestamp; the report is valid for
    /// `validity_secs` seconds.
    pub fn generate_report(
        &mut self,
        report_data: &[u8],
        node_operator: [u8; 20],
        now: u64,
        validity_secs: u64,
    ) -> Result<AttestationReport> {
        self.require_ready()?;
        self.operation_counter += 1;
        let report_data_hash = keccak256(report_data);
        let mut report = AttestationReport::new(
            self.identity.mr_enclave,
            self.platform,
            now,
            now + validity_secs,
            report_data_hash,
            node_operator,
        );
        report.is_valid = true;
        Ok(report)
    }

    /// Execute a closure within the enclave context.
    ///
    /// Ensures the enclave is ready, increments the operation counter, and
    /// returns the result of `f`.
    pub fn execute<F, T>(&mut self, f: F) -> Result<T>
    where
        F: FnOnce(&EnclaveIdentity) -> Result<T>,
    {
        self.require_ready()?;
        self.operation_counter += 1;
        f(&self.identity)
    }

    /// Internal helper to check the enclave is in the Ready state.
    fn require_ready(&self) -> Result<()> {
        if self.state != EnclaveState::Ready {
            return Err(ZeroIdTeeError::EnclaveError(format!(
                "enclave is in {:?} state, expected Ready",
                self.state
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_identity() -> EnclaveIdentity {
        EnclaveIdentity::new([0xAA; 32], [0xBB; 32], 1, 1)
    }

    fn test_ctx() -> EnclaveContext {
        EnclaveContext::new(test_identity(), Platform::IntelSGX)
    }

    #[test]
    fn new_is_uninitialised() {
        let ctx = test_ctx();
        assert_eq!(ctx.state(), EnclaveState::Uninitialised);
        assert_eq!(ctx.operation_counter(), 0);
    }

    #[test]
    fn initialise_transitions_to_ready() {
        let mut ctx = test_ctx();
        ctx.initialise().unwrap();
        assert_eq!(ctx.state(), EnclaveState::Ready);
    }

    #[test]
    fn double_initialise_fails() {
        let mut ctx = test_ctx();
        ctx.initialise().unwrap();
        assert!(ctx.initialise().is_err());
    }

    #[test]
    fn terminate_from_ready() {
        let mut ctx = test_ctx();
        ctx.initialise().unwrap();
        ctx.terminate().unwrap();
        assert_eq!(ctx.state(), EnclaveState::Terminated);
    }

    #[test]
    fn terminate_uninitialised_fails() {
        let mut ctx = test_ctx();
        assert!(ctx.terminate().is_err());
    }

    #[test]
    fn double_terminate_fails() {
        let mut ctx = test_ctx();
        ctx.initialise().unwrap();
        ctx.terminate().unwrap();
        assert!(ctx.terminate().is_err());
    }

    #[test]
    fn reinitialise_after_terminate_fails() {
        let mut ctx = test_ctx();
        ctx.initialise().unwrap();
        ctx.terminate().unwrap();
        assert!(ctx.initialise().is_err());
    }

    #[test]
    fn seal_unseal_roundtrip() {
        let mut ctx = test_ctx();
        ctx.initialise().unwrap();
        let sealed = ctx.seal(b"secret").unwrap();
        let plaintext = ctx.unseal(&sealed).unwrap();
        assert_eq!(plaintext, b"secret");
    }

    #[test]
    fn seal_when_not_ready_fails() {
        let mut ctx = test_ctx();
        assert!(ctx.seal(b"x").is_err());
    }

    #[test]
    fn unseal_when_not_ready_fails() {
        let mut ctx = test_ctx();
        ctx.initialise().unwrap();
        let sealed = ctx.seal(b"x").unwrap();
        ctx.terminate().unwrap();
        assert!(ctx.unseal(&sealed).is_err());
    }

    #[test]
    fn generate_report_works() {
        let mut ctx = test_ctx();
        ctx.initialise().unwrap();
        let report = ctx
            .generate_report(b"payload", [0xDD; 20], 1000, 3600)
            .unwrap();
        assert!(report.is_valid);
        assert_eq!(report.platform, Platform::IntelSGX);
        assert_eq!(report.attested_at, 1000);
        assert_eq!(report.expires_at, 4600);
        assert_eq!(report.enclave_hash, [0xAA; 32]);
        assert_eq!(report.node_operator, [0xDD; 20]);
    }

    #[test]
    fn generate_report_when_not_ready_fails() {
        let mut ctx = test_ctx();
        assert!(ctx.generate_report(b"p", [0; 20], 0, 100).is_err());
    }

    #[test]
    fn execute_closure() {
        let mut ctx = test_ctx();
        ctx.initialise().unwrap();
        let result = ctx.execute(|id| Ok(id.mr_enclave)).unwrap();
        assert_eq!(result, [0xAA; 32]);
    }

    #[test]
    fn execute_when_not_ready_fails() {
        let mut ctx = test_ctx();
        let result = ctx.execute(|_| Ok(42u32));
        assert!(result.is_err());
    }

    #[test]
    fn operation_counter_increments() {
        let mut ctx = test_ctx();
        ctx.initialise().unwrap();
        assert_eq!(ctx.operation_counter(), 0);
        ctx.seal(b"a").unwrap();
        assert_eq!(ctx.operation_counter(), 1);
        ctx.seal(b"b").unwrap();
        assert_eq!(ctx.operation_counter(), 2);
    }

    #[test]
    fn identity_accessor() {
        let ctx = test_ctx();
        assert_eq!(ctx.identity().mr_enclave, [0xAA; 32]);
    }

    #[test]
    fn platform_accessor() {
        let ctx = test_ctx();
        assert_eq!(ctx.platform(), Platform::IntelSGX);
    }

    #[test]
    fn context_debug() {
        let ctx = test_ctx();
        let dbg = format!("{ctx:?}");
        assert!(dbg.contains("EnclaveContext"));
    }

    #[test]
    fn context_clone() {
        let ctx = test_ctx();
        let ctx2 = ctx.clone();
        assert_eq!(ctx.state(), ctx2.state());
    }

    #[test]
    fn enclave_state_copy() {
        let s = EnclaveState::Ready;
        let s2 = s;
        assert_eq!(s, s2);
    }
}
