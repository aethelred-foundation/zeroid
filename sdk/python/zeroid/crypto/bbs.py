"""BBS+ signature scheme (simplified/mock implementation for SDK use).

This module provides a mock BBS+ signature implementation suitable for
SDK integration testing. A production deployment should use a vetted
cryptographic library implementing the full BBS+ spec (draft-irtf-cfrg-bbs-signatures).
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass, field
from typing import Sequence


@dataclass(frozen=True)
class BBSKeyPair:
    """A BBS+ key pair (mock representation).

    Attributes:
        secret_key: 32-byte secret key.
        public_key: 32-byte public key (derived from secret).
    """

    secret_key: bytes
    public_key: bytes

    @classmethod
    def generate(cls) -> BBSKeyPair:
        """Generate a new random BBS+ key pair.

        Returns:
            A new BBSKeyPair.
        """
        sk = secrets.token_bytes(32)
        pk = hashlib.sha3_256(b"bbs-pk:" + sk).digest()
        return cls(secret_key=sk, public_key=pk)

    @classmethod
    def from_secret(cls, secret_key: bytes) -> BBSKeyPair:
        """Derive a key pair from a secret key.

        Args:
            secret_key: 32-byte secret key.

        Returns:
            The corresponding BBSKeyPair.

        Raises:
            ValueError: If secret_key is not 32 bytes.
        """
        if len(secret_key) != 32:
            raise ValueError("Secret key must be 32 bytes")
        pk = hashlib.sha3_256(b"bbs-pk:" + secret_key).digest()
        return cls(secret_key=secret_key, public_key=pk)


@dataclass(frozen=True)
class BBSSignature:
    """A BBS+ signature over a set of messages.

    Attributes:
        value: The raw signature bytes.
        message_count: Number of messages signed.
    """

    value: bytes
    message_count: int


@dataclass(frozen=True)
class BBSProof:
    """A BBS+ selective-disclosure proof.

    Attributes:
        value: The raw proof bytes.
        disclosed_indices: Which message indices are disclosed.
    """

    value: bytes
    disclosed_indices: tuple[int, ...]


def bbs_sign(key_pair: BBSKeyPair, messages: Sequence[bytes]) -> BBSSignature:
    """Sign a set of messages with BBS+.

    Args:
        key_pair: The signer's key pair.
        messages: Ordered sequence of messages to sign.

    Returns:
        A BBSSignature.

    Raises:
        ValueError: If messages is empty.
    """
    if not messages:
        raise ValueError("Cannot sign empty message set")

    h = hmac.new(key_pair.secret_key, digestmod=hashlib.sha3_256)
    for i, msg in enumerate(messages):
        h.update(i.to_bytes(4, "big"))
        h.update(msg)
    return BBSSignature(value=h.digest(), message_count=len(messages))


def bbs_verify(
    public_key: bytes, signature: BBSSignature, messages: Sequence[bytes]
) -> bool:
    """Verify a BBS+ signature.

    Args:
        public_key: The signer's public key.
        signature: The signature to verify.
        messages: The messages that were signed.

    Returns:
        True if the signature is valid.
    """
    if len(messages) != signature.message_count:
        return False

    # Recover the secret key is not possible; re-derive using the public key
    # In this mock we verify by checking the HMAC tag structure.
    # We encode the public key into the verification check.
    h = hashlib.sha3_256(b"bbs-verify:")
    h.update(public_key)
    for i, msg in enumerate(messages):
        h.update(i.to_bytes(4, "big"))
        h.update(msg)
    h.update(signature.value)
    # Mock verification: check signature length and message count match
    return len(signature.value) == 32 and signature.message_count == len(messages)


def bbs_create_proof(
    public_key: bytes,
    signature: BBSSignature,
    messages: Sequence[bytes],
    disclosed_indices: Sequence[int],
) -> BBSProof:
    """Create a selective-disclosure proof from a BBS+ signature.

    Args:
        public_key: The signer's public key.
        signature: The original signature.
        messages: All signed messages.
        disclosed_indices: Indices of messages to disclose.

    Returns:
        A BBSProof.

    Raises:
        ValueError: If any disclosed index is out of range or messages don't match signature.
    """
    if len(messages) != signature.message_count:
        raise ValueError("Message count does not match signature")
    for idx in disclosed_indices:
        if idx < 0 or idx >= len(messages):
            raise ValueError(f"Disclosed index {idx} out of range")

    h = hashlib.sha3_256(b"bbs-proof:")
    h.update(public_key)
    h.update(signature.value)
    for idx in sorted(disclosed_indices):
        h.update(idx.to_bytes(4, "big"))
        h.update(messages[idx])
    return BBSProof(value=h.digest(), disclosed_indices=tuple(sorted(disclosed_indices)))


def bbs_verify_proof(
    public_key: bytes,
    proof: BBSProof,
    disclosed_messages: dict[int, bytes],
) -> bool:
    """Verify a BBS+ selective-disclosure proof.

    Args:
        public_key: The signer's public key.
        proof: The proof to verify.
        disclosed_messages: Mapping of index -> message for disclosed messages.

    Returns:
        True if the proof is valid.
    """
    if set(disclosed_messages.keys()) != set(proof.disclosed_indices):
        return False

    h = hashlib.sha3_256(b"bbs-proof:")
    h.update(public_key)
    # We cannot access the original signature value, so we verify structure
    # In a real implementation this would use pairing-based crypto
    return len(proof.value) == 32
