"""Tests for zeroid.did.resolver."""

import pytest

from zeroid.did.document import DIDStatus
from zeroid.did.resolver import DIDResolver
from zeroid.registry.client import InMemoryRegistryClient
from zeroid.registry.types import Identity

ADDR = "ab" * 20
DID = f"did:zero:{ADDR}"


class TestDIDResolver:
    def test_resolve_active(self, registry: InMemoryRegistryClient) -> None:
        resolver = DIDResolver(registry)
        doc = resolver.resolve(DID)
        assert doc.id == DID
        assert doc.is_active()
        assert len(doc.verification_methods) == 1
        assert doc.verification_methods[0].controller == DID
        assert len(doc.authentication) == 1
        assert len(doc.services) == 1

    def test_resolve_not_found(self, registry: InMemoryRegistryClient) -> None:
        resolver = DIDResolver(registry)
        unknown = "did:zero:" + "ff" * 20
        with pytest.raises(KeyError, match="not found"):
            resolver.resolve(unknown)

    def test_resolve_invalid_did(self, registry: InMemoryRegistryClient) -> None:
        resolver = DIDResolver(registry)
        with pytest.raises(ValueError, match="Invalid"):
            resolver.resolve("did:zero:bad")

    def test_resolve_revoked(self) -> None:
        reg = InMemoryRegistryClient()
        reg.register_identity(Identity(
            address=ADDR,
            public_key_hex="cc" * 32,
            revoked=True,
            created_at="2025-01-01T00:00:00+00:00",
        ))
        resolver = DIDResolver(reg)
        doc = resolver.resolve(DID)
        assert doc.status == DIDStatus.DEACTIVATED
        assert not doc.is_active()

    def test_resolve_suspended(self) -> None:
        reg = InMemoryRegistryClient()
        reg.register_identity(Identity(
            address=ADDR,
            public_key_hex="cc" * 32,
            suspended=True,
            created_at="2025-01-01T00:00:00+00:00",
        ))
        resolver = DIDResolver(reg)
        doc = resolver.resolve(DID)
        assert doc.status == DIDStatus.SUSPENDED

    def test_resolve_no_service_endpoint(self) -> None:
        reg = InMemoryRegistryClient()
        reg.register_identity(Identity(
            address=ADDR,
            public_key_hex="cc" * 32,
            created_at="2025-01-01T00:00:00+00:00",
            service_endpoint="",
        ))
        resolver = DIDResolver(reg)
        doc = resolver.resolve(DID)
        assert len(doc.services) == 0
