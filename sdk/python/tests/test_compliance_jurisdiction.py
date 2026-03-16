"""Tests for zeroid.compliance.jurisdiction."""

from zeroid.compliance.jurisdiction import (
    Jurisdiction,
    JurisdictionRegistry,
    RegulatoryFramework,
)


class TestRegulatoryFramework:
    def test_values(self) -> None:
        assert RegulatoryFramework.FATF.value == "FATF"
        assert RegulatoryFramework.GDPR.value == "GDPR"
        assert RegulatoryFramework.MiCA.value == "MiCA"
        assert RegulatoryFramework.BSA_AML.value == "BSA/AML"
        assert RegulatoryFramework.MAS_PSA.value == "MAS-PSA"
        assert RegulatoryFramework.JFSA.value == "JFSA"
        assert RegulatoryFramework.VARA.value == "VARA"
        assert RegulatoryFramework.UNKNOWN.value == "UNKNOWN"


class TestJurisdiction:
    def test_creation(self) -> None:
        j = Jurisdiction(code="US", name="United States", risk_level=0.2)
        assert j.code == "US"
        assert j.sanctions_regime is False
        assert j.allows_cross_border is True
        assert j.required_credentials == []
        assert j.frameworks == []

    def test_sanctioned(self) -> None:
        j = Jurisdiction(
            code="KP", name="North Korea", risk_level=1.0, sanctions_regime=True
        )
        assert j.sanctions_regime is True


class TestJurisdictionRegistry:
    def test_defaults_loaded(self) -> None:
        reg = JurisdictionRegistry()
        codes = reg.list_codes()
        assert "US" in codes
        assert "EU" in codes
        assert "SG" in codes
        assert "JP" in codes
        assert "AE" in codes
        assert "KP" in codes
        assert "IR" in codes

    def test_get_existing(self) -> None:
        reg = JurisdictionRegistry()
        us = reg.get("US")
        assert us is not None
        assert us.name == "United States"
        assert RegulatoryFramework.BSA_AML in us.frameworks

    def test_get_case_insensitive(self) -> None:
        reg = JurisdictionRegistry()
        assert reg.get("us") is not None

    def test_get_not_found(self) -> None:
        reg = JurisdictionRegistry()
        assert reg.get("ZZ") is None

    def test_register_new(self) -> None:
        reg = JurisdictionRegistry()
        j = Jurisdiction(code="XX", name="Test", risk_level=0.5)
        reg.register(j)
        assert reg.get("XX") is j

    def test_register_overwrite(self) -> None:
        reg = JurisdictionRegistry()
        j = Jurisdiction(code="US", name="Updated US", risk_level=0.1)
        reg.register(j)
        assert reg.get("US") is not None
        assert reg.get("US").name == "Updated US"

    def test_is_sanctioned(self) -> None:
        reg = JurisdictionRegistry()
        assert reg.is_sanctioned("KP") is True
        assert reg.is_sanctioned("IR") is True
        assert reg.is_sanctioned("US") is False

    def test_is_sanctioned_unknown(self) -> None:
        reg = JurisdictionRegistry()
        assert reg.is_sanctioned("ZZ") is False

    def test_is_sanctioned_case_insensitive(self) -> None:
        reg = JurisdictionRegistry()
        assert reg.is_sanctioned("kp") is True

    def test_list_codes_sorted(self) -> None:
        reg = JurisdictionRegistry()
        codes = reg.list_codes()
        assert codes == sorted(codes)
