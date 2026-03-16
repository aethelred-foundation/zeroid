"""JSON Schema validation for credential types.

Provides a schema registry that stores and validates credential subjects
against registered JSON-style schemas.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SchemaDefinition:
    """A credential schema definition.

    Attributes:
        id: Unique schema identifier.
        name: Human-readable name.
        version: Schema version string.
        required_fields: Fields that must be present.
        optional_fields: Fields that may be present.
        field_types: Mapping of field name to expected Python type name.
    """

    id: str
    name: str
    version: str
    required_fields: list[str]
    optional_fields: list[str] = field(default_factory=list)
    field_types: dict[str, str] = field(default_factory=dict)


class SchemaRegistry:
    """Registry for credential schemas.

    Stores schema definitions and validates credential subjects against them.
    """

    def __init__(self) -> None:
        """Initialize an empty schema registry."""
        self._schemas: dict[str, SchemaDefinition] = {}

    def register(self, schema: SchemaDefinition) -> None:
        """Register a schema definition.

        Args:
            schema: The schema to register.

        Raises:
            ValueError: If a schema with the same ID is already registered.
        """
        if schema.id in self._schemas:
            raise ValueError(f"Schema already registered: {schema.id}")
        self._schemas[schema.id] = schema

    def get(self, schema_id: str) -> SchemaDefinition | None:
        """Get a schema by ID.

        Args:
            schema_id: The schema identifier.

        Returns:
            The schema definition, or None if not found.
        """
        return self._schemas.get(schema_id)

    def validate(self, schema_id: str, subject: dict[str, Any]) -> list[str]:
        """Validate a credential subject against a schema.

        Args:
            schema_id: The schema identifier to validate against.
            subject: The credential subject data.

        Returns:
            List of validation error messages. Empty list means valid.

        Raises:
            KeyError: If the schema is not registered.
        """
        schema = self._schemas.get(schema_id)
        if schema is None:
            raise KeyError(f"Schema not found: {schema_id}")

        errors: list[str] = []

        # Check required fields
        for req in schema.required_fields:
            if req not in subject:
                errors.append(f"Missing required field: {req}")

        # Check for unknown fields
        known = set(schema.required_fields) | set(schema.optional_fields)
        for key in subject:
            if key not in known:
                errors.append(f"Unknown field: {key}")

        # Check field types
        _type_map: dict[str, type] = {
            "str": str,
            "int": int,
            "float": float,
            "bool": bool,
            "list": list,
            "dict": dict,
        }
        for field_name, type_name in schema.field_types.items():
            if field_name in subject:
                expected = _type_map.get(type_name)
                if expected and not isinstance(subject[field_name], expected):
                    errors.append(
                        f"Field {field_name} expected type {type_name}, "
                        f"got {type(subject[field_name]).__name__}"
                    )

        return errors

    def list_schemas(self) -> list[str]:
        """List all registered schema IDs.

        Returns:
            List of schema identifiers.
        """
        return list(self._schemas.keys())
