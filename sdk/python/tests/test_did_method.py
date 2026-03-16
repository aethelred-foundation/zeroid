"""Tests for zeroid.did.method."""

import pytest

from zeroid.did.method import ZeroMethod


class TestZeroMethodValidate:
    def test_valid_did(self) -> None:
        assert ZeroMethod.validate("did:zero:" + "ab" * 20) is True

    def test_valid_did_with_0x(self) -> None:
        assert ZeroMethod.validate("did:zero:0x" + "ab" * 20) is True

    def test_invalid_method(self) -> None:
        assert ZeroMethod.validate("did:other:" + "ab" * 20) is False

    def test_invalid_length(self) -> None:
        assert ZeroMethod.validate("did:zero:abcd") is False

    def test_invalid_chars(self) -> None:
        assert ZeroMethod.validate("did:zero:" + "zz" * 20) is False

    def test_empty(self) -> None:
        assert ZeroMethod.validate("") is False


class TestZeroMethodParseAddress:
    def test_parse(self) -> None:
        addr = "ab" * 20
        result = ZeroMethod.parse_address(f"did:zero:{addr}")
        assert result == addr

    def test_parse_with_0x(self) -> None:
        addr = "CD" * 20
        result = ZeroMethod.parse_address(f"did:zero:0x{addr}")
        assert result == addr.lower()

    def test_invalid_raises(self) -> None:
        with pytest.raises(ValueError, match="Invalid"):
            ZeroMethod.parse_address("did:zero:short")


class TestZeroMethodFromAddress:
    def test_from_address(self) -> None:
        addr = "ab" * 20
        assert ZeroMethod.from_address(addr) == f"did:zero:{addr}"

    def test_from_address_with_0x(self) -> None:
        addr = "AB" * 20
        result = ZeroMethod.from_address(f"0x{addr}")
        assert result == f"did:zero:{addr.lower()}"

    def test_invalid_raises(self) -> None:
        with pytest.raises(ValueError, match="Invalid"):
            ZeroMethod.from_address("short")

    def test_uppercase_normalized(self) -> None:
        addr = "AB" * 20
        result = ZeroMethod.from_address(addr)
        assert result == f"did:zero:{addr.lower()}"


class TestZeroMethodComputeHash:
    def test_compute(self) -> None:
        did = "did:zero:" + "ab" * 20
        h = ZeroMethod.compute_did_hash(did)
        assert len(h) == 32

    def test_deterministic(self) -> None:
        did = "did:zero:" + "ab" * 20
        assert ZeroMethod.compute_did_hash(did) == ZeroMethod.compute_did_hash(did)

    def test_invalid_raises(self) -> None:
        with pytest.raises(ValueError, match="Invalid"):
            ZeroMethod.compute_did_hash("did:zero:bad")


class TestZeroMethodConstants:
    def test_method(self) -> None:
        assert ZeroMethod.METHOD == "zero"

    def test_prefix(self) -> None:
        assert ZeroMethod.PREFIX == "did:zero:"
