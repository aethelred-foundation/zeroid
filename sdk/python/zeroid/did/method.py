"""did:zero method-specific logic.

The did:zero method maps Aethelred blockchain addresses to DIDs:
    did:zero:<hex-address>

where <hex-address> is a 40-character lowercase hexadecimal string
(optionally prefixed with 0x).
"""

from __future__ import annotations

import re

from zeroid.crypto.hashing import keccak256

# Pattern: did:zero: followed by optional 0x and 40 hex chars
_DID_PATTERN = re.compile(r"^did:zero:(0x)?([0-9a-fA-F]{40})$")


class ZeroMethod:
    """Utilities for the did:zero DID method."""

    METHOD = "zero"
    PREFIX = "did:zero:"

    @staticmethod
    def validate(did: str) -> bool:
        """Validate a did:zero URI.

        Args:
            did: The DID string to validate.

        Returns:
            True if the DID is a valid did:zero URI.
        """
        return _DID_PATTERN.match(did) is not None

    @staticmethod
    def parse_address(did: str) -> str:
        """Extract the hex address from a did:zero URI.

        Args:
            did: A valid did:zero URI.

        Returns:
            Lowercase 40-character hex address (without 0x prefix).

        Raises:
            ValueError: If the DID is not a valid did:zero URI.
        """
        m = _DID_PATTERN.match(did)
        if not m:
            raise ValueError(f"Invalid did:zero URI: {did}")
        return m.group(2).lower()

    @staticmethod
    def from_address(address: str) -> str:
        """Construct a did:zero URI from a hex address.

        Args:
            address: 40-character hex address (with or without 0x prefix).

        Returns:
            A did:zero URI string.

        Raises:
            ValueError: If the address is not valid.
        """
        clean = address.lower().removeprefix("0x")
        if not re.match(r"^[0-9a-f]{40}$", clean):
            raise ValueError(f"Invalid hex address: {address}")
        return f"did:zero:{clean}"

    @staticmethod
    def compute_did_hash(did: str) -> bytes:
        """Compute the keccak256 hash of a did:zero URI.

        Args:
            did: A valid did:zero URI.

        Returns:
            32-byte hash.

        Raises:
            ValueError: If the DID is not valid.
        """
        if not ZeroMethod.validate(did):
            raise ValueError(f"Invalid did:zero URI: {did}")
        return keccak256(did.encode("utf-8"))
