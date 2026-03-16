"""Risk model — logistic regression implemented from scratch.

Provides a simple logistic regression model for risk scoring
without external ML library dependencies.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field


def _sigmoid(x: float) -> float:
    """Compute the sigmoid function.

    Args:
        x: Input value.

    Returns:
        Sigmoid output in (0, 1).
    """
    # Clamp to avoid overflow
    x = max(-500.0, min(500.0, x))
    return 1.0 / (1.0 + math.exp(-x))


@dataclass
class LogisticRegressionModel:
    """A simple logistic regression model for risk scoring.

    Attributes:
        weights: Feature weights (one per feature).
        bias: Model bias term.
        learning_rate: Learning rate for training.
    """

    weights: list[float] = field(default_factory=list)
    bias: float = 0.0
    learning_rate: float = 0.01

    def initialize(self, n_features: int) -> None:
        """Initialize weights to default values.

        Args:
            n_features: Number of input features.
        """
        self.weights = [0.0] * n_features
        self.bias = 0.0

    def predict(self, features: list[float]) -> float:
        """Predict the risk probability for a feature vector.

        Args:
            features: Input feature vector.

        Returns:
            Risk probability in [0, 1].

        Raises:
            ValueError: If feature count does not match weight count.
        """
        if len(features) != len(self.weights):
            raise ValueError(
                f"Expected {len(self.weights)} features, got {len(features)}"
            )
        z = self.bias
        for w, f in zip(self.weights, features):
            z += w * f
        return _sigmoid(z)

    def train_step(
        self, features: list[float], label: float
    ) -> float:
        """Perform one gradient descent step.

        Args:
            features: Input feature vector.
            label: True label (0.0 or 1.0).

        Returns:
            The prediction before the update.

        Raises:
            ValueError: If feature count does not match weight count.
        """
        pred = self.predict(features)
        error = pred - label

        # Update weights
        for i in range(len(self.weights)):
            self.weights[i] -= self.learning_rate * error * features[i]
        self.bias -= self.learning_rate * error

        return pred

    def train(
        self,
        dataset: list[tuple[list[float], float]],
        epochs: int = 100,
    ) -> list[float]:
        """Train the model on a dataset.

        Args:
            dataset: List of (features, label) pairs.
            epochs: Number of training epochs.

        Returns:
            List of average loss per epoch.
        """
        if not dataset:
            return []

        if not self.weights:
            self.initialize(len(dataset[0][0]))

        losses: list[float] = []
        for _ in range(epochs):
            epoch_loss = 0.0
            for features, label in dataset:
                pred = self.predict(features)
                # Binary cross-entropy loss
                eps = 1e-15
                loss = -(
                    label * math.log(pred + eps)
                    + (1 - label) * math.log(1 - pred + eps)
                )
                epoch_loss += loss

                # Gradient step
                error = pred - label
                for i in range(len(self.weights)):
                    self.weights[i] -= self.learning_rate * error * features[i]
                self.bias -= self.learning_rate * error

            losses.append(epoch_loss / len(dataset))
        return losses

    def get_feature_importance(self) -> list[tuple[int, float]]:
        """Get feature importance ranked by absolute weight.

        Returns:
            List of (feature_index, weight) pairs sorted by importance.
        """
        indexed = [(i, abs(w)) for i, w in enumerate(self.weights)]
        return sorted(indexed, key=lambda x: x[1], reverse=True)
