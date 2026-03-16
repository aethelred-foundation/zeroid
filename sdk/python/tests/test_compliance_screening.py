"""Tests for zeroid.compliance.screening."""

from zeroid.compliance.screening import (
    SanctionsScreener,
    ScreeningEntry,
    ScreeningListType,
    ScreeningResult,
)


class TestScreeningListType:
    def test_values(self) -> None:
        assert ScreeningListType.SANCTIONS.value == "sanctions"
        assert ScreeningListType.PEP.value == "pep"
        assert ScreeningListType.ADVERSE_MEDIA.value == "adverse_media"


class TestScreeningEntry:
    def test_creation(self) -> None:
        e = ScreeningEntry(
            name="Test",
            list_type=ScreeningListType.SANCTIONS,
            jurisdiction="US",
        )
        assert e.identifiers == []
        assert e.reason == ""


class TestScreeningResult:
    def test_creation(self) -> None:
        r = ScreeningResult(matched=False)
        assert r.matches == []
        assert r.query == ""


class TestSanctionsScreener:
    def test_defaults_loaded(self) -> None:
        screener = SanctionsScreener()
        result = screener.screen_name("Lazarus")
        assert result.matched is True
        assert len(result.matches) == 1

    def test_screen_name_no_match(self) -> None:
        screener = SanctionsScreener()
        result = screener.screen_name("Innocent Corp")
        assert result.matched is False

    def test_screen_name_case_insensitive(self) -> None:
        screener = SanctionsScreener()
        result = screener.screen_name("lazarus group")
        assert result.matched is True

    def test_screen_name_substring(self) -> None:
        screener = SanctionsScreener()
        result = screener.screen_name("Tornado")
        assert result.matched is True

    def test_screen_identifier_match(self) -> None:
        screener = SanctionsScreener()
        result = screener.screen_identifier("0x" + "de" * 20)
        assert result.matched is True

    def test_screen_identifier_no_match(self) -> None:
        screener = SanctionsScreener()
        result = screener.screen_identifier("0x" + "00" * 20)
        assert result.matched is False

    def test_screen_identifier_case_insensitive(self) -> None:
        screener = SanctionsScreener()
        result = screener.screen_identifier("0x" + "DE" * 20)
        assert result.matched is True

    def test_screen_jurisdiction_match(self) -> None:
        screener = SanctionsScreener()
        result = screener.screen_jurisdiction("KP")
        assert result.matched is True

    def test_screen_jurisdiction_no_match(self) -> None:
        screener = SanctionsScreener()
        result = screener.screen_jurisdiction("US")
        assert result.matched is False

    def test_screen_jurisdiction_case_insensitive(self) -> None:
        screener = SanctionsScreener()
        result = screener.screen_jurisdiction("kp")
        assert result.matched is True

    def test_add_entry(self) -> None:
        screener = SanctionsScreener()
        entry = ScreeningEntry(
            name="Custom Entity",
            list_type=ScreeningListType.ADVERSE_MEDIA,
            jurisdiction="XX",
            identifiers=["custom-id"],
        )
        screener.add_entry(entry)
        result = screener.screen_name("Custom Entity")
        assert result.matched is True
        result2 = screener.screen_identifier("custom-id")
        assert result2.matched is True

    def test_query_preserved(self) -> None:
        screener = SanctionsScreener()
        result = screener.screen_name("TestQuery")
        assert result.query == "TestQuery"
