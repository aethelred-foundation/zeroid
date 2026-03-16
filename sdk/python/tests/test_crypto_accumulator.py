"""Tests for zeroid.crypto.accumulator."""

import pytest

from zeroid.crypto.accumulator import Accumulator, hmac_compare


class TestAccumulator:
    def test_initial_state(self) -> None:
        acc = Accumulator()
        assert len(acc.state) == 32
        assert len(acc.members) == 0

    def test_add(self) -> None:
        acc = Accumulator()
        old_state = acc.state
        new_state = acc.add(b"element1")
        assert new_state != old_state
        assert acc.is_member(b"element1")

    def test_add_duplicate_raises(self) -> None:
        acc = Accumulator()
        acc.add(b"element1")
        with pytest.raises(ValueError, match="already"):
            acc.add(b"element1")

    def test_remove(self) -> None:
        acc = Accumulator()
        acc.add(b"element1")
        acc.remove(b"element1")
        assert not acc.is_member(b"element1")

    def test_remove_nonmember_raises(self) -> None:
        acc = Accumulator()
        with pytest.raises(ValueError, match="not in"):
            acc.remove(b"element1")

    def test_is_member(self) -> None:
        acc = Accumulator()
        assert not acc.is_member(b"x")
        acc.add(b"x")
        assert acc.is_member(b"x")

    def test_witness(self) -> None:
        acc = Accumulator()
        acc.add(b"element1")
        witness = acc.witness(b"element1")
        assert len(witness) == 32

    def test_witness_nonmember_raises(self) -> None:
        acc = Accumulator()
        with pytest.raises(ValueError, match="non-member"):
            acc.witness(b"element1")

    def test_verify_witness_valid(self) -> None:
        acc = Accumulator()
        acc.add(b"element1")
        witness = acc.witness(b"element1")
        assert acc.verify_witness(b"element1", witness) is True

    def test_verify_witness_invalid(self) -> None:
        acc = Accumulator()
        acc.add(b"element1")
        assert acc.verify_witness(b"element1", b"\x00" * 32) is False

    def test_verify_witness_nonmember(self) -> None:
        acc = Accumulator()
        assert acc.verify_witness(b"element1", b"\x00" * 32) is False

    def test_state_changes_on_operations(self) -> None:
        acc = Accumulator()
        s0 = acc.state
        acc.add(b"a")
        s1 = acc.state
        acc.add(b"b")
        s2 = acc.state
        assert s0 != s1 != s2


class TestHmacCompare:
    def test_equal(self) -> None:
        assert hmac_compare(b"abc", b"abc") is True

    def test_not_equal(self) -> None:
        assert hmac_compare(b"abc", b"abd") is False

    def test_different_lengths(self) -> None:
        assert hmac_compare(b"ab", b"abc") is False

    def test_empty(self) -> None:
        assert hmac_compare(b"", b"") is True
