"""Credential issuance — create Verifiable Credentials.

Provides the CredentialIssuer class which creates signed VCs with
optional Merkle-tree-based selective disclosure.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from zeroid.credential.proof import (
    build_credential_proof_payload,
    compute_credential_proof_value,
    compute_credential_subject_merkle_root,
)
from zeroid.credential.schema import SchemaRegistry
from zeroid.credential.types import CredentialStatus, VerifiableCredential


class CredentialIssuer:
    """Issues Verifiable Credentials.

    Attributes:
        issuer_did: The DID of the issuer.
        signing_key: Hex-encoded signing key (mock).
        schema_registry: Optional schema registry for validation.
    """

    def __init__(
        self,
        issuer_did: str,
        signing_key: str,
        schema_registry: SchemaRegistry | None = None,
    ) -> None:
        """Initialize the credential issuer.

        Args:
            issuer_did: The issuer's DID.
            signing_key: Hex-encoded signing key for proof generation.
            schema_registry: Optional schema registry for subject validation.
        """
        self.issuer_did = issuer_did
        self.signing_key = signing_key
        self.schema_registry = schema_registry

    def issue(
        self,
        subject_did: str,
        credential_type: str,
        claims: dict[str, object],
        schema_id: str = "",
        expiration_date: str = "",
    ) -> VerifiableCredential:
        """Issue a new Verifiable Credential.

        Args:
            subject_did: The DID of the credential subject.
            credential_type: The credential type (e.g., "KYCCredential").
            claims: Key-value claims for the credential subject.
            schema_id: Optional schema ID to validate against.
            expiration_date: Optional ISO 8601 expiration date.

        Returns:
            A signed VerifiableCredential.

        Raises:
            ValueError: If schema validation fails.
        """
        if schema_id and self.schema_registry:
            errors = self.schema_registry.validate(schema_id, claims)
            if errors:
                raise ValueError(f"Schema validation failed: {'; '.join(errors)}")

        credential_subject = {"id": subject_did, **claims}
        cred_id = f"urn:uuid:{uuid.uuid4()}"
        now = datetime.now(timezone.utc).isoformat()
        types = ["VerifiableCredential"]
        if credential_type != "VerifiableCredential":
            types.append(credential_type)

        merkle_root = compute_credential_subject_merkle_root(credential_subject)
        proof_payload = build_credential_proof_payload(
            credential_id=cred_id,
            credential_types=types,
            issuer=self.issuer_did,
            issuance_date=now,
            expiration_date=expiration_date,
            credential_schema=schema_id,
            subject_merkle_root=merkle_root.hex(),
        )
        signature = compute_credential_proof_value(
            self.signing_key,
            proof_payload,
        )

        proof = {
            "type": "ZeroIDCredentialProof2026",
            "created": now,
            "verificationMethod": f"{self.issuer_did}#key-1",
            "proofPurpose": "assertionMethod",
            "proofValue": signature,
            "merkleRoot": merkle_root.hex(),
        }

        return VerifiableCredential(
            id=cred_id,
            type=types,
            issuer=self.issuer_did,
            issuance_date=now,
            expiration_date=expiration_date,
            credential_subject=credential_subject,
            proof=proof,
            credential_status=CredentialStatus.ACTIVE,
            credential_schema=schema_id,
        )
