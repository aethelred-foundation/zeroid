"""Compliance rule engine.

Evaluates credential compliance against jurisdiction requirements,
sanctions screening, and cross-border transfer rules.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from zeroid.compliance.jurisdiction import JurisdictionRegistry
from zeroid.compliance.screening import SanctionsScreener, ScreeningResult


@dataclass(frozen=True)
class ComplianceCheckResult:
    """Result of a compliance check.

    Attributes:
        compliant: Whether the entity is compliant.
        errors: List of compliance violations.
        warnings: List of non-blocking compliance warnings.
        jurisdiction_code: The jurisdiction checked against.
    """

    compliant: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    jurisdiction_code: str = ""


@dataclass(frozen=True)
class CrossBorderCheckResult:
    """Result of a cross-border transfer compliance check.

    Attributes:
        allowed: Whether the transfer is permitted.
        errors: List of violations blocking the transfer.
        warnings: List of non-blocking warnings.
        source_jurisdiction: Source jurisdiction code.
        target_jurisdiction: Target jurisdiction code.
    """

    allowed: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    source_jurisdiction: str = ""
    target_jurisdiction: str = ""


class ComplianceEngine:
    """Evaluates compliance against jurisdictional rules and sanctions.

    Attributes:
        jurisdiction_registry: Registry of jurisdiction definitions.
        screener: Sanctions/PEP screening service.
    """

    def __init__(
        self,
        jurisdiction_registry: JurisdictionRegistry | None = None,
        screener: SanctionsScreener | None = None,
    ) -> None:
        """Initialize the compliance engine.

        Args:
            jurisdiction_registry: Jurisdiction registry (default created if None).
            screener: Sanctions screener (default created if None).
        """
        self.jurisdiction_registry = jurisdiction_registry or JurisdictionRegistry()
        self.screener = screener or SanctionsScreener()

    def check_credentials(
        self,
        jurisdiction_code: str,
        held_credential_types: list[str],
    ) -> ComplianceCheckResult:
        """Check if held credentials satisfy jurisdiction requirements.

        Args:
            jurisdiction_code: The jurisdiction to check against.
            held_credential_types: List of credential type names the entity holds.

        Returns:
            ComplianceCheckResult indicating compliance status.
        """
        jurisdiction = self.jurisdiction_registry.get(jurisdiction_code)
        if jurisdiction is None:
            return ComplianceCheckResult(
                compliant=False,
                errors=[f"Unknown jurisdiction: {jurisdiction_code}"],
                jurisdiction_code=jurisdiction_code,
            )

        if jurisdiction.sanctions_regime:
            return ComplianceCheckResult(
                compliant=False,
                errors=[f"Jurisdiction {jurisdiction_code} is under sanctions"],
                jurisdiction_code=jurisdiction_code,
            )

        errors: list[str] = []
        warnings: list[str] = []
        held_set = set(held_credential_types)

        for required in jurisdiction.required_credentials:
            if required not in held_set:
                errors.append(f"Missing required credential: {required}")

        if jurisdiction.risk_level >= 0.5:
            warnings.append(
                f"High-risk jurisdiction (risk level: {jurisdiction.risk_level})"
            )

        return ComplianceCheckResult(
            compliant=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            jurisdiction_code=jurisdiction_code,
        )

    def screen_entity(
        self,
        name: str = "",
        identifier: str = "",
    ) -> ScreeningResult:
        """Screen an entity against sanctions and PEP watchlists.

        At least one of name or identifier must be provided.

        Args:
            name: Entity name to screen.
            identifier: Entity identifier to screen.

        Returns:
            ScreeningResult with match details.

        Raises:
            ValueError: If neither name nor identifier is provided.
        """
        if not name and not identifier:
            raise ValueError("At least one of name or identifier must be provided")

        if name:
            result = self.screener.screen_name(name)
            if result.matched:
                return result

        if identifier:
            return self.screener.screen_identifier(identifier)

        return self.screener.screen_name(name)

    def check_cross_border(
        self,
        source_code: str,
        target_code: str,
        held_credential_types: list[str],
    ) -> CrossBorderCheckResult:
        """Check compliance for a cross-border transfer.

        Args:
            source_code: Source jurisdiction code.
            target_code: Target jurisdiction code.
            held_credential_types: Credential types held by the transferor.

        Returns:
            CrossBorderCheckResult indicating whether the transfer is allowed.
        """
        errors: list[str] = []
        warnings: list[str] = []

        source = self.jurisdiction_registry.get(source_code)
        target = self.jurisdiction_registry.get(target_code)

        if source is None:
            errors.append(f"Unknown source jurisdiction: {source_code}")
        if target is None:
            errors.append(f"Unknown target jurisdiction: {target_code}")

        if errors:
            return CrossBorderCheckResult(
                allowed=False,
                errors=errors,
                source_jurisdiction=source_code,
                target_jurisdiction=target_code,
            )

        assert source is not None and target is not None  # for type checker

        if source.sanctions_regime:
            errors.append(f"Source jurisdiction {source_code} is under sanctions")
        if target.sanctions_regime:
            errors.append(f"Target jurisdiction {target_code} is under sanctions")

        if not source.allows_cross_border:
            errors.append(
                f"Source jurisdiction {source_code} does not allow cross-border transfers"
            )
        if not target.allows_cross_border:
            errors.append(
                f"Target jurisdiction {target_code} does not allow cross-border transfers"
            )

        # Check credentials for both jurisdictions
        held_set = set(held_credential_types)
        all_required = set(source.required_credentials) | set(target.required_credentials)
        for req in all_required:
            if req not in held_set:
                errors.append(f"Missing credential for cross-border: {req}")

        combined_risk = (source.risk_level + target.risk_level) / 2
        if combined_risk >= 0.4:
            warnings.append(
                f"Elevated corridor risk: {combined_risk:.2f}"
            )

        return CrossBorderCheckResult(
            allowed=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            source_jurisdiction=source_code,
            target_jurisdiction=target_code,
        )
