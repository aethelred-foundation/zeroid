"""On-chain registry client interface.

Defines the abstract RegistryClient protocol and provides an
in-memory implementation for testing.
"""

from __future__ import annotations

from typing import Protocol

from zeroid.registry.types import AttestationReport, CredentialRecord, Identity


class RegistryClient(Protocol):
    """Protocol for on-chain registry clients."""

    def get_identity(self, address: str) -> Identity | None:
        """Look up an identity by address.

        Args:
            address: Hex address (without 0x prefix).

        Returns:
            The Identity record, or None if not found.
        """
        ...  # pragma: no cover

    def register_identity(self, identity: Identity) -> bool:
        """Register a new identity on-chain.

        Args:
            identity: The identity to register.

        Returns:
            True if registration succeeded.
        """
        ...  # pragma: no cover

    def get_credential(self, credential_id: str) -> CredentialRecord | None:
        """Look up a credential record by ID.

        Args:
            credential_id: The credential identifier.

        Returns:
            The CredentialRecord, or None if not found.
        """
        ...  # pragma: no cover

    def store_credential(self, record: CredentialRecord) -> bool:
        """Store a credential record on-chain.

        Args:
            record: The credential record to store.

        Returns:
            True if storage succeeded.
        """
        ...  # pragma: no cover

    def get_attestation(self, report_id: str) -> AttestationReport | None:
        """Look up an attestation report by ID.

        Args:
            report_id: The report identifier.

        Returns:
            The AttestationReport, or None if not found.
        """
        ...  # pragma: no cover

    def store_attestation(self, report: AttestationReport) -> bool:
        """Store an attestation report on-chain.

        Args:
            report: The attestation report to store.

        Returns:
            True if storage succeeded.
        """
        ...  # pragma: no cover


class InMemoryRegistryClient:
    """In-memory implementation of RegistryClient for testing.

    Stores all data in dictionaries keyed by address/ID.
    """

    def __init__(self) -> None:
        """Initialize empty in-memory stores."""
        self._identities: dict[str, Identity] = {}
        self._credentials: dict[str, CredentialRecord] = {}
        self._attestations: dict[str, AttestationReport] = {}

    def get_identity(self, address: str) -> Identity | None:
        """Look up an identity by address.

        Args:
            address: Hex address (without 0x prefix).

        Returns:
            The Identity record, or None if not found.
        """
        return self._identities.get(address.lower())

    def register_identity(self, identity: Identity) -> bool:
        """Register a new identity.

        Args:
            identity: The identity to register.

        Returns:
            True if registration succeeded (not already registered).
        """
        key = identity.address.lower()
        if key in self._identities:
            return False
        self._identities[key] = identity
        return True

    def get_credential(self, credential_id: str) -> CredentialRecord | None:
        """Look up a credential record by ID.

        Args:
            credential_id: The credential identifier.

        Returns:
            The CredentialRecord, or None if not found.
        """
        return self._credentials.get(credential_id)

    def store_credential(self, record: CredentialRecord) -> bool:
        """Store a credential record.

        Args:
            record: The credential record to store.

        Returns:
            True if storage succeeded.
        """
        self._credentials[record.credential_id] = record
        return True

    def get_attestation(self, report_id: str) -> AttestationReport | None:
        """Look up an attestation report by ID.

        Args:
            report_id: The report identifier.

        Returns:
            The AttestationReport, or None if not found.
        """
        return self._attestations.get(report_id)

    def store_attestation(self, report: AttestationReport) -> bool:
        """Store an attestation report.

        Args:
            report: The attestation report to store.

        Returns:
            True if storage succeeded.
        """
        self._attestations[report.report_id] = report
        return True
