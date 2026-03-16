"""Verifiable Credential and Presentation dataclasses.

Implements VC/VP data model per W3C Verifiable Credentials Data Model v1.1.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class CredentialStatus(Enum):
    """Status of a Verifiable Credential."""

    ACTIVE = "active"
    REVOKED = "revoked"
    SUSPENDED = "suspended"
    EXPIRED = "expired"


@dataclass
class VerifiableCredential:
    """A W3C Verifiable Credential.

    Attributes:
        context: JSON-LD context URIs.
        id: Unique credential identifier.
        type: Credential types.
        issuer: DID of the issuer.
        issuance_date: ISO 8601 issuance date.
        expiration_date: Optional ISO 8601 expiration date.
        credential_subject: The credential subject data.
        proof: Proof/signature data.
        credential_status: Current status.
        credential_schema: Optional schema reference.
    """

    context: list[str] = field(
        default_factory=lambda: [
            "https://www.w3.org/2018/credentials/v1",
            "https://zeroid.aethelred.network/credentials/v1",
        ]
    )
    id: str = ""
    type: list[str] = field(
        default_factory=lambda: ["VerifiableCredential"]
    )
    issuer: str = ""
    issuance_date: str = ""
    expiration_date: str = ""
    credential_subject: dict[str, Any] = field(default_factory=dict)
    proof: dict[str, Any] = field(default_factory=dict)
    credential_status: CredentialStatus = CredentialStatus.ACTIVE
    credential_schema: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Serialize the credential to a dictionary.

        Returns:
            JSON-serializable dictionary.
        """
        doc: dict[str, Any] = {
            "@context": self.context,
            "id": self.id,
            "type": self.type,
            "issuer": self.issuer,
            "issuanceDate": self.issuance_date,
            "credentialSubject": self.credential_subject,
            "proof": self.proof,
            "credentialStatus": self.credential_status.value,
        }
        if self.expiration_date:
            doc["expirationDate"] = self.expiration_date
        if self.credential_schema:
            doc["credentialSchema"] = self.credential_schema
        return doc


@dataclass
class VerifiablePresentation:
    """A W3C Verifiable Presentation.

    Attributes:
        context: JSON-LD context URIs.
        id: Unique presentation identifier.
        type: Presentation types.
        holder: DID of the holder.
        verifiable_credential: List of included credentials.
        proof: Proof/signature data.
    """

    context: list[str] = field(
        default_factory=lambda: ["https://www.w3.org/2018/credentials/v1"]
    )
    id: str = ""
    type: list[str] = field(
        default_factory=lambda: ["VerifiablePresentation"]
    )
    holder: str = ""
    verifiable_credential: list[VerifiableCredential] = field(default_factory=list)
    proof: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize the presentation to a dictionary.

        Returns:
            JSON-serializable dictionary.
        """
        return {
            "@context": self.context,
            "id": self.id,
            "type": self.type,
            "holder": self.holder,
            "verifiableCredential": [vc.to_dict() for vc in self.verifiable_credential],
            "proof": self.proof,
        }
