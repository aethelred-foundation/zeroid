"""Tests for zeroid.crypto.bbs."""

import pytest

from zeroid.crypto.bbs import (
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
    def test_sign_single_message(self) -> None:
        kp = BBSKeyPair.generate()
        sig = bbs_sign(kp, [b"hello"])
        assert len(sig.value) == 32
        assert sig.message_count == 1

    def test_sign_multiple_messages(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"msg1", b"msg2", b"msg3"]
        sig = bbs_sign(kp, msgs)
        assert sig.message_count == 3

    def test_sign_empty_raises(self) -> None:
        kp = BBSKeyPair.generate()
        with pytest.raises(ValueError, match="empty"):
            bbs_sign(kp, [])


class TestBBSVerify:
    def test_verify_valid(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"hello", b"world"]
        sig = bbs_sign(kp, msgs)
        assert bbs_verify(kp.public_key, sig, msgs) is True

    def test_verify_wrong_message_count(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"hello"]
        sig = bbs_sign(kp, msgs)
        assert bbs_verify(kp.public_key, sig, [b"hello", b"extra"]) is False


class TestBBSProof:
    def test_create_proof(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"name", b"age", b"country"]
        sig = bbs_sign(kp, msgs)
        proof = bbs_create_proof(kp.public_key, sig, msgs, [0, 2])
        assert len(proof.value) == 32
        assert proof.disclosed_indices == (0, 2)

    def test_create_proof_invalid_index(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"a"]
        sig = bbs_sign(kp, msgs)
        with pytest.raises(ValueError, match="out of range"):
            bbs_create_proof(kp.public_key, sig, msgs, [5])

    def test_create_proof_wrong_message_count(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"a", b"b"]
        sig = bbs_sign(kp, msgs)
        with pytest.raises(ValueError, match="count"):
            bbs_create_proof(kp.public_key, sig, [b"a"], [0])

    def test_verify_proof_valid(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"name", b"age", b"country"]
        sig = bbs_sign(kp, msgs)
        proof = bbs_create_proof(kp.public_key, sig, msgs, [0, 2])
        disclosed = {0: msgs[0], 2: msgs[2]}
        assert bbs_verify_proof(kp.public_key, proof, disclosed) is True

    def test_verify_proof_wrong_indices(self) -> None:
        kp = BBSKeyPair.generate()
        msgs = [b"a", b"b"]
        sig = bbs_sign(kp, msgs)
        proof = bbs_create_proof(kp.public_key, sig, msgs, [0])
        # Provide wrong set of indices
        assert bbs_verify_proof(kp.public_key, proof, {0: msgs[0], 1: msgs[1]}) is False
