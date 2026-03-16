"""Tests for zeroid.risk.model."""

import math

import pytest

from zeroid.risk.model import LogisticRegressionModel, _sigmoid


class TestSigmoid:
    def test_zero(self) -> None:
        assert _sigmoid(0.0) == 0.5

    def test_large_positive(self) -> None:
        assert _sigmoid(100.0) > 0.99

    def test_large_negative(self) -> None:
        assert _sigmoid(-100.0) < 0.01

    def test_overflow_protection(self) -> None:
        # Should not raise even with extreme values
        assert _sigmoid(1000.0) > 0.0
        assert _sigmoid(-1000.0) < 1.0


class TestLogisticRegressionModel:
    def test_initialize(self) -> None:
        model = LogisticRegressionModel()
        model.initialize(4)
        assert len(model.weights) == 4
        assert all(w == 0.0 for w in model.weights)
        assert model.bias == 0.0

    def test_predict_zero_weights(self) -> None:
        model = LogisticRegressionModel()
        model.initialize(3)
        pred = model.predict([1.0, 2.0, 3.0])
        assert pred == 0.5  # sigmoid(0)

    def test_predict_with_weights(self) -> None:
        model = LogisticRegressionModel(weights=[1.0, -1.0], bias=0.0)
        pred = model.predict([1.0, 0.0])
        assert pred > 0.5  # positive weighted input

    def test_predict_wrong_features_raises(self) -> None:
        model = LogisticRegressionModel(weights=[1.0, 2.0], bias=0.0)
        with pytest.raises(ValueError, match="Expected 2"):
            model.predict([1.0])

    def test_train_step(self) -> None:
        model = LogisticRegressionModel(weights=[0.0, 0.0], bias=0.0, learning_rate=0.1)
        pred = model.train_step([1.0, 0.5], 1.0)
        assert pred == 0.5  # before update
        # After update, weights should have moved
        assert model.weights[0] != 0.0

    def test_train_step_wrong_features_raises(self) -> None:
        model = LogisticRegressionModel(weights=[0.0], bias=0.0)
        with pytest.raises(ValueError, match="Expected 1"):
            model.train_step([1.0, 2.0], 0.0)

    def test_train(self) -> None:
        model = LogisticRegressionModel(learning_rate=0.5)
        dataset = [
            ([0.0, 0.0], 0.0),
            ([1.0, 1.0], 1.0),
            ([0.5, 0.5], 1.0),
            ([0.1, 0.1], 0.0),
        ]
        losses = model.train(dataset, epochs=50)
        assert len(losses) == 50
        # Loss should generally decrease
        assert losses[-1] < losses[0]

    def test_train_empty_dataset(self) -> None:
        model = LogisticRegressionModel()
        losses = model.train([], epochs=10)
        assert losses == []

    def test_train_auto_initialize(self) -> None:
        model = LogisticRegressionModel(learning_rate=0.1)
        dataset = [([1.0, 0.0], 1.0)]
        losses = model.train(dataset, epochs=5)
        assert len(losses) == 5
        assert len(model.weights) == 2

    def test_train_with_preinitialized_weights(self) -> None:
        """When weights are already set, train should skip auto-initialize."""
        model = LogisticRegressionModel(weights=[0.0, 0.0], bias=0.0, learning_rate=0.1)
        dataset = [([1.0, 0.0], 1.0), ([0.0, 1.0], 0.0)]
        losses = model.train(dataset, epochs=3)
        assert len(losses) == 3

    def test_get_feature_importance(self) -> None:
        model = LogisticRegressionModel(weights=[0.1, -0.5, 0.3], bias=0.0)
        importance = model.get_feature_importance()
        assert len(importance) == 3
        # Most important first (by absolute value)
        assert importance[0] == (1, 0.5)
        assert importance[1] == (2, 0.3)
        assert importance[2] == (0, 0.1)

    def test_get_feature_importance_empty(self) -> None:
        model = LogisticRegressionModel()
        assert model.get_feature_importance() == []
