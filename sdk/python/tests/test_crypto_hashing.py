"""Tests for zeroid.crypto.hashing."""

import pytest

from zeroid.crypto.hashing import keccak256, compute_merkle_root, compute_merkle_proof, _hash_pair


class TestKeccak256:
    def test_returns_32_bytes(self) -> None:
        result = keccak256(b"hello")
        assert len(result) == 32

    def test_deterministic(self) -> None:
        assert keccak256(b"test") == keccak256(b"test")

    def test_different_inputs_differ(self) -> None:
        assert keccak256(b"a") != keccak256(b"b")

    def test_empty_input(self) -> None:
        result = keccak256(b"")
        assert len(result) == 32


class TestHashPair:
    def test_sorted_order(self) -> None:
        a = b"\x00" * 32
        b_val = b"\xff" * 32
        assert _hash_pair(a, b_val) == _hash_pair(b_val, a)

    def test_returns_32_bytes(self) -> None:
        result = _hash_pair(b"\x01" * 32, b"\x02" * 32)
        assert len(result) == 32


class TestMerkleRoot:
    def test_single_leaf(self) -> None:
        leaf = keccak256(b"leaf")
        assert compute_merkle_root([leaf]) == leaf

    def test_two_leaves(self) -> None:
        leaves = [keccak256(b"a"), keccak256(b"b")]
        root = compute_merkle_root(leaves)
        assert len(root) == 32
        assert root == _hash_pair(leaves[0], leaves[1])

    def test_three_leaves(self) -> None:
        leaves = [keccak256(b"a"), keccak256(b"b"), keccak256(b"c")]
        root = compute_merkle_root(leaves)
        assert len(root) == 32

    def test_four_leaves(self) -> None:
        leaves = [keccak256(bytes([i])) for i in range(4)]
        root = compute_merkle_root(leaves)
        assert len(root) == 32

    def test_empty_raises(self) -> None:
        with pytest.raises(ValueError, match="empty"):
            compute_merkle_root([])


class TestMerkleProof:
    def test_single_leaf_empty_proof(self) -> None:
        leaf = keccak256(b"only")
        proof = compute_merkle_proof([leaf], 0)
        assert proof == []

    def test_two_leaves_proof(self) -> None:
        leaves = [keccak256(b"a"), keccak256(b"b")]
        proof = compute_merkle_proof(leaves, 0)
        assert len(proof) == 1
        assert proof[0] == leaves[1]

    def test_two_leaves_proof_second(self) -> None:
        leaves = [keccak256(b"a"), keccak256(b"b")]
        proof = compute_merkle_proof(leaves, 1)
        assert len(proof) == 1
        assert proof[0] == leaves[0]

    def test_four_leaves_proof(self) -> None:
        leaves = [keccak256(bytes([i])) for i in range(4)]
        proof = compute_merkle_proof(leaves, 2)
        assert len(proof) == 2

    def test_empty_raises(self) -> None:
        with pytest.raises(ValueError, match="empty"):
            compute_merkle_proof([], 0)

    def test_index_out_of_range(self) -> None:
        leaves = [keccak256(b"a")]
        with pytest.raises(ValueError, match="out of range"):
            compute_merkle_proof(leaves, 1)

    def test_negative_index(self) -> None:
        leaves = [keccak256(b"a")]
        with pytest.raises(ValueError, match="out of range"):
            compute_merkle_proof(leaves, -1)

    def test_three_leaves_proof(self) -> None:
        leaves = [keccak256(b"a"), keccak256(b"b"), keccak256(b"c")]
        proof = compute_merkle_proof(leaves, 0)
        assert len(proof) >= 1
