"""Tests for zeroid.tee.attestation."""

from zeroid.tee.attestation import AttestationResult, AttestationVerifier
from zeroid.tee.types import AttestationEvidence, TEEPlatform


class TestAttestationResult:
    def test_defaults(self) -> None:
        r = AttestationResult(valid=True, platform=TEEPlatform.SGX)
        assert r.errors == []
        assert r.enclave_hash == ""


class TestAttestationVerifier:
    def test_verify_valid(self) -> None:
        verifier = AttestationVerifier()
        verifier.register_trusted_hash(TEEPlatform.SGX, "abc123")
        evidence = AttestationEvidence(
            platform=TEEPlatform.SGX,
            enclave_hash="abc123",
            signature="a1b2c3d4e5f6",
            certificates=["cert-data"],
        )
        result = verifier.verify(evidence)
        assert result.valid is True
        assert result.platform == TEEPlatform.SGX

    def test_verify_unknown_platform(self) -> None:
        verifier = AttestationVerifier()
        evidence = AttestationEvidence(
            platform=TEEPlatform.UNKNOWN,
            enclave_hash="abc",
            signature="sig123456",
            certificates=["cert"],
        )
        result = verifier.verify(evidence)
        assert result.valid is False
        assert any("Unknown" in e for e in result.errors)

    def test_verify_missing_enclave_hash(self) -> None:
        verifier = AttestationVerifier()
        evidence = AttestationEvidence(
            platform=TEEPlatform.SGX,
            enclave_hash="",
            signature="sig123456",
            certificates=["cert"],
        )
        result = verifier.verify(evidence)
        assert result.valid is False

    def test_verify_missing_signature(self) -> None:
        verifier = AttestationVerifier()
        evidence = AttestationEvidence(
            platform=TEEPlatform.SGX,
            enclave_hash="abc",
            signature="",
            certificates=["cert"],
        )
        result = verifier.verify(evidence)
        assert result.valid is False

    def test_verify_missing_certificates(self) -> None:
        verifier = AttestationVerifier()
        evidence = AttestationEvidence(
            platform=TEEPlatform.SGX,
            enclave_hash="abc",
            signature="sig123456",
            certificates=[],
        )
        result = verifier.verify(evidence)
        assert result.valid is False

    def test_verify_untrusted_hash(self) -> None:
        verifier = AttestationVerifier()
        verifier.register_trusted_hash(TEEPlatform.SGX, "trusted_hash")
        evidence = AttestationEvidence(
            platform=TEEPlatform.SGX,
            enclave_hash="untrusted_hash",
            signature="sig123456",
            certificates=["cert"],
        )
        result = verifier.verify(evidence)
        assert result.valid is False
        assert any("not in trusted" in e for e in result.errors)

    def test_verify_no_trusted_hashes_for_platform(self) -> None:
        verifier = AttestationVerifier()
        evidence = AttestationEvidence(
            platform=TEEPlatform.TDX,
            enclave_hash="abc",
            signature="sig123456",
            certificates=["cert"],
        )
        result = verifier.verify(evidence)
        assert result.valid is False
        assert any("No trusted" in e for e in result.errors)

    def test_verify_short_signature(self) -> None:
        verifier = AttestationVerifier()
        verifier.register_trusted_hash(TEEPlatform.SGX, "abc")
        evidence = AttestationEvidence(
            platform=TEEPlatform.SGX,
            enclave_hash="abc",
            signature="short",
            certificates=["cert"],
        )
        result = verifier.verify(evidence)
        assert result.valid is False
        assert any("too short" in e.lower() for e in result.errors)

    def test_register_trusted_hash_case_insensitive(self) -> None:
        verifier = AttestationVerifier()
        verifier.register_trusted_hash(TEEPlatform.SGX, "ABC123")
        evidence = AttestationEvidence(
            platform=TEEPlatform.SGX,
            enclave_hash="abc123",
            signature="sig123456789",
            certificates=["cert"],
        )
        result = verifier.verify(evidence)
        assert result.valid is True

    def test_compute_expected_hash(self) -> None:
        verifier = AttestationVerifier()
        h = verifier.compute_expected_hash(b"test code")
        assert len(h) == 64  # hex-encoded 32 bytes

    def test_register_multiple_hashes(self) -> None:
        verifier = AttestationVerifier()
        verifier.register_trusted_hash(TEEPlatform.SGX, "hash1")
        verifier.register_trusted_hash(TEEPlatform.SGX, "hash2")
        e1 = AttestationEvidence(
            platform=TEEPlatform.SGX, enclave_hash="hash1",
            signature="sig123456", certificates=["c"],
        )
        e2 = AttestationEvidence(
            platform=TEEPlatform.SGX, enclave_hash="hash2",
            signature="sig123456", certificates=["c"],
        )
        assert verifier.verify(e1).valid is True
        assert verifier.verify(e2).valid is True
