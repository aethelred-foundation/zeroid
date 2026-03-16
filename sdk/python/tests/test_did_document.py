"""Tests for zeroid.did.document."""

from zeroid.did.document import DIDDocument, DIDStatus, VerificationMethod, ServiceEndpoint


class TestDIDDocument:
    def test_default_context(self) -> None:
        doc = DIDDocument(id="did:zero:abc")
        assert "https://www.w3.org/ns/did/v1" in doc.context

    def test_is_active(self) -> None:
        doc = DIDDocument(id="did:zero:abc", status=DIDStatus.ACTIVE)
        assert doc.is_active() is True

    def test_is_not_active_deactivated(self) -> None:
        doc = DIDDocument(id="did:zero:abc", status=DIDStatus.DEACTIVATED)
        assert doc.is_active() is False

    def test_is_not_active_suspended(self) -> None:
        doc = DIDDocument(id="did:zero:abc", status=DIDStatus.SUSPENDED)
        assert doc.is_active() is False

    def test_to_dict(self) -> None:
        vm = VerificationMethod(
            id="did:zero:abc#key-1",
            type="EcdsaSecp256k1VerificationKey2019",
            controller="did:zero:abc",
            public_key_hex="aabb",
        )
        svc = ServiceEndpoint(
            id="did:zero:abc#svc",
            type="TestService",
            endpoint="https://example.com",
        )
        doc = DIDDocument(
            id="did:zero:abc",
            verification_methods=[vm],
            authentication=["did:zero:abc#key-1"],
            assertion_method=["did:zero:abc#key-1"],
            services=[svc],
            status=DIDStatus.ACTIVE,
            created="2025-01-01T00:00:00Z",
            updated="2025-06-01T00:00:00Z",
        )
        d = doc.to_dict()
        assert d["id"] == "did:zero:abc"
        assert d["status"] == "active"
        assert len(d["verificationMethod"]) == 1
        assert d["verificationMethod"][0]["publicKeyHex"] == "aabb"
        assert len(d["service"]) == 1
        assert d["service"][0]["serviceEndpoint"] == "https://example.com"
        assert d["created"] == "2025-01-01T00:00:00Z"
        assert d["updated"] == "2025-06-01T00:00:00Z"

    def test_to_dict_no_timestamps(self) -> None:
        doc = DIDDocument(id="did:zero:abc")
        d = doc.to_dict()
        assert "created" not in d
        assert "updated" not in d


class TestDIDStatus:
    def test_values(self) -> None:
        assert DIDStatus.ACTIVE.value == "active"
        assert DIDStatus.DEACTIVATED.value == "deactivated"
        assert DIDStatus.SUSPENDED.value == "suspended"


class TestVerificationMethod:
    def test_frozen(self) -> None:
        vm = VerificationMethod(
            id="test", type="test", controller="test", public_key_hex="aa"
        )
        assert vm.id == "test"


class TestServiceEndpoint:
    def test_frozen(self) -> None:
        svc = ServiceEndpoint(id="s1", type="t1", endpoint="http://x")
        assert svc.endpoint == "http://x"
