"""Sanctions and PEP screening.

Provides screening against mock sanctions/PEP watchlists for
compliance checking.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class ScreeningListType(Enum):
    """Types of screening lists."""

    SANCTIONS = "sanctions"
    PEP = "pep"
    ADVERSE_MEDIA = "adverse_media"


@dataclass(frozen=True)
class ScreeningEntry:
    """An entry in a screening watchlist.

    Attributes:
        name: Name of the listed entity.
        list_type: Type of list this entry is on.
        jurisdiction: Associated jurisdiction code.
        identifiers: Known identifiers (addresses, IDs, etc.).
        reason: Reason for listing.
    """

    name: str
    list_type: ScreeningListType
    jurisdiction: str
    identifiers: list[str] = field(default_factory=list)
    reason: str = ""


@dataclass(frozen=True)
class ScreeningResult:
    """Result of a screening check.

    Attributes:
        matched: Whether any matches were found.
        matches: List of matched entries.
        query: The original query.
    """

    matched: bool
    matches: list[ScreeningEntry] = field(default_factory=list)
    query: str = ""


class SanctionsScreener:
    """Screens entities against sanctions and PEP watchlists."""

    def __init__(self) -> None:
        """Initialize the screener with a default mock watchlist."""
        self._entries: list[ScreeningEntry] = []
        self._load_defaults()

    def _load_defaults(self) -> None:
        """Load default mock watchlist entries."""
        self._entries = [
            ScreeningEntry(
                name="Lazarus Group",
                list_type=ScreeningListType.SANCTIONS,
                jurisdiction="KP",
                identifiers=["0x" + "de" * 20, "lazarus.kp"],
                reason="State-sponsored cyber operations",
            ),
            ScreeningEntry(
                name="Tornado Cash",
                list_type=ScreeningListType.SANCTIONS,
                jurisdiction="GLOBAL",
                identifiers=["0x" + "ca" * 20],
                reason="OFAC SDN listing — mixer service",
            ),
            ScreeningEntry(
                name="Test PEP Entity",
                list_type=ScreeningListType.PEP,
                jurisdiction="XX",
                identifiers=["pep-test-001"],
                reason="Politically exposed person — test entry",
            ),
        ]

    def add_entry(self, entry: ScreeningEntry) -> None:
        """Add an entry to the watchlist.

        Args:
            entry: The screening entry to add.
        """
        self._entries.append(entry)

    def screen_name(self, name: str) -> ScreeningResult:
        """Screen a name against the watchlist.

        Performs case-insensitive substring matching.

        Args:
            name: The name to screen.

        Returns:
            ScreeningResult with any matches.
        """
        matches = [
            e for e in self._entries
            if name.lower() in e.name.lower() or e.name.lower() in name.lower()
        ]
        return ScreeningResult(matched=len(matches) > 0, matches=matches, query=name)

    def screen_identifier(self, identifier: str) -> ScreeningResult:
        """Screen an identifier (address, ID) against the watchlist.

        Args:
            identifier: The identifier to screen.

        Returns:
            ScreeningResult with any matches.
        """
        identifier_lower = identifier.lower()
        matches = [
            e for e in self._entries
            if any(identifier_lower == eid.lower() for eid in e.identifiers)
        ]
        return ScreeningResult(
            matched=len(matches) > 0, matches=matches, query=identifier
        )

    def screen_jurisdiction(self, jurisdiction_code: str) -> ScreeningResult:
        """Screen for entries associated with a jurisdiction.

        Args:
            jurisdiction_code: ISO 3166-1 alpha-2 code.

        Returns:
            ScreeningResult with any matches.
        """
        code_upper = jurisdiction_code.upper()
        matches = [
            e for e in self._entries
            if e.jurisdiction.upper() == code_upper
        ]
        return ScreeningResult(
            matched=len(matches) > 0, matches=matches, query=jurisdiction_code
        )
