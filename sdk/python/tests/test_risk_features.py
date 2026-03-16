"""Tests for zeroid.risk.features."""

from zeroid.risk.features import FeatureExtractor, RiskFeatures, _clamp


class TestClamp:
    def test_within_range(self) -> None:
        assert _clamp(0.5) == 0.5

    def test_below_min(self) -> None:
        assert _clamp(-1.0) == 0.0

    def test_above_max(self) -> None:
        assert _clamp(2.0) == 1.0

    def test_at_bounds(self) -> None:
        assert _clamp(0.0) == 0.0
        assert _clamp(1.0) == 1.0


class TestRiskFeatures:
    def test_to_vector(self) -> None:
        rf = RiskFeatures(
            credential_age_days=0.1,
            issuer_reputation=0.2,
            verification_frequency=0.3,
            cross_chain_activity=0.4,
            jurisdiction_risk=0.5,
            credential_count=0.6,
            attestation_freshness=0.7,
            sanctions_proximity=0.8,
        )
        vec = rf.to_vector()
        assert len(vec) == 8
        assert vec == [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]

    def test_feature_names(self) -> None:
        names = RiskFeatures.feature_names()
        assert len(names) == 8
        assert "credential_age_days" in names
        assert "sanctions_proximity" in names


class TestFeatureExtractor:
    def test_extract_defaults(self) -> None:
        ext = FeatureExtractor()
        features = ext.extract({})
        vec = features.to_vector()
        assert len(vec) == 8
        # All values should be in [0, 1]
        for v in vec:
            assert 0.0 <= v <= 1.0

    def test_extract_low_risk(self) -> None:
        ext = FeatureExtractor()
        features = ext.extract({
            "credential_age_days": 3000,
            "issuer_reputation": 0.95,
            "verification_frequency": 80,
            "cross_chain_activity": 10,
            "jurisdiction_risk": 0.1,
            "credential_count": 40,
            "attestation_age_days": 5,
            "sanctions_proximity": 0.0,
        })
        # Old credential, high reputation, frequent verification => low risk features
        assert features.credential_age_days < 0.3  # old = low risk
        assert features.issuer_reputation < 0.2  # high rep = low risk
        assert features.sanctions_proximity == 0.0

    def test_extract_high_risk(self) -> None:
        ext = FeatureExtractor()
        features = ext.extract({
            "credential_age_days": 1,
            "issuer_reputation": 0.1,
            "verification_frequency": 0,
            "cross_chain_activity": 900,
            "jurisdiction_risk": 0.9,
            "credential_count": 1,
            "attestation_age_days": 300,
            "sanctions_proximity": 0.8,
        })
        assert features.credential_age_days > 0.9
        assert features.issuer_reputation > 0.8
        assert features.jurisdiction_risk == 0.9
        assert features.sanctions_proximity == 0.8

    def test_extract_clamping(self) -> None:
        ext = FeatureExtractor()
        features = ext.extract({
            "credential_age_days": -100,
            "issuer_reputation": 2.0,
            "verification_frequency": 999,
            "cross_chain_activity": 5000,
            "jurisdiction_risk": 5.0,
            "credential_count": 100,
            "attestation_age_days": 9999,
            "sanctions_proximity": -1.0,
        })
        vec = features.to_vector()
        for v in vec:
            assert 0.0 <= v <= 1.0

    def test_custom_normalization_params(self) -> None:
        ext = FeatureExtractor(
            max_credential_age=100.0,
            max_verification_freq=10.0,
            max_cross_chain=100.0,
            max_credential_count=10.0,
            max_attestation_age=30.0,
        )
        features = ext.extract({
            "credential_age_days": 50,
            "verification_frequency": 5,
            "cross_chain_activity": 50,
            "credential_count": 5,
            "attestation_age_days": 15,
        })
        assert features.credential_age_days == 0.5
        assert features.cross_chain_activity == 0.5
        assert features.attestation_freshness == 0.5
