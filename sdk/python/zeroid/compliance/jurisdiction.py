"""Jurisdiction definitions and rules.

Defines regulatory jurisdictions with their required credentials,
risk levels, and regulatory framework identifiers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class RegulatoryFramework(Enum):
    """Known regulatory frameworks."""

    FATF = "FATF"
    GDPR = "GDPR"
    MiCA = "MiCA"
    BSA_AML = "BSA/AML"
    MAS_PSA = "MAS-PSA"
    JFSA = "JFSA"
    VARA = "VARA"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class Jurisdiction:
    """A regulatory jurisdiction definition.

    Attributes:
        code: ISO 3166-1 alpha-2 country code.
        name: Human-readable jurisdiction name.
        risk_level: Base risk level (0.0-1.0).
        required_credentials: Credential types required in this jurisdiction.
        frameworks: Applicable regulatory frameworks.
        sanctions_regime: Whether the jurisdiction has an active sanctions regime.
        allows_cross_border: Whether cross-border transfers are permitted.
    """

    code: str
    name: str
    risk_level: float
    required_credentials: list[str] = field(default_factory=list)
    frameworks: list[RegulatoryFramework] = field(default_factory=list)
    sanctions_regime: bool = False
    allows_cross_border: bool = True


class JurisdictionRegistry:
    """Registry of known jurisdictions with their regulatory rules."""

    def __init__(self) -> None:
        """Initialize the registry with default jurisdictions."""
        self._jurisdictions: dict[str, Jurisdiction] = {}
        self._load_defaults()

    def _load_defaults(self) -> None:
        """Load default jurisdiction definitions."""
        defaults = [
            Jurisdiction(
                code="US",
                name="United States",
                risk_level=0.2,
                required_credentials=["KYCCredential", "AccreditedInvestorCredential"],
                frameworks=[RegulatoryFramework.BSA_AML, RegulatoryFramework.FATF],
                allows_cross_border=True,
            ),
            Jurisdiction(
                code="EU",
                name="European Union",
                risk_level=0.2,
                required_credentials=["KYCCredential", "GDPRConsentCredential"],
                frameworks=[RegulatoryFramework.MiCA, RegulatoryFramework.GDPR, RegulatoryFramework.FATF],
                allows_cross_border=True,
            ),
            Jurisdiction(
                code="AE",
                name="United Arab Emirates",
                risk_level=0.3,
                required_credentials=["KYCCredential", "VARALicenseCredential"],
                frameworks=[RegulatoryFramework.VARA, RegulatoryFramework.FATF],
                allows_cross_border=True,
            ),
            Jurisdiction(
                code="SG",
                name="Singapore",
                risk_level=0.15,
                required_credentials=["KYCCredential"],
                frameworks=[RegulatoryFramework.MAS_PSA, RegulatoryFramework.FATF],
                allows_cross_border=True,
            ),
            Jurisdiction(
                code="JP",
                name="Japan",
                risk_level=0.2,
                required_credentials=["KYCCredential", "JFSARegistrationCredential"],
                frameworks=[RegulatoryFramework.JFSA, RegulatoryFramework.FATF],
                allows_cross_border=True,
            ),
            Jurisdiction(
                code="KP",
                name="North Korea",
                risk_level=1.0,
                required_credentials=[],
                frameworks=[],
                sanctions_regime=True,
                allows_cross_border=False,
            ),
            Jurisdiction(
                code="IR",
                name="Iran",
                risk_level=0.95,
                required_credentials=[],
                frameworks=[],
                sanctions_regime=True,
                allows_cross_border=False,
            ),
        ]
        for j in defaults:
            self._jurisdictions[j.code] = j

    def get(self, code: str) -> Jurisdiction | None:
        """Get a jurisdiction by country code.

        Args:
            code: ISO 3166-1 alpha-2 code.

        Returns:
            The jurisdiction, or None if not found.
        """
        return self._jurisdictions.get(code.upper())

    def register(self, jurisdiction: Jurisdiction) -> None:
        """Register or update a jurisdiction.

        Args:
            jurisdiction: The jurisdiction to register.
        """
        self._jurisdictions[jurisdiction.code] = jurisdiction

    def list_codes(self) -> list[str]:
        """List all registered jurisdiction codes.

        Returns:
            List of country codes.
        """
        return sorted(self._jurisdictions.keys())

    def is_sanctioned(self, code: str) -> bool:
        """Check if a jurisdiction is under sanctions.

        Args:
            code: ISO 3166-1 alpha-2 code.

        Returns:
            True if the jurisdiction has an active sanctions regime.
            Returns False for unknown jurisdictions.
        """
        j = self._jurisdictions.get(code.upper())
        if j is None:
            return False
        return j.sanctions_regime
