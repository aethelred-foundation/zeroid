"""W3C DID Document dataclasses.

Implements the core DID Document data model per the W3C DID Core specification
(https://www.w3.org/TR/did-core/).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class DIDStatus(Enum):
    """Status of a DID."""

    ACTIVE = "active"
    DEACTIVATED = "deactivated"
    SUSPENDED = "suspended"


@dataclass(frozen=True)
class VerificationMethod:
    """A verification method within a DID Document.

    Attributes:
        id: Fully qualified verification method ID.
        type: Cryptographic suite type.
        controller: DID of the controller.
        public_key_hex: Hex-encoded public key.
    """

    id: str
    type: str
    controller: str
    public_key_hex: str


@dataclass(frozen=True)
class ServiceEndpoint:
    """A service endpoint within a DID Document.

    Attributes:
        id: Fully qualified service ID.
        type: Service type identifier.
        endpoint: Service endpoint URI.
    """

    id: str
    type: str
    endpoint: str


@dataclass
class DIDDocument:
    """A W3C-compliant DID Document.

    Attributes:
        id: The DID this document describes.
        context: JSON-LD context URIs.
        verification_methods: List of verification methods.
        authentication: List of verification method IDs for authentication.
        assertion_method: List of verification method IDs for assertions.
        services: List of service endpoints.
        status: Current status of the DID.
        created: ISO 8601 creation timestamp.
        updated: ISO 8601 last-update timestamp.
    """

    id: str
    context: list[str] = field(
        default_factory=lambda: ["https://www.w3.org/ns/did/v1"]
    )
    verification_methods: list[VerificationMethod] = field(default_factory=list)
    authentication: list[str] = field(default_factory=list)
    assertion_method: list[str] = field(default_factory=list)
    services: list[ServiceEndpoint] = field(default_factory=list)
    status: DIDStatus = DIDStatus.ACTIVE
    created: str = ""
    updated: str = ""

    def is_active(self) -> bool:
        """Check whether this DID is active.

        Returns:
            True if status is ACTIVE.
        """
        return self.status == DIDStatus.ACTIVE

    def to_dict(self) -> dict[str, Any]:
        """Serialize the DID Document to a dictionary.

        Returns:
            JSON-serializable dictionary representation.
        """
        doc: dict[str, Any] = {
            "@context": self.context,
            "id": self.id,
            "verificationMethod": [
                {
                    "id": vm.id,
                    "type": vm.type,
                    "controller": vm.controller,
                    "publicKeyHex": vm.public_key_hex,
                }
                for vm in self.verification_methods
            ],
            "authentication": self.authentication,
            "assertionMethod": self.assertion_method,
            "service": [
                {"id": s.id, "type": s.type, "serviceEndpoint": s.endpoint}
                for s in self.services
            ],
            "status": self.status.value,
        }
        if self.created:
            doc["created"] = self.created
        if self.updated:
            doc["updated"] = self.updated
        return doc
