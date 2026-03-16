"""Tests for zeroid.credential.schema."""

import pytest

from zeroid.credential.schema import SchemaDefinition, SchemaRegistry


class TestSchemaDefinition:
    def test_creation(self) -> None:
        sd = SchemaDefinition(
            id="test-1",
            name="Test",
            version="1.0",
            required_fields=["name"],
        )
        assert sd.id == "test-1"
        assert sd.optional_fields == []
        assert sd.field_types == {}


class TestSchemaRegistry:
    def test_register_and_get(self) -> None:
        sr = SchemaRegistry()
        sd = SchemaDefinition(id="s1", name="S1", version="1.0", required_fields=["x"])
        sr.register(sd)
        assert sr.get("s1") is sd

    def test_get_not_found(self) -> None:
        sr = SchemaRegistry()
        assert sr.get("missing") is None

    def test_register_duplicate_raises(self) -> None:
        sr = SchemaRegistry()
        sd = SchemaDefinition(id="s1", name="S1", version="1.0", required_fields=[])
        sr.register(sd)
        with pytest.raises(ValueError, match="already registered"):
            sr.register(sd)

    def test_validate_valid(self, schema_registry: SchemaRegistry) -> None:
        errors = schema_registry.validate(
            "kyc-v1",
            {"id": "did:zero:abc", "name": "Test", "country": "US"},
        )
        assert errors == []

    def test_validate_missing_required(self, schema_registry: SchemaRegistry) -> None:
        errors = schema_registry.validate(
            "kyc-v1",
            {"id": "did:zero:abc"},
        )
        assert any("name" in e for e in errors)
        assert any("country" in e for e in errors)

    def test_validate_unknown_field(self, schema_registry: SchemaRegistry) -> None:
        errors = schema_registry.validate(
            "kyc-v1",
            {"id": "did:zero:abc", "name": "T", "country": "US", "extra": "bad"},
        )
        assert any("extra" in e for e in errors)

    def test_validate_wrong_type(self, schema_registry: SchemaRegistry) -> None:
        errors = schema_registry.validate(
            "kyc-v1",
            {"id": "did:zero:abc", "name": 123, "country": "US"},
        )
        assert any("name" in e and "str" in e for e in errors)

    def test_validate_schema_not_found(self) -> None:
        sr = SchemaRegistry()
        with pytest.raises(KeyError, match="not found"):
            sr.validate("missing", {})

    def test_validate_optional_field(self, schema_registry: SchemaRegistry) -> None:
        errors = schema_registry.validate(
            "kyc-v1",
            {"id": "did:zero:abc", "name": "T", "country": "US", "dateOfBirth": "2000-01-01"},
        )
        assert errors == []

    def test_list_schemas(self) -> None:
        sr = SchemaRegistry()
        assert sr.list_schemas() == []
        sr.register(SchemaDefinition(id="a", name="A", version="1", required_fields=[]))
        sr.register(SchemaDefinition(id="b", name="B", version="1", required_fields=[]))
        assert sorted(sr.list_schemas()) == ["a", "b"]
