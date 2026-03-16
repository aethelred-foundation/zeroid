"""Feature extraction from credentials and transactions.

Extracts numerical features from identity data for use in
ML-based risk scoring.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RiskFeatures:
    """Extracted risk features for ML scoring.

    All features are normalized to [0, 1] range.

    Attributes:
        credential_age_days: Age of oldest credential in days (normalized).
        issuer_reputation: Issuer reputation score (0-1).
        verification_frequency: How often credentials are verified (normalized).
        cross_chain_activity: Cross-chain activity count (normalized).
        jurisdiction_risk: Jurisdiction risk level (0-1).
        credential_count: Number of active credentials (normalized).
        attestation_freshness: Freshness of TEE attestation (normalized).
        sanctions_proximity: Proximity to sanctioned entities (0-1).
    """

    credential_age_days: float
    issuer_reputation: float
    verification_frequency: float
    cross_chain_activity: float
    jurisdiction_risk: float
    credential_count: float
    attestation_freshness: float
    sanctions_proximity: float

    def to_vector(self) -> list[float]:
        """Convert features to a numerical vector.

        Returns:
            List of feature values in canonical order.
        """
        return [
            self.credential_age_days,
            self.issuer_reputation,
            self.verification_frequency,
            self.cross_chain_activity,
            self.jurisdiction_risk,
            self.credential_count,
            self.attestation_freshness,
            self.sanctions_proximity,
        ]

    @staticmethod
    def feature_names() -> list[str]:
        """Get the canonical feature names in order.

        Returns:
            List of feature name strings.
        """
        return [
            "credential_age_days",
            "issuer_reputation",
            "verification_frequency",
            "cross_chain_activity",
            "jurisdiction_risk",
            "credential_count",
            "attestation_freshness",
            "sanctions_proximity",
        ]


def _clamp(value: float, min_val: float = 0.0, max_val: float = 1.0) -> float:
    """Clamp a value to a range.

    Args:
        value: Value to clamp.
        min_val: Minimum.
        max_val: Maximum.

    Returns:
        Clamped value.
    """
    return max(min_val, min(max_val, value))


class FeatureExtractor:
    """Extracts risk features from raw identity/credential data.

    Feature normalization ranges:
    - credential_age_days: 0-3650 days -> 0-1 (inverted: newer = higher risk)
    - issuer_reputation: 0-1 (inverted: lower rep = higher risk)
    - verification_frequency: 0-100 per month -> 0-1 (inverted)
    - cross_chain_activity: 0-1000 -> 0-1
    - jurisdiction_risk: 0-1 (direct)
    - credential_count: 0-50 -> 0-1 (inverted: fewer = higher risk)
    - attestation_freshness: 0-365 days -> 0-1 (inverted: older = higher risk)
    - sanctions_proximity: 0-1 (direct)
    """

    def __init__(
        self,
        max_credential_age: float = 3650.0,
        max_verification_freq: float = 100.0,
        max_cross_chain: float = 1000.0,
        max_credential_count: float = 50.0,
        max_attestation_age: float = 365.0,
    ) -> None:
        """Initialize the feature extractor with normalization parameters.

        Args:
            max_credential_age: Maximum credential age in days for normalization.
            max_verification_freq: Maximum verification frequency for normalization.
            max_cross_chain: Maximum cross-chain activity count.
            max_credential_count: Maximum credential count.
            max_attestation_age: Maximum attestation age in days.
        """
        self.max_credential_age = max_credential_age
        self.max_verification_freq = max_verification_freq
        self.max_cross_chain = max_cross_chain
        self.max_credential_count = max_credential_count
        self.max_attestation_age = max_attestation_age

    def extract(self, raw_data: dict[str, Any]) -> RiskFeatures:
        """Extract and normalize risk features from raw data.

        Expected raw_data keys:
        - credential_age_days (float): Age of oldest credential
        - issuer_reputation (float): 0-1 reputation score
        - verification_frequency (float): Verifications per month
        - cross_chain_activity (float): Number of cross-chain transactions
        - jurisdiction_risk (float): 0-1 jurisdiction risk
        - credential_count (float): Number of active credentials
        - attestation_age_days (float): Age of TEE attestation in days
        - sanctions_proximity (float): 0-1 proximity to sanctioned entities

        Args:
            raw_data: Dictionary of raw feature values.

        Returns:
            Normalized RiskFeatures.
        """
        # Credential age: newer is riskier (inverted normalization)
        age = float(raw_data.get("credential_age_days", 0))
        credential_age_norm = _clamp(1.0 - age / self.max_credential_age)

        # Issuer reputation: lower is riskier (invert)
        rep = float(raw_data.get("issuer_reputation", 0.5))
        issuer_rep_norm = _clamp(1.0 - rep)

        # Verification frequency: less frequent is riskier (invert)
        freq = float(raw_data.get("verification_frequency", 0))
        freq_norm = _clamp(1.0 - freq / self.max_verification_freq)

        # Cross-chain activity: more is potentially riskier
        xchain = float(raw_data.get("cross_chain_activity", 0))
        xchain_norm = _clamp(xchain / self.max_cross_chain)

        # Jurisdiction risk: direct
        jurisdiction_risk = _clamp(float(raw_data.get("jurisdiction_risk", 0.0)))

        # Credential count: fewer is riskier (invert)
        cred_count = float(raw_data.get("credential_count", 1))
        cred_count_norm = _clamp(1.0 - cred_count / self.max_credential_count)

        # Attestation freshness: older is riskier
        att_age = float(raw_data.get("attestation_age_days", 0))
        att_norm = _clamp(att_age / self.max_attestation_age)

        # Sanctions proximity: direct
        sanctions = _clamp(float(raw_data.get("sanctions_proximity", 0.0)))

        return RiskFeatures(
            credential_age_days=credential_age_norm,
            issuer_reputation=issuer_rep_norm,
            verification_frequency=freq_norm,
            cross_chain_activity=xchain_norm,
            jurisdiction_risk=jurisdiction_risk,
            credential_count=cred_count_norm,
            attestation_freshness=att_norm,
            sanctions_proximity=sanctions,
        )
