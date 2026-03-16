"""Registry type definitions matching Solidity contract structures.

Provides Python dataclass equivalents of the on-chain ZeroID
registry data structures.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum


class IdentityStatus(IntEnum):
    """On-chain identity status (matches Solidity enum)."""

    UNREGISTERED = 0
    ACTIVE = 1
    SUSPENDED = 2
    REVOKED = 3


@dataclass
class Identity:
    """An on-chain identity record.

    Attributes:
        address: Hex address of the identity owner.
        public_key_hex: Hex-encoded public key.
        did: The did:zero URI.
        status: Current identity status.
        created_at: ISO 8601 creation timestamp.
        updated_at: ISO 8601 last-update timestamp.
        metadata: Arbitrary metadata key-value pairs.
        revoked: Whether the identity is revoked.
        suspended: Whether the identity is suspended.
        service_endpoint: Optional service endpoint URI.
    """

    address: str
    public_key_hex: str
    did: str = ""
    status: IdentityStatus = IdentityStatus.ACTIVE
    created_at: str = ""
    updated_at: str = ""
    metadata: dict[str, str] = field(default_factory=dict)
    revoked: bool = False
    suspended: bool = False
    service_endpoint: str = ""


@dataclass
class CredentialRecord:
    """An on-chain credential record.

    Attributes:
        credential_id: Unique credential identifier.
        issuer_address: Address of the credential issuer.
        holder_address: Address of the credential holder.
        credential_type: Type of the credential.
        schema_id: Schema identifier.
        merkle_root: Hex-encoded Merkle root of credential attributes.
        issued_at: ISO 8601 issuance timestamp.
        expires_at: ISO 8601 expiration timestamp (empty if none).
        revoked: Whether the credential has been revoked.
    """

    credential_id: str
    issuer_address: str
    holder_address: str
    credential_type: str
    schema_id: str = ""
    merkle_root: str = ""
    issued_at: str = ""
    expires_at: str = ""
    revoked: bool = False


@dataclass
class AttestationReport:
    """A TEE attestation report record.

    Attributes:
        report_id: Unique report identifier.
        platform: TEE platform name.
        enclave_hash: Hash of the enclave measurement.
        timestamp: ISO 8601 timestamp.
        signer_address: Address of the attestation signer.
        verified: Whether the report has been verified.
        report_data: Raw report data (hex-encoded).
    """

    report_id: str
    platform: str
    enclave_hash: str
    timestamp: str = ""
    signer_address: str = ""
    verified: bool = False
    report_data: str = ""
