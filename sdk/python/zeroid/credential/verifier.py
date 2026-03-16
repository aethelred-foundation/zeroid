"""Credential verification — verify VCs for status, expiry, and schema.

Provides the CredentialVerifier class which checks credential validity
including signature structure, expiration, status, and schema compliance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

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

    def __init__(self, schema_registry: SchemaRegistry | None = None) -> None:
        """Initialize the verifier.

        Args:
            schema_registry: Optional schema registry for subject validation.
        """
        self.schema_registry = schema_registry

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
            if "proofValue" not in credential.proof:
                errors.append("Missing proof value")
            if "verificationMethod" not in credential.proof:
                errors.append("Missing verification method in proof")

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
