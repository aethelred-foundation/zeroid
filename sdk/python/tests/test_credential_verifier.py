"""Tests for zeroid.credential.verifier."""

from zeroid.credential.issuer import CredentialIssuer
from zeroid.credential.schema import SchemaDefinition, SchemaRegistry
from zeroid.credential.types import CredentialStatus, VerifiableCredential
from zeroid.credential.verifier import CredentialVerifier, VerificationResult

ISSUER_DID = "did:zero:" + "aa" * 20
SUBJECT_DID = "did:zero:" + "bb" * 20
SIGNING_KEY = "issuer-signing-key"


def _make_valid_vc(**overrides: object) -> VerifiableCredential:
    issue_kwargs = {
        "subject_did": SUBJECT_DID,
        "credential_type": "TestCredential",
        "claims": {"name": "Alice"},
        "schema_id": str(overrides.pop("credential_schema", "")),
        "expiration_date": str(overrides.pop("expiration_date", "")),
    }
    vc = CredentialIssuer(ISSUER_DID, SIGNING_KEY).issue(**issue_kwargs)
    for key, value in overrides.items():
        setattr(vc, key, value)
    return vc


def _make_verifier(
    schema_registry: SchemaRegistry | None = None,
) -> CredentialVerifier:
    return CredentialVerifier(
        schema_registry=schema_registry,
        trusted_issuer_keys={ISSUER_DID: SIGNING_KEY},
    )


class TestCredentialVerifier:
    def test_verify_valid(self) -> None:
        verifier = _make_verifier()
        result = verifier.verify(_make_valid_vc())
        assert result.valid is True
        assert result.errors == []

    def test_missing_id(self) -> None:
        verifier = _make_verifier()
        result = verifier.verify(_make_valid_vc(id=""))
        assert result.valid is False
        assert any("ID" in e for e in result.errors)

    def test_missing_issuer(self) -> None:
        verifier = _make_verifier()
        result = verifier.verify(_make_valid_vc(issuer=""))
        assert result.valid is False
        assert any("issuer" in e.lower() for e in result.errors)

    def test_missing_issuance_date(self) -> None:
        verifier = _make_verifier()
        result = verifier.verify(_make_valid_vc(issuance_date=""))
        assert result.valid is False

    def test_revoked(self) -> None:
        verifier = _make_verifier()
        result = verifier.verify(
            _make_valid_vc(credential_status=CredentialStatus.REVOKED)
        )
        assert result.valid is False
        assert any("revoked" in e.lower() for e in result.errors)

    def test_suspended_warning(self) -> None:
        verifier = _make_verifier()
        result = verifier.verify(
            _make_valid_vc(credential_status=CredentialStatus.SUSPENDED)
        )
        assert result.valid is True
        assert any("suspended" in w.lower() for w in result.warnings)

    def test_expired_status(self) -> None:
        verifier = _make_verifier()
        result = verifier.verify(
            _make_valid_vc(credential_status=CredentialStatus.EXPIRED)
        )
        assert result.valid is False

    def test_expired_by_date(self) -> None:
        verifier = _make_verifier()
        result = verifier.verify(
            _make_valid_vc(expiration_date="2020-01-01T00:00:00+00:00")
        )
        assert result.valid is False
        assert any("expired" in e.lower() for e in result.errors)

    def test_invalid_expiration_format(self) -> None:
        verifier = _make_verifier()
        result = verifier.verify(
            _make_valid_vc(expiration_date="not-a-date")
        )
        assert result.valid is False
        assert any("format" in e.lower() for e in result.errors)

    def test_future_expiration_valid(self) -> None:
        verifier = _make_verifier()
        result = verifier.verify(
            _make_valid_vc(expiration_date="2099-01-01T00:00:00+00:00")
        )
        assert result.valid is True

    def test_missing_proof(self) -> None:
        verifier = _make_verifier()
        result = verifier.verify(_make_valid_vc(proof={}))
        assert result.valid is False
        assert any("proof" in e.lower() for e in result.errors)

    def test_missing_proof_value(self) -> None:
        verifier = _make_verifier()
        result = verifier.verify(
            _make_valid_vc(proof={"verificationMethod": "x"})
        )
        assert result.valid is False
        assert any("proof value" in e.lower() for e in result.errors)

    def test_missing_verification_method_in_proof(self) -> None:
        verifier = _make_verifier()
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
        verifier = _make_verifier(schema_registry=sr)
        vc = _make_valid_vc(
            credential_schema="s1",
            credential_subject={"id": "did:zero:abc"},
        )
        result = verifier.verify(vc)
        assert result.valid is False
        assert any("name" in e for e in result.errors)

    def test_schema_not_found_warning(self) -> None:
        sr = SchemaRegistry()
        verifier = _make_verifier(schema_registry=sr)
        vc = _make_valid_vc(credential_schema="unknown-schema")
        result = verifier.verify(vc)
        assert result.valid is True
        assert any("not found" in w for w in result.warnings)

    def test_expired_by_naive_date(self) -> None:
        """Expiration date without timezone info (naive) should still be handled."""
        verifier = _make_verifier()
        result = verifier.verify(
            _make_valid_vc(expiration_date="2020-01-01T00:00:00")
        )
        assert result.valid is False
        assert any("expired" in e.lower() for e in result.errors)

    def test_no_schema_registry_skips(self) -> None:
        verifier = _make_verifier()
        vc = _make_valid_vc(credential_schema="some-schema")
        result = verifier.verify(vc)
        assert result.valid is True

    def test_rejects_untrusted_issuer(self) -> None:
        verifier = CredentialVerifier()
        result = verifier.verify(_make_valid_vc())
        assert result.valid is False
        assert any("trusted" in e.lower() for e in result.errors)

    def test_rejects_relabelled_issuer(self) -> None:
        verifier = _make_verifier()
        result = verifier.verify(_make_valid_vc(issuer="did:zero:evil"))
        assert result.valid is False
        assert any("verification method" in e.lower() for e in result.errors)

    def test_rejects_tampered_subject(self) -> None:
        verifier = _make_verifier()
        vc = _make_valid_vc()
        vc.credential_subject["name"] = "Mallory"
        result = verifier.verify(vc)
        assert result.valid is False
        assert any("subject" in e.lower() for e in result.errors)

    def test_rejects_tampered_proof_value(self) -> None:
        verifier = _make_verifier()
        vc = _make_valid_vc()
        vc.proof["proofValue"] = "00" * 32
        result = verifier.verify(vc)
        assert result.valid is False
        assert any("signature" in e.lower() for e in result.errors)
