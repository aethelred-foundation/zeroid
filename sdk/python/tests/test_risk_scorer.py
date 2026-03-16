"""Tests for zeroid.risk.scorer."""

from zeroid.risk.features import FeatureExtractor, RiskFeatures
from zeroid.risk.model import LogisticRegressionModel
from zeroid.risk.scorer import RiskAssessment, RiskLevel, RiskScorer, _score_to_level


class TestScoreToLevel:
    def test_low(self) -> None:
        assert _score_to_level(0.0) == RiskLevel.LOW
        assert _score_to_level(0.29) == RiskLevel.LOW

    def test_medium(self) -> None:
        assert _score_to_level(0.3) == RiskLevel.MEDIUM
        assert _score_to_level(0.59) == RiskLevel.MEDIUM

    def test_high(self) -> None:
        assert _score_to_level(0.6) == RiskLevel.HIGH
        assert _score_to_level(0.79) == RiskLevel.HIGH

    def test_critical(self) -> None:
        assert _score_to_level(0.8) == RiskLevel.CRITICAL
        assert _score_to_level(1.0) == RiskLevel.CRITICAL


class TestRiskLevel:
    def test_values(self) -> None:
        assert RiskLevel.LOW.value == "low"
        assert RiskLevel.MEDIUM.value == "medium"
        assert RiskLevel.HIGH.value == "high"
        assert RiskLevel.CRITICAL.value == "critical"


class TestRiskAssessment:
    def test_creation(self) -> None:
        features = RiskFeatures(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8)
        ra = RiskAssessment(
            score=0.5,
            level=RiskLevel.MEDIUM,
            features=features,
            contributing_factors=["test"],
        )
        assert ra.score == 0.5
        assert ra.level == RiskLevel.MEDIUM


class TestRiskScorer:
    def test_score_low_risk(self) -> None:
        scorer = RiskScorer()
        result = scorer.score({
            "credential_age_days": 3000,
            "issuer_reputation": 0.95,
            "verification_frequency": 80,
            "cross_chain_activity": 10,
            "jurisdiction_risk": 0.1,
            "credential_count": 40,
            "attestation_age_days": 5,
            "sanctions_proximity": 0.0,
        })
        assert result.score < 0.5
        assert result.level in (RiskLevel.LOW, RiskLevel.MEDIUM)

    def test_score_high_risk(self) -> None:
        scorer = RiskScorer()
        result = scorer.score({
            "credential_age_days": 1,
            "issuer_reputation": 0.05,
            "verification_frequency": 0,
            "cross_chain_activity": 900,
            "jurisdiction_risk": 0.95,
            "credential_count": 1,
            "attestation_age_days": 350,
            "sanctions_proximity": 0.9,
        })
        assert result.score > 0.5
        assert result.level in (RiskLevel.HIGH, RiskLevel.CRITICAL)

    def test_score_features(self) -> None:
        scorer = RiskScorer()
        features = RiskFeatures(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5)
        result = scorer.score_features(features)
        assert 0.0 <= result.score <= 1.0
        assert isinstance(result.level, RiskLevel)

    def test_custom_model(self) -> None:
        model = LogisticRegressionModel(
            weights=[1.0] * 8,
            bias=-4.0,
        )
        scorer = RiskScorer(model=model)
        result = scorer.score({
            "credential_age_days": 0,
            "issuer_reputation": 0.5,
            "verification_frequency": 0,
            "cross_chain_activity": 0,
            "jurisdiction_risk": 0,
            "credential_count": 0,
            "attestation_age_days": 0,
            "sanctions_proximity": 0.0,
        })
        assert 0.0 <= result.score <= 1.0

    def test_contributing_factors(self) -> None:
        scorer = RiskScorer()
        result = scorer.score({
            "credential_age_days": 1,
            "issuer_reputation": 0.05,
            "verification_frequency": 0,
            "cross_chain_activity": 900,
            "jurisdiction_risk": 0.95,
            "credential_count": 1,
            "attestation_age_days": 350,
            "sanctions_proximity": 0.9,
        })
        assert isinstance(result.contributing_factors, list)

    def test_score_features_contributing_factors(self) -> None:
        scorer = RiskScorer()
        features = RiskFeatures(0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1)
        result = scorer.score_features(features)
        # Low features => no contributing factors above threshold
        assert isinstance(result.contributing_factors, list)

    def test_default_weights(self) -> None:
        scorer = RiskScorer()
        assert len(scorer.model.weights) == 8
        assert scorer.model.bias == -2.0
