"""Tests for zeroid.credential.types."""

from zeroid.credential.types import (
    CredentialStatus,
    VerifiableCredential,
    VerifiablePresentation,
)


class TestCredentialStatus:
    def test_values(self) -> None:
        assert CredentialStatus.ACTIVE.value == "active"
        assert CredentialStatus.REVOKED.value == "revoked"
        assert CredentialStatus.SUSPENDED.value == "suspended"
        assert CredentialStatus.EXPIRED.value == "expired"


class TestVerifiableCredential:
    def test_defaults(self) -> None:
        vc = VerifiableCredential()
        assert "VerifiableCredential" in vc.type
        assert len(vc.context) == 2

    def test_to_dict(self) -> None:
        vc = VerifiableCredential(
            id="cred-1",
            issuer="did:zero:abc",
            issuance_date="2025-01-01T00:00:00Z",
            credential_subject={"id": "did:zero:def", "name": "Test"},
            proof={"proofValue": "sig"},
            credential_schema="schema-1",
        )
        d = vc.to_dict()
        assert d["id"] == "cred-1"
        assert d["issuer"] == "did:zero:abc"
        assert d["credentialStatus"] == "active"
        assert d["credentialSchema"] == "schema-1"

    def test_to_dict_without_optional(self) -> None:
        vc = VerifiableCredential(
            id="cred-2",
            issuer="did:zero:abc",
            issuance_date="2025-01-01T00:00:00Z",
        )
        d = vc.to_dict()
        assert "expirationDate" not in d
        assert "credentialSchema" not in d

    def test_to_dict_with_expiration(self) -> None:
        vc = VerifiableCredential(
            id="cred-3",
            expiration_date="2026-01-01T00:00:00Z",
        )
        d = vc.to_dict()
        assert d["expirationDate"] == "2026-01-01T00:00:00Z"


class TestVerifiablePresentation:
    def test_defaults(self) -> None:
        vp = VerifiablePresentation()
        assert "VerifiablePresentation" in vp.type

    def test_to_dict(self) -> None:
        vc = VerifiableCredential(id="c1")
        vp = VerifiablePresentation(
            id="vp-1",
            holder="did:zero:abc",
            verifiable_credential=[vc],
            proof={"proofValue": "sig"},
        )
        d = vp.to_dict()
        assert d["holder"] == "did:zero:abc"
        assert len(d["verifiableCredential"]) == 1
        assert d["verifiableCredential"][0]["id"] == "c1"

    def test_to_dict_empty(self) -> None:
        vp = VerifiablePresentation()
        d = vp.to_dict()
        assert d["verifiableCredential"] == []
