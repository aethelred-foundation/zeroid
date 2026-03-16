"""Hashing utilities: keccak256 (SHA3-256 stand-in) and Merkle tree operations.

Note: This SDK uses SHA3-256 as a stand-in for Ethereum-compatible keccak256.
For production on-chain verification, use pysha3 or pycryptodome which provide
the original Keccak (pre-NIST) variant.
"""

from __future__ import annotations

import hashlib
from typing import Sequence


def keccak256(data: bytes) -> bytes:
    """Compute a keccak256-equivalent hash (SHA3-256 stand-in).

    Args:
        data: The bytes to hash.

    Returns:
        32-byte digest.
    """
    return hashlib.sha3_256(data).digest()


def _hash_pair(left: bytes, right: bytes) -> bytes:
    """Hash two 32-byte nodes together for a Merkle tree.

    Nodes are sorted before hashing to produce a canonical tree.

    Args:
        left: First node.
        right: Second node.

    Returns:
        Hash of the concatenated pair.
    """
    if left <= right:
        return keccak256(left + right)
    return keccak256(right + left)


def compute_merkle_root(leaves: Sequence[bytes]) -> bytes:
    """Compute the Merkle root of a list of leaf hashes.

    Args:
        leaves: Sequence of 32-byte leaf hashes. Must not be empty.

    Returns:
        32-byte Merkle root.

    Raises:
        ValueError: If leaves is empty.
    """
    if not leaves:
        raise ValueError("Cannot compute Merkle root of empty leaves")

    layer: list[bytes] = list(leaves)
    while len(layer) > 1:
        next_layer: list[bytes] = []
        for i in range(0, len(layer), 2):
            if i + 1 < len(layer):
                next_layer.append(_hash_pair(layer[i], layer[i + 1]))
            else:
                next_layer.append(layer[i])
        layer = next_layer
    return layer[0]


def compute_merkle_proof(leaves: Sequence[bytes], index: int) -> list[bytes]:
    """Compute a Merkle proof for the leaf at the given index.

    Args:
        leaves: Sequence of 32-byte leaf hashes. Must not be empty.
        index: Index of the leaf to prove.

    Returns:
        List of sibling hashes forming the proof.

    Raises:
        ValueError: If leaves is empty or index is out of range.
    """
    if not leaves:
        raise ValueError("Cannot compute proof for empty leaves")
    if index < 0 or index >= len(leaves):
        raise ValueError(f"Index {index} out of range for {len(leaves)} leaves")

    proof: list[bytes] = []
    layer: list[bytes] = list(leaves)
    idx = index

    while len(layer) > 1:
        next_layer: list[bytes] = []
        for i in range(0, len(layer), 2):
            if i + 1 < len(layer):
                if i == idx or i + 1 == idx:
                    sibling = layer[i + 1] if i == idx else layer[i]
                    proof.append(sibling)
                next_layer.append(_hash_pair(layer[i], layer[i + 1]))
            else:
                next_layer.append(layer[i])
        idx = idx // 2
        layer = next_layer

    return proof
