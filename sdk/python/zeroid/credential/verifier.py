"""Credential verification — verify VCs for status, expiry, and schema.

Provides the CredentialVerifier class which checks credential validity
including signature structure, expiration, status, and schema compliance.
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass, field
from datetime import datetime, timezone

from zeroid.credential.proof import (
    build_credential_proof_payload,
    compute_credential_proof_value,
    compute_credential_subject_merkle_root,
)
from zeroid.credential.schema import SchemaRegistry
from zeroid.credential.types import CredentialStatus, VerifiableCredential


@dataclass(frozen=True)
class VerificationResult:
    """Result of a credential verification.

    Attributes:
        valid: Whether the credential passed all checks.
        errors: List of error messages for failed checks.
        warnings: List of warning messages.
    """

    valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class CredentialVerifier:
    """Verifies Verifiable Credentials.

    Checks credential structure, status, expiration, and optionally
    validates against a schema registry.
    """

    def __init__(
        self,
        schema_registry: SchemaRegistry | None = None,
        trusted_issuer_keys: dict[str, str] | None = None,
    ) -> None:
        """Initialize the verifier.

        Args:
            schema_registry: Optional schema registry for subject validation.
            trusted_issuer_keys: Mapping of issuer DID to verification key.
        """
        self.schema_registry = schema_registry
        self.trusted_issuer_keys = trusted_issuer_keys or {}

    def verify(self, credential: VerifiableCredential) -> VerificationResult:
        """Verify a Verifiable Credential.

        Checks:
        - Credential has required fields (id, issuer, issuance_date)
        - Credential status is ACTIVE
        - Credential has not expired
        - Proof is present and well-formed
        - Schema validation (if schema_registry and credential_schema set)

        Args:
            credential: The credential to verify.

        Returns:
            A VerificationResult with validity and error details.
        """
        errors: list[str] = []
        warnings: list[str] = []

        # Structure checks
        if not credential.id:
            errors.append("Missing credential ID")
        if not credential.issuer:
            errors.append("Missing issuer")
        if not credential.issuance_date:
            errors.append("Missing issuance date")

        # Status check
        if credential.credential_status == CredentialStatus.REVOKED:
            errors.append("Credential has been revoked")
        elif credential.credential_status == CredentialStatus.SUSPENDED:
            warnings.append("Credential is suspended")
        elif credential.credential_status == CredentialStatus.EXPIRED:
            errors.append("Credential is marked as expired")

        # Expiration check
        if credential.expiration_date:
            try:
                exp = datetime.fromisoformat(credential.expiration_date)
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if exp < datetime.now(timezone.utc):
                    errors.append("Credential has expired")
            except ValueError:
                errors.append("Invalid expiration date format")

        # Proof checks
        if not credential.proof:
            errors.append("Missing proof")
        else:
            proof_value = credential.proof.get("proofValue")
            verification_method = credential.proof.get("verificationMethod")
            proof_type = credential.proof.get("type")
            proof_purpose = credential.proof.get("proofPurpose")
            merkle_root = credential.proof.get("merkleRoot")

            if not proof_value:
                errors.append("Missing proof value")
            if not verification_method:
                errors.append("Missing verification method in proof")
            elif not isinstance(verification_method, str):
                errors.append("Invalid verification method in proof")
            elif not verification_method.startswith(f"{credential.issuer}#"):
                errors.append("Verification method is not controlled by issuer")
            if proof_type != "ZeroIDCredentialProof2026":
                errors.append("Unsupported proof type")
            if proof_purpose != "assertionMethod":
                errors.append("Unsupported proof purpose")
            if not isinstance(merkle_root, str):
                errors.append("Missing subject Merkle root in proof")
            elif merkle_root != compute_credential_subject_merkle_root(
                credential.credential_subject
            ).hex():
                errors.append("Credential subject does not match proof root")

            issuer_key = self.trusted_issuer_keys.get(credential.issuer)
            if not issuer_key:
                errors.append("No trusted verification key configured for issuer")
            elif isinstance(proof_value, str) and isinstance(merkle_root, str):
                payload = build_credential_proof_payload(
                    credential_id=credential.id,
                    credential_types=credential.type,
                    issuer=credential.issuer,
                    issuance_date=credential.issuance_date,
                    expiration_date=credential.expiration_date,
                    credential_schema=credential.credential_schema,
                    subject_merkle_root=merkle_root,
                )
                expected = compute_credential_proof_value(issuer_key, payload)
                if not hmac.compare_digest(proof_value, expected):
                    errors.append("Credential proof signature is invalid")

        # Schema validation
        if credential.credential_schema and self.schema_registry:
            try:
                schema_errors = self.schema_registry.validate(
                    credential.credential_schema,
                    credential.credential_subject,
                )
                errors.extend(schema_errors)
            except KeyError:
                warnings.append(
                    f"Schema not found: {credential.credential_schema}"
                )

        return VerificationResult(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
        )
