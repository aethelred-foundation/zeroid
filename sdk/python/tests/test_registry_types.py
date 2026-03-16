"""Tests for zeroid.registry.types."""

from zeroid.registry.types import (
    AttestationReport,
    CredentialRecord,
    Identity,
    IdentityStatus,
)


class TestIdentityStatus:
    def test_values(self) -> None:
        assert IdentityStatus.UNREGISTERED == 0
        assert IdentityStatus.ACTIVE == 1
        assert IdentityStatus.SUSPENDED == 2
        assert IdentityStatus.REVOKED == 3


class TestIdentity:
    def test_defaults(self) -> None:
        i = Identity(address="abc", public_key_hex="def")
        assert i.status == IdentityStatus.ACTIVE
        assert i.revoked is False
        assert i.suspended is False
        assert i.service_endpoint == ""
        assert i.metadata == {}
        assert i.did == ""
        assert i.created_at == ""
        assert i.updated_at == ""

    def test_full(self) -> None:
        i = Identity(
            address="abc",
            public_key_hex="def",
            did="did:zero:abc",
            status=IdentityStatus.SUSPENDED,
            created_at="2025-01-01",
            updated_at="2025-06-01",
            metadata={"key": "value"},
            revoked=False,
            suspended=True,
            service_endpoint="https://example.com",
        )
        assert i.suspended is True
        assert i.metadata["key"] == "value"


class TestCredentialRecord:
    def test_defaults(self) -> None:
        cr = CredentialRecord(
            credential_id="c1",
            issuer_address="issuer",
            holder_address="holder",
            credential_type="KYC",
        )
        assert cr.schema_id == ""
        assert cr.merkle_root == ""
        assert cr.revoked is False

    def test_full(self) -> None:
        cr = CredentialRecord(
            credential_id="c1",
            issuer_address="issuer",
            holder_address="holder",
            credential_type="KYC",
            schema_id="s1",
            merkle_root="abcd",
            issued_at="2025-01-01",
            expires_at="2026-01-01",
            revoked=True,
        )
        assert cr.revoked is True
        assert cr.expires_at == "2026-01-01"


class TestAttestationReport:
    def test_defaults(self) -> None:
        ar = AttestationReport(
            report_id="r1",
            platform="sgx",
            enclave_hash="abc123",
        )
        assert ar.timestamp == ""
        assert ar.verified is False
        assert ar.report_data == ""

    def test_full(self) -> None:
        ar = AttestationReport(
            report_id="r1",
            platform="sgx",
            enclave_hash="abc123",
            timestamp="2025-01-01",
            signer_address="signer",
            verified=True,
            report_data="deadbeef",
        )
        assert ar.verified is True
        assert ar.signer_address == "signer"
