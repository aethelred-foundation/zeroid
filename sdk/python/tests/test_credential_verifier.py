"""Tests for zeroid.credential.verifier."""

from zeroid.credential.schema import SchemaDefinition, SchemaRegistry
from zeroid.credential.types import CredentialStatus, VerifiableCredential
from zeroid.credential.verifier import CredentialVerifier, VerificationResult


def _make_valid_vc(**overrides: object) -> VerifiableCredential:
    defaults = dict(
        id="urn:uuid:test",
        issuer="did:zero:" + "aa" * 20,
        issuance_date="2025-01-01T00:00:00+00:00",
        proof={"proofValue": "abc", "verificationMethod": "did:zero:aa#key-1"},
        credential_status=CredentialStatus.ACTIVE,
    )
    defaults.update(overrides)
    return VerifiableCredential(**defaults)  # type: ignore[arg-type]


class TestCredentialVerifier:
    def test_verify_valid(self) -> None:
        verifier = CredentialVerifier()
        result = verifier.verify(_make_valid_vc())
        assert result.valid is True
        assert result.errors == []

    def test_missing_id(self) -> None:
        verifier = CredentialVerifier()
        result = verifier.verify(_make_valid_vc(id=""))
        assert result.valid is False
        assert any("ID" in e for e in result.errors)

    def test_missing_issuer(self) -> None:
        verifier = CredentialVerifier()
        result = verifier.verify(_make_valid_vc(issuer=""))
        assert result.valid is False
        assert any("issuer" in e.lower() for e in result.errors)

    def test_missing_issuance_date(self) -> None:
        verifier = CredentialVerifier()
        result = verifier.verify(_make_valid_vc(issuance_date=""))
        assert result.valid is False

    def test_revoked(self) -> None:
        verifier = CredentialVerifier()
        result = verifier.verify(
            _make_valid_vc(credential_status=CredentialStatus.REVOKED)
        )
        assert result.valid is False
        assert any("revoked" in e.lower() for e in result.errors)

    def test_suspended_warning(self) -> None:
        verifier = CredentialVerifier()
        result = verifier.verify(
            _make_valid_vc(credential_status=CredentialStatus.SUSPENDED)
        )
        assert result.valid is True
        assert any("suspended" in w.lower() for w in result.warnings)

    def test_expired_status(self) -> None:
        verifier = CredentialVerifier()
        result = verifier.verify(
            _make_valid_vc(credential_status=CredentialStatus.EXPIRED)
        )
        assert result.valid is False

    def test_expired_by_date(self) -> None:
        verifier = CredentialVerifier()
        result = verifier.verify(
            _make_valid_vc(expiration_date="2020-01-01T00:00:00+00:00")
        )
        assert result.valid is False
        assert any("expired" in e.lower() for e in result.errors)

    def test_invalid_expiration_format(self) -> None:
        verifier = CredentialVerifier()
        result = verifier.verify(
            _make_valid_vc(expiration_date="not-a-date")
        )
        assert result.valid is False
        assert any("format" in e.lower() for e in result.errors)

    def test_future_expiration_valid(self) -> None:
        verifier = CredentialVerifier()
        result = verifier.verify(
            _make_valid_vc(expiration_date="2099-01-01T00:00:00+00:00")
        )
        assert result.valid is True

    def test_missing_proof(self) -> None:
        verifier = CredentialVerifier()
        result = verifier.verify(_make_valid_vc(proof={}))
        assert result.valid is False
        assert any("proof" in e.lower() for e in result.errors)

    def test_missing_proof_value(self) -> None:
        verifier = CredentialVerifier()
        result = verifier.verify(
            _make_valid_vc(proof={"verificationMethod": "x"})
        )
        assert result.valid is False
        assert any("proof value" in e.lower() for e in result.errors)

    def test_missing_verification_method_in_proof(self) -> None:
        verifier = CredentialVerifier()
        result = verifier.verify(
            _make_valid_vc(proof={"proofValue": "sig"})
        )
        assert result.valid is False
        assert any("verification method" in e.lower() for e in result.errors)

    def test_schema_validation(self) -> None:
        sr = SchemaRegistry()
        sr.register(SchemaDefinition(
            id="s1", name="S1", version="1.0",
            required_fields=["id", "name"],
            field_types={"name": "str"},
        ))
        verifier = CredentialVerifier(schema_registry=sr)
        vc = _make_valid_vc(
            credential_schema="s1",
            credential_subject={"id": "did:zero:abc"},
        )
        result = verifier.verify(vc)
        assert result.valid is False
        assert any("name" in e for e in result.errors)

    def test_schema_not_found_warning(self) -> None:
        sr = SchemaRegistry()
        verifier = CredentialVerifier(schema_registry=sr)
        vc = _make_valid_vc(credential_schema="unknown-schema")
        result = verifier.verify(vc)
        assert result.valid is True
        assert any("not found" in w for w in result.warnings)

    def test_expired_by_naive_date(self) -> None:
        """Expiration date without timezone info (naive) should still be handled."""
        verifier = CredentialVerifier()
        result = verifier.verify(
            _make_valid_vc(expiration_date="2020-01-01T00:00:00")
        )
        assert result.valid is False
        assert any("expired" in e.lower() for e in result.errors)

    def test_no_schema_registry_skips(self) -> None:
        verifier = CredentialVerifier()
        vc = _make_valid_vc(credential_schema="some-schema")
        result = verifier.verify(vc)
        assert result.valid is True
