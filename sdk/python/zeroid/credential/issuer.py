"""Credential issuance — create Verifiable Credentials.

Provides the CredentialIssuer class which creates signed VCs with
optional Merkle-tree-based selective disclosure.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from zeroid.credential.schema import SchemaRegistry
from zeroid.credential.types import CredentialStatus, VerifiableCredential
from zeroid.crypto.hashing import keccak256, compute_merkle_root


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

        # Build Merkle tree for selective disclosure
        merkle_leaves = []
        for key, value in sorted(credential_subject.items()):
            leaf_data = json.dumps({key: value}, sort_keys=True).encode("utf-8")
            merkle_leaves.append(keccak256(leaf_data))

        merkle_root = compute_merkle_root(merkle_leaves) if merkle_leaves else b""

        # Generate mock proof
        proof_input = (
            self.signing_key + cred_id + now + merkle_root.hex()
        ).encode("utf-8")
        signature = keccak256(proof_input).hex()

        proof = {
            "type": "EcdsaSecp256k1Signature2019",
            "created": now,
            "verificationMethod": f"{self.issuer_did}#key-1",
            "proofPurpose": "assertionMethod",
            "proofValue": signature,
            "merkleRoot": merkle_root.hex(),
        }

        types = ["VerifiableCredential"]
        if credential_type != "VerifiableCredential":
            types.append(credential_type)

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
