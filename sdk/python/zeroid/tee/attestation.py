"""TEE attestation verification.

Provides verification of TEE attestation evidence against known
enclave measurements and platform-specific rules.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from zeroid.crypto.hashing import keccak256
from zeroid.tee.types import AttestationEvidence, TEEPlatform


@dataclass(frozen=True)
class AttestationResult:
    """Result of attestation verification.

    Attributes:
        valid: Whether the attestation is valid.
        platform: The TEE platform verified.
        errors: List of verification errors.
        enclave_hash: The verified enclave hash.
    """

    valid: bool
    platform: TEEPlatform
    errors: list[str] = field(default_factory=list)
    enclave_hash: str = ""


class AttestationVerifier:
    """Verifies TEE attestation evidence.

    Maintains a set of trusted enclave measurements and verifies
    attestation evidence against them.
    """

    def __init__(self) -> None:
        """Initialize the verifier with empty trusted measurements."""
        self._trusted_hashes: dict[TEEPlatform, set[str]] = {}

    def register_trusted_hash(
        self, platform: TEEPlatform, enclave_hash: str
    ) -> None:
        """Register a trusted enclave measurement.

        Args:
            platform: The TEE platform.
            enclave_hash: Hex-encoded enclave measurement hash.
        """
        if platform not in self._trusted_hashes:
            self._trusted_hashes[platform] = set()
        self._trusted_hashes[platform].add(enclave_hash.lower())

    def verify(self, evidence: AttestationEvidence) -> AttestationResult:
        """Verify TEE attestation evidence.

        Checks:
        - Evidence is complete (hash, signature, certificates)
        - Platform is supported (not UNKNOWN)
        - Enclave hash is in the trusted set for the platform
        - Signature structure is valid (mock check)

        Args:
            evidence: The attestation evidence to verify.

        Returns:
            AttestationResult with verification details.
        """
        errors: list[str] = []

        if evidence.platform == TEEPlatform.UNKNOWN:
            errors.append("Unknown TEE platform")

        if not evidence.enclave_hash:
            errors.append("Missing enclave hash")

        if not evidence.signature:
            errors.append("Missing attestation signature")

        if not evidence.certificates:
            errors.append("Missing certificate chain")

        if errors:
            return AttestationResult(
                valid=False,
                platform=evidence.platform,
                errors=errors,
                enclave_hash=evidence.enclave_hash,
            )

        # Check trusted hashes
        trusted = self._trusted_hashes.get(evidence.platform)
        if trusted is None:
            errors.append(
                f"No trusted hashes registered for platform {evidence.platform.value}"
            )
        elif evidence.enclave_hash.lower() not in trusted:
            errors.append("Enclave hash not in trusted set")

        # Mock signature verification
        if evidence.signature and len(evidence.signature) < 8:
            errors.append("Signature too short")

        return AttestationResult(
            valid=len(errors) == 0,
            platform=evidence.platform,
            errors=errors,
            enclave_hash=evidence.enclave_hash,
        )

    def compute_expected_hash(self, code: bytes) -> str:
        """Compute the expected enclave hash for given code.

        Args:
            code: The enclave code bytes.

        Returns:
            Hex-encoded hash.
        """
        return keccak256(code).hex()
