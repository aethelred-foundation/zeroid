"""Cryptographic accumulator for credential revocation.

Provides a hash-based accumulator that can add/remove members and
generate membership/non-membership witnesses. Used by ZeroID for
efficient on-chain revocation checking.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from zeroid.crypto.hashing import keccak256


@dataclass
class Accumulator:
    """A hash-based cryptographic accumulator for revocation management.

    Attributes:
        state: Current accumulator state (32 bytes).
        members: Set of current member elements.
    """

    state: bytes = field(default_factory=lambda: keccak256(b"accumulator-genesis"))
    members: set[bytes] = field(default_factory=set)

    def add(self, element: bytes) -> bytes:
        """Add an element to the accumulator.

        Args:
            element: The element to add.

        Returns:
            The new accumulator state.

        Raises:
            ValueError: If element is already a member.
        """
        if element in self.members:
            raise ValueError("Element already in accumulator")
        self.members.add(element)
        self.state = keccak256(self.state + b"add:" + element)
        return self.state

    def remove(self, element: bytes) -> bytes:
        """Remove an element from the accumulator.

        Args:
            element: The element to remove.

        Returns:
            The new accumulator state.

        Raises:
            ValueError: If element is not a member.
        """
        if element not in self.members:
            raise ValueError("Element not in accumulator")
        self.members.discard(element)
        self.state = keccak256(self.state + b"remove:" + element)
        return self.state

    def is_member(self, element: bytes) -> bool:
        """Check if an element is currently in the accumulator.

        Args:
            element: The element to check.

        Returns:
            True if the element is a member.
        """
        return element in self.members

    def witness(self, element: bytes) -> bytes:
        """Generate a membership witness for an element.

        Args:
            element: The element to generate a witness for.

        Returns:
            A 32-byte witness value.

        Raises:
            ValueError: If element is not a member.
        """
        if element not in self.members:
            raise ValueError("Cannot generate witness for non-member")
        return keccak256(self.state + b"witness:" + element)

    def verify_witness(self, element: bytes, witness: bytes) -> bool:
        """Verify a membership witness.

        Args:
            element: The element to verify.
            witness: The witness to check.

        Returns:
            True if the witness is valid for the current state.
        """
        if element not in self.members:
            return False
        expected = keccak256(self.state + b"witness:" + element)
        return hmac_compare(expected, witness)


def hmac_compare(a: bytes, b: bytes) -> bool:
    """Constant-time comparison of two byte strings.

    Args:
        a: First byte string.
        b: Second byte string.

    Returns:
        True if a == b.
    """
    if len(a) != len(b):
        return False
    result = 0
    for x, y in zip(a, b):
        result |= x ^ y
    return result == 0
