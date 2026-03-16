"""Shared test fixtures for the ZeroID SDK test suite."""

from __future__ import annotations

import pytest

from zeroid.registry.client import InMemoryRegistryClient
from zeroid.registry.types import Identity
from zeroid.credential.schema import SchemaDefinition, SchemaRegistry


SAMPLE_ADDRESS = "ab" * 20
SAMPLE_DID = f"did:zero:{SAMPLE_ADDRESS}"
SAMPLE_PUBLIC_KEY = "cd" * 32


@pytest.fixture
def registry() -> InMemoryRegistryClient:
    """Create an in-memory registry with a sample identity."""
    reg = InMemoryRegistryClient()
    identity = Identity(
        address=SAMPLE_ADDRESS,
        public_key_hex=SAMPLE_PUBLIC_KEY,
        did=SAMPLE_DID,
        created_at="2025-01-01T00:00:00+00:00",
        service_endpoint="https://zeroid.example.com",
    )
    reg.register_identity(identity)
    return reg


@pytest.fixture
def schema_registry() -> SchemaRegistry:
    """Create a schema registry with a sample KYC schema."""
    sr = SchemaRegistry()
    sr.register(
        SchemaDefinition(
            id="kyc-v1",
            name="KYC Credential",
            version="1.0",
            required_fields=["id", "name", "country"],
            optional_fields=["dateOfBirth"],
            field_types={"name": "str", "country": "str", "dateOfBirth": "str"},
        )
    )
    return sr
