"""TEE platform definitions and attestation types."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class TEEPlatform(Enum):
    """Supported TEE platforms."""

    SGX = "sgx"
    TDX = "tdx"
    SEV_SNP = "sev-snp"
    TRUSTZONE = "trustzone"
    NITRO = "nitro"
    UNKNOWN = "unknown"

    @classmethod
    def from_string(cls, value: str) -> TEEPlatform:
        """Parse a TEE platform from a string.

        Args:
            value: Platform name string.

        Returns:
            Matching TEEPlatform, or UNKNOWN if not recognized.
        """
        normalized = value.lower().strip()
        for member in cls:
            if member.value == normalized:
                return member
        return cls.UNKNOWN


@dataclass(frozen=True)
class AttestationEvidence:
    """TEE attestation evidence.

    Attributes:
        platform: The TEE platform.
        enclave_hash: Measurement/hash of the enclave code.
        report_data: User-defined report data (hex).
        timestamp: ISO 8601 timestamp of attestation.
        signature: Hex-encoded attestation signature.
        certificates: List of certificate chain entries (hex or PEM).
        pcr_values: Platform Configuration Register values (if applicable).
    """

    platform: TEEPlatform
    enclave_hash: str
    report_data: str = ""
    timestamp: str = ""
    signature: str = ""
    certificates: list[str] = field(default_factory=list)
    pcr_values: dict[int, str] = field(default_factory=dict)

    def is_complete(self) -> bool:
        """Check if the evidence has all required fields.

        Returns:
            True if enclave_hash, signature, and at least one cert are present.
        """
        return bool(self.enclave_hash and self.signature and self.certificates)
