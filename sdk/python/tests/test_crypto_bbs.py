"""Tests for zeroid.crypto.bbs."""

import pytest

from zeroid.crypto.bbs import (
    BBSUnavailableError,
    BBSKeyPair,
    BBSProof,
    BBSSignature,
    bbs_sign,
    bbs_verify,
    bbs_create_proof,
    bbs_verify_proof,
)


class TestBBSKeyPair:
    def test_generate(self) -> None:
        kp = BBSKeyPair.generate()
        assert len(kp.secret_key) == 32
        assert len(kp.public_key) == 32
        assert kp.secret_key != kp.public_key

    def test_from_secret(self) -> None:
        sk = b"\xab" * 32
        kp = BBSKeyPair.from_secret(sk)
        assert kp.secret_key == sk
        assert len(kp.public_key) == 32

    def test_from_secret_deterministic(self) -> None:
        sk = b"\x01" * 32
        kp1 = BBSKeyPair.from_secret(sk)
        kp2 = BBSKeyPair.from_secret(sk)
        assert kp1.public_key == kp2.public_key

    def test_from_secret_invalid_length(self) -> None:
        with pytest.raises(ValueError, match="32 bytes"):
            BBSKeyPair.from_secret(b"\x00" * 16)


class TestBBSSign:
    def test_sign_non_empty_fails_closed(self) -> None:
        kp = BBSKeyPair.generate()
        with pytest.raises(BBSUnavailableError, match="unavailable"):
            bbs_sign(kp, [b"hello"])

    def test_sign_empty_raises(self) -> None:
        kp = BBSKeyPair.generate()
        with pytest.raises(ValueError, match="empty"):
            bbs_sign(kp, [])


class TestBBSVerify:
    def test_verify_rejects_placeholder_signature(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"hello", b"world"]
        sig = BBSSignature(value=b"\x01" * 32, message_count=len(msgs))
        assert bbs_verify(kp.public_key, sig, msgs) is False

    def test_verify_wrong_message_count(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"hello"]
        sig = BBSSignature(value=b"\x01" * 32, message_count=len(msgs))
        assert bbs_verify(kp.public_key, sig, [b"hello", b"extra"]) is False


class TestBBSProof:
    def test_create_proof_fails_closed(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"name", b"age", b"country"]
        sig = BBSSignature(value=b"\x01" * 32, message_count=len(msgs))
        with pytest.raises(BBSUnavailableError, match="unavailable"):
            bbs_create_proof(kp.public_key, sig, msgs, [0, 2])

    def test_create_proof_invalid_index(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"a"]
        sig = BBSSignature(value=b"\x01" * 32, message_count=len(msgs))
        with pytest.raises(ValueError, match="out of range"):
            bbs_create_proof(kp.public_key, sig, msgs, [5])

    def test_create_proof_wrong_message_count(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"a", b"b"]
        sig = BBSSignature(value=b"\x01" * 32, message_count=len(msgs))
        with pytest.raises(ValueError, match="count"):
            bbs_create_proof(kp.public_key, sig, [b"a"], [0])

    def test_verify_proof_rejects_placeholder_proof(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"name", b"age", b"country"]
        proof = BBSProof(value=b"\x01" * 32, disclosed_indices=(0, 2))
        disclosed = {0: msgs[0], 2: msgs[2]}
        assert bbs_verify_proof(kp.public_key, proof, disclosed) is False

    def test_verify_proof_wrong_indices(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"a", b"b"]
        proof = BBSProof(value=b"\x01" * 32, disclosed_indices=(0,))
        # Provide wrong set of indices
        assert bbs_verify_proof(kp.public_key, proof, {0: msgs[0], 1: msgs[1]}) is False
