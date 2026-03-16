"""ML risk scoring for identity credentials.

Combines feature extraction with a logistic regression model to produce
risk scores and levels for ZeroID identities.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from zeroid.risk.features import FeatureExtractor, RiskFeatures
from zeroid.risk.model import LogisticRegressionModel


class RiskLevel(Enum):
    """Risk level classification."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass(frozen=True)
class RiskAssessment:
    """A risk assessment result.

    Attributes:
        score: Risk score between 0.0 and 1.0.
        level: Categorical risk level.
        features: The features used for scoring.
        contributing_factors: Top contributing risk factors.
    """

    score: float
    level: RiskLevel
    features: RiskFeatures
    contributing_factors: list[str]


def _score_to_level(score: float) -> RiskLevel:
    """Map a risk score to a risk level.

    Args:
        score: Risk score in [0, 1].

    Returns:
        Corresponding RiskLevel.
    """
    if score < 0.3:
        return RiskLevel.LOW
    if score < 0.6:
        return RiskLevel.MEDIUM
    if score < 0.8:
        return RiskLevel.HIGH
    return RiskLevel.CRITICAL


class RiskScorer:
    """ML-based risk scorer for ZeroID identities.

    Combines feature extraction with a trained logistic regression model
    to produce risk assessments.
    """

    # Default weights calibrated for identity risk factors
    DEFAULT_WEIGHTS = [
        0.5,   # credential_age_days
        0.8,   # issuer_reputation
        0.3,   # verification_frequency
        0.4,   # cross_chain_activity
        1.2,   # jurisdiction_risk
        0.3,   # credential_count
        0.6,   # attestation_freshness
        2.0,   # sanctions_proximity
    ]
    DEFAULT_BIAS = -2.0

    def __init__(
        self,
        model: LogisticRegressionModel | None = None,
        extractor: FeatureExtractor | None = None,
    ) -> None:
        """Initialize the risk scorer.

        Args:
            model: Trained logistic regression model (uses defaults if None).
            extractor: Feature extractor (creates default if None).
        """
        self.extractor = extractor or FeatureExtractor()
        if model is not None:
            self.model = model
        else:
            self.model = LogisticRegressionModel(
                weights=list(self.DEFAULT_WEIGHTS),
                bias=self.DEFAULT_BIAS,
            )

    def score(self, raw_data: dict[str, Any]) -> RiskAssessment:
        """Score an identity's risk from raw data.

        Args:
            raw_data: Raw feature data (see FeatureExtractor.extract).

        Returns:
            A RiskAssessment with score, level, and contributing factors.
        """
        features = self.extractor.extract(raw_data)
        vector = features.to_vector()
        risk_score = self.model.predict(vector)
        level = _score_to_level(risk_score)

        # Determine top contributing factors
        feature_names = RiskFeatures.feature_names()
        importance = self.model.get_feature_importance()
        contributing = []
        for idx, weight in importance[:3]:
            if idx < len(feature_names) and vector[idx] > 0.3:
                contributing.append(
                    f"{feature_names[idx]} ({vector[idx]:.2f})"
                )

        return RiskAssessment(
            score=risk_score,
            level=level,
            features=features,
            contributing_factors=contributing,
        )

    def score_features(self, features: RiskFeatures) -> RiskAssessment:
        """Score risk from pre-extracted features.

        Args:
            features: Pre-extracted RiskFeatures.

        Returns:
            A RiskAssessment.
        """
        vector = features.to_vector()
        risk_score = self.model.predict(vector)
        level = _score_to_level(risk_score)

        feature_names = RiskFeatures.feature_names()
        importance = self.model.get_feature_importance()
        contributing = []
        for idx, weight in importance[:3]:
            if idx < len(feature_names) and vector[idx] > 0.3:
                contributing.append(
                    f"{feature_names[idx]} ({vector[idx]:.2f})"
                )

        return RiskAssessment(
            score=risk_score,
            level=level,
            features=features,
            contributing_factors=contributing,
        )
