"""Sanctions and PEP screening.

Callers must provide current, authoritative watchlist entries before using this
module for compliance decisions. An unconfigured screener fails closed.
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
    error: str = ""


class SanctionsScreener:
    """Screens entities against sanctions and PEP watchlists."""

    def __init__(self, entries: list[ScreeningEntry] | None = None) -> None:
        """Initialize the screener with caller-supplied watchlist entries."""
        self._entries = list(entries or [])

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
        if not self._entries:
            return self._unconfigured_result(name)

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
        if not self._entries:
            return self._unconfigured_result(identifier)

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
        if not self._entries:
            return self._unconfigured_result(jurisdiction_code)

        code_upper = jurisdiction_code.upper()
        matches = [
            e for e in self._entries
            if e.jurisdiction.upper() == code_upper
        ]
        return ScreeningResult(
            matched=len(matches) > 0, matches=matches, query=jurisdiction_code
        )

    def _unconfigured_result(self, query: str) -> ScreeningResult:
        return ScreeningResult(
            matched=True,
            matches=[],
            query=query,
            error="screening watchlist entries are not configured",
        )
