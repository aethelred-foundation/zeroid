"""Tests for zeroid.credential.issuer."""

import pytest

from zeroid.credential.issuer import CredentialIssuer
from zeroid.credential.schema import SchemaDefinition, SchemaRegistry
from zeroid.credential.types import CredentialStatus


ISSUER_DID = "did:zero:" + "aa" * 20
SUBJECT_DID = "did:zero:" + "bb" * 20


class TestCredentialIssuer:
    def test_issue_basic(self) -> None:
        issuer = CredentialIssuer(ISSUER_DID, "signing-key-hex")
        vc = issuer.issue(
            subject_did=SUBJECT_DID,
            credential_type="KYCCredential",
            claims={"name": "Alice", "country": "US"},
        )
        assert vc.issuer == ISSUER_DID
        assert vc.credential_subject["id"] == SUBJECT_DID
        assert vc.credential_subject["name"] == "Alice"
        assert "KYCCredential" in vc.type
        assert "VerifiableCredential" in vc.type
        assert vc.credential_status == CredentialStatus.ACTIVE
        assert vc.id.startswith("urn:uuid:")
        assert vc.issuance_date != ""
        assert vc.proof["type"] == "EcdsaSecp256k1Signature2019"
        assert "proofValue" in vc.proof
        assert "merkleRoot" in vc.proof

    def test_issue_with_expiration(self) -> None:
        issuer = CredentialIssuer(ISSUER_DID, "key")
        vc = issuer.issue(
            subject_did=SUBJECT_DID,
            credential_type="TestCred",
            claims={"x": 1},
            expiration_date="2030-01-01T00:00:00Z",
        )
        assert vc.expiration_date == "2030-01-01T00:00:00Z"

    def test_issue_with_schema_validation(self, schema_registry: SchemaRegistry) -> None:
        issuer = CredentialIssuer(ISSUER_DID, "key", schema_registry)
        vc = issuer.issue(
            subject_did=SUBJECT_DID,
            credential_type="KYCCredential",
            claims={"id": "123", "name": "Bob", "country": "UK"},
            schema_id="kyc-v1",
        )
        assert vc.credential_schema == "kyc-v1"

    def test_issue_schema_validation_fails(self, schema_registry: SchemaRegistry) -> None:
        issuer = CredentialIssuer(ISSUER_DID, "key", schema_registry)
        with pytest.raises(ValueError, match="Schema validation failed"):
            issuer.issue(
                subject_did=SUBJECT_DID,
                credential_type="KYCCredential",
                claims={"invalid_field": "bad"},
                schema_id="kyc-v1",
            )

    def test_issue_verifiable_credential_type(self) -> None:
        issuer = CredentialIssuer(ISSUER_DID, "key")
        vc = issuer.issue(
            subject_did=SUBJECT_DID,
            credential_type="VerifiableCredential",
            claims={"x": 1},
        )
        assert vc.type == ["VerifiableCredential"]

    def test_issue_no_schema_registry(self) -> None:
        issuer = CredentialIssuer(ISSUER_DID, "key")
        # schema_id provided but no registry — should just issue without validation
        vc = issuer.issue(
            subject_did=SUBJECT_DID,
            credential_type="Test",
            claims={"a": "b"},
            schema_id="some-schema",
        )
        assert vc.credential_schema == "some-schema"
