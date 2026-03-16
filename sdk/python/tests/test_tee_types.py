"""Tests for zeroid.tee.types."""

from zeroid.tee.types import AttestationEvidence, TEEPlatform


class TestTEEPlatform:
    def test_values(self) -> None:
        assert TEEPlatform.SGX.value == "sgx"
        assert TEEPlatform.TDX.value == "tdx"
        assert TEEPlatform.SEV_SNP.value == "sev-snp"
        assert TEEPlatform.TRUSTZONE.value == "trustzone"
        assert TEEPlatform.NITRO.value == "nitro"
        assert TEEPlatform.UNKNOWN.value == "unknown"

    def test_from_string(self) -> None:
        assert TEEPlatform.from_string("sgx") == TEEPlatform.SGX
        assert TEEPlatform.from_string("tdx") == TEEPlatform.TDX
        assert TEEPlatform.from_string("sev-snp") == TEEPlatform.SEV_SNP
        assert TEEPlatform.from_string("trustzone") == TEEPlatform.TRUSTZONE
        assert TEEPlatform.from_string("nitro") == TEEPlatform.NITRO

    def test_from_string_case_insensitive(self) -> None:
        assert TEEPlatform.from_string("SGX") == TEEPlatform.SGX
        assert TEEPlatform.from_string("  TDX  ") == TEEPlatform.TDX

    def test_from_string_unknown(self) -> None:
        assert TEEPlatform.from_string("invalid") == TEEPlatform.UNKNOWN
        assert TEEPlatform.from_string("") == TEEPlatform.UNKNOWN


class TestAttestationEvidence:
    def test_defaults(self) -> None:
        ev = AttestationEvidence(
            platform=TEEPlatform.SGX,
            enclave_hash="abc123",
        )
        assert ev.report_data == ""
        assert ev.timestamp == ""
        assert ev.signature == ""
        assert ev.certificates == []
        assert ev.pcr_values == {}

    def test_is_complete_true(self) -> None:
        ev = AttestationEvidence(
            platform=TEEPlatform.SGX,
            enclave_hash="abc123",
            signature="sig_value",
            certificates=["cert1"],
        )
        assert ev.is_complete() is True

    def test_is_complete_missing_hash(self) -> None:
        ev = AttestationEvidence(
            platform=TEEPlatform.SGX,
            enclave_hash="",
            signature="sig",
            certificates=["cert"],
        )
        assert ev.is_complete() is False

    def test_is_complete_missing_signature(self) -> None:
        ev = AttestationEvidence(
            platform=TEEPlatform.SGX,
            enclave_hash="abc",
            signature="",
            certificates=["cert"],
        )
        assert ev.is_complete() is False

    def test_is_complete_missing_certificates(self) -> None:
        ev = AttestationEvidence(
            platform=TEEPlatform.SGX,
            enclave_hash="abc",
            signature="sig",
            certificates=[],
        )
        assert ev.is_complete() is False

    def test_with_pcr_values(self) -> None:
        ev = AttestationEvidence(
            platform=TEEPlatform.NITRO,
            enclave_hash="abc",
            pcr_values={0: "value0", 1: "value1"},
        )
        assert ev.pcr_values[0] == "value0"
