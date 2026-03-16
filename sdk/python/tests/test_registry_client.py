"""Tests for zeroid.registry.client."""

from zeroid.registry.client import InMemoryRegistryClient
from zeroid.registry.types import AttestationReport, CredentialRecord, Identity


class TestInMemoryRegistryClient:
    def test_register_and_get_identity(self) -> None:
        client = InMemoryRegistryClient()
        identity = Identity(address="aabb", public_key_hex="ccdd")
        assert client.register_identity(identity) is True
        result = client.get_identity("aabb")
        assert result is identity

    def test_get_identity_case_insensitive(self) -> None:
        client = InMemoryRegistryClient()
        identity = Identity(address="AABB", public_key_hex="ccdd")
        client.register_identity(identity)
        assert client.get_identity("aabb") is identity

    def test_get_identity_not_found(self) -> None:
        client = InMemoryRegistryClient()
        assert client.get_identity("missing") is None

    def test_register_duplicate_fails(self) -> None:
        client = InMemoryRegistryClient()
        identity = Identity(address="aabb", public_key_hex="ccdd")
        assert client.register_identity(identity) is True
        assert client.register_identity(identity) is False

    def test_store_and_get_credential(self) -> None:
        client = InMemoryRegistryClient()
        record = CredentialRecord(
            credential_id="cred-1",
            issuer_address="issuer",
            holder_address="holder",
            credential_type="KYC",
        )
        assert client.store_credential(record) is True
        result = client.get_credential("cred-1")
        assert result is record

    def test_get_credential_not_found(self) -> None:
        client = InMemoryRegistryClient()
        assert client.get_credential("missing") is None

    def test_store_credential_overwrite(self) -> None:
        client = InMemoryRegistryClient()
        r1 = CredentialRecord(
            credential_id="c1", issuer_address="i", holder_address="h",
            credential_type="KYC",
        )
        r2 = CredentialRecord(
            credential_id="c1", issuer_address="i2", holder_address="h2",
            credential_type="AML",
        )
        client.store_credential(r1)
        client.store_credential(r2)
        assert client.get_credential("c1") is r2

    def test_store_and_get_attestation(self) -> None:
        client = InMemoryRegistryClient()
        report = AttestationReport(
            report_id="r1", platform="sgx", enclave_hash="abc"
        )
        assert client.store_attestation(report) is True
        result = client.get_attestation("r1")
        assert result is report

    def test_get_attestation_not_found(self) -> None:
        client = InMemoryRegistryClient()
        assert client.get_attestation("missing") is None
