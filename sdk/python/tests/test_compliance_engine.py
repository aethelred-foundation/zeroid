"""Tests for zeroid.compliance.engine."""

import pytest

from zeroid.compliance.engine import ComplianceEngine, ComplianceCheckResult, CrossBorderCheckResult


class TestComplianceEngine:
    def test_check_credentials_compliant(self) -> None:
        engine = ComplianceEngine()
        result = engine.check_credentials(
            "SG", ["KYCCredential"]
        )
        assert result.compliant is True
        assert result.jurisdiction_code == "SG"

    def test_check_credentials_missing(self) -> None:
        engine = ComplianceEngine()
        result = engine.check_credentials("US", ["KYCCredential"])
        assert result.compliant is False
        assert any("AccreditedInvestorCredential" in e for e in result.errors)

    def test_check_credentials_sanctioned(self) -> None:
        engine = ComplianceEngine()
        result = engine.check_credentials("KP", [])
        assert result.compliant is False
        assert any("sanctions" in e.lower() for e in result.errors)

    def test_check_credentials_unknown_jurisdiction(self) -> None:
        engine = ComplianceEngine()
        result = engine.check_credentials("ZZ", [])
        assert result.compliant is False
        assert any("Unknown" in e for e in result.errors)

    def test_check_credentials_high_risk_warning(self) -> None:
        from zeroid.compliance.jurisdiction import Jurisdiction, JurisdictionRegistry
        reg = JurisdictionRegistry()
        reg.register(Jurisdiction(
            code="HR", name="High Risk", risk_level=0.7,
            required_credentials=["KYCCredential"],
        ))
        engine = ComplianceEngine(jurisdiction_registry=reg)
        result = engine.check_credentials("HR", ["KYCCredential"])
        assert result.compliant is True
        assert any("risk" in w.lower() for w in result.warnings)

    def test_screen_entity_by_name(self) -> None:
        engine = ComplianceEngine()
        result = engine.screen_entity(name="Lazarus Group")
        assert result.matched is True

    def test_screen_entity_by_identifier(self) -> None:
        engine = ComplianceEngine()
        result = engine.screen_entity(identifier="0x" + "de" * 20)
        assert result.matched is True

    def test_screen_entity_no_match(self) -> None:
        engine = ComplianceEngine()
        result = engine.screen_entity(name="Good Actor")
        assert result.matched is False

    def test_screen_entity_no_args_raises(self) -> None:
        engine = ComplianceEngine()
        with pytest.raises(ValueError, match="At least one"):
            engine.screen_entity()

    def test_screen_entity_name_no_match_falls_to_identifier(self) -> None:
        engine = ComplianceEngine()
        result = engine.screen_entity(
            name="Not Found", identifier="0x" + "de" * 20
        )
        assert result.matched is True

    def test_check_cross_border_allowed(self) -> None:
        engine = ComplianceEngine()
        result = engine.check_cross_border(
            "SG", "JP",
            ["KYCCredential", "JFSARegistrationCredential"],
        )
        assert result.allowed is True
        assert result.source_jurisdiction == "SG"
        assert result.target_jurisdiction == "JP"

    def test_check_cross_border_sanctioned_source(self) -> None:
        engine = ComplianceEngine()
        result = engine.check_cross_border("KP", "US", [])
        assert result.allowed is False
        assert any("sanctions" in e.lower() for e in result.errors)

    def test_check_cross_border_sanctioned_target(self) -> None:
        engine = ComplianceEngine()
        result = engine.check_cross_border("US", "IR", [])
        assert result.allowed is False

    def test_check_cross_border_not_allowed(self) -> None:
        engine = ComplianceEngine()
        result = engine.check_cross_border("KP", "IR", [])
        assert result.allowed is False
        assert any("cross-border" in e.lower() for e in result.errors)

    def test_check_cross_border_unknown_source(self) -> None:
        engine = ComplianceEngine()
        result = engine.check_cross_border("ZZ", "US", [])
        assert result.allowed is False

    def test_check_cross_border_unknown_target(self) -> None:
        engine = ComplianceEngine()
        result = engine.check_cross_border("US", "ZZ", [])
        assert result.allowed is False

    def test_check_cross_border_missing_credentials(self) -> None:
        engine = ComplianceEngine()
        result = engine.check_cross_border("US", "EU", [])
        assert result.allowed is False

    def test_check_cross_border_elevated_risk_warning(self) -> None:
        from zeroid.compliance.jurisdiction import Jurisdiction, JurisdictionRegistry
        reg = JurisdictionRegistry()
        reg.register(Jurisdiction(
            code="H1", name="High1", risk_level=0.5,
            required_credentials=[],
        ))
        reg.register(Jurisdiction(
            code="H2", name="High2", risk_level=0.5,
            required_credentials=[],
        ))
        engine = ComplianceEngine(jurisdiction_registry=reg)
        result = engine.check_cross_border("H1", "H2", [])
        assert result.allowed is True
        assert any("risk" in w.lower() for w in result.warnings)


class TestComplianceCheckResult:
    def test_defaults(self) -> None:
        r = ComplianceCheckResult(compliant=True)
        assert r.errors == []
        assert r.warnings == []
        assert r.jurisdiction_code == ""


class TestCrossBorderCheckResult:
    def test_defaults(self) -> None:
        r = CrossBorderCheckResult(allowed=True)
        assert r.errors == []
        assert r.warnings == []
