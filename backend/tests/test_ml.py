from __future__ import annotations

import math

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.ml.dataset import generate_dataset
from app.ml.features import MODEL_FEATURE_COLUMNS, TARGET_LEAKAGE_COLUMNS, feature_frame
from app.ml.inference import load_model_bundle, predict_from_frame, predict_from_scenario
from app.ml.train import (
    split_dataset,
    train_models,
)


@pytest.fixture(scope="module")
def ml_dataset() -> pd.DataFrame:
    result = generate_dataset(
        seed=51,
        load_multipliers=(1.0, 1.5),
        generation_multipliers=(1.0,),
        line_rating_multipliers=(1.0, 0.32),
        dispatch_profiles=("balanced",),
        component_types=("line", "bus"),
    )
    return result.dataframe


def test_model_feature_list_excludes_targets() -> None:
    assert not TARGET_LEAKAGE_COLUMNS.intersection(MODEL_FEATURE_COLUMNS)


def test_preprocessing_feature_frame_uses_only_authoritative_features(ml_dataset) -> None:
    frame = feature_frame(ml_dataset)

    assert list(frame.columns) == MODEL_FEATURE_COLUMNS
    assert "load_lost_percent" not in frame.columns
    assert "cascade_depth" not in frame.columns


def test_split_strategy_is_deterministic(ml_dataset) -> None:
    first = split_dataset(ml_dataset, random_seed=42)
    second = split_dataset(ml_dataset, random_seed=42)

    assert first.strategy == second.strategy
    assert first.x_validation.index.tolist() == second.x_validation.index.tolist()
    assert first.x_test.index.tolist() == second.x_test.index.tolist()
    assert set(first.x_train.index).isdisjoint(first.x_validation.index)
    assert set(first.x_train.index).isdisjoint(first.x_test.index)
    assert set(first.x_validation.index).isdisjoint(first.x_test.index)


def test_classifier_and_regressor_training_complete(ml_dataset) -> None:
    result = train_models(
        dataframe=ml_dataset,
        save_artifacts=False,
    )

    assert result.metadata["classifier_model"]
    assert result.metadata["regressor_model"]
    assert result.metadata["classifier_metrics"]["f1"] >= 0.0
    assert result.metadata["regressor_metrics"]["mae"] >= 0.0
    assert result.metadata["classifier_metrics"] == result.metadata["classifier_test_metrics"]
    assert result.metadata["regressor_metrics"] == result.metadata["regressor_test_metrics"]
    assert set(result.metadata["all_regressor_validation_metrics"]) == {
        "ridge_regression",
        "random_forest_regressor",
        "hist_gradient_boosting_regressor",
        "gradient_boosting_regressor",
    }
    assert set(result.metadata["regressor_test_metrics"]["severity_buckets"]) == {
        "zero",
        "moderate",
        "severe",
    }
    distribution = result.metadata["load_loss_target_distribution"]
    assert set(distribution) == {"zero", "moderate", "severe", "total_blackout"}
    assert sum(bucket["count"] for bucket in distribution.values()) == len(ml_dataset)


def test_saved_artifacts_load_and_predict(ml_dataset) -> None:
    load_model_bundle.cache_clear()
    bundle = load_model_bundle()
    prediction = predict_from_frame(feature_frame(ml_dataset).head(1))

    assert bundle["metadata"]["model_version"] == "tripwire-ml-v1"
    assert 0.0 <= prediction["cascade_probability"] <= 1.0
    assert 0.0 <= prediction["predicted_load_lost_percent"] <= 100.0
    assert math.isfinite(prediction["cascade_probability"])
    assert math.isfinite(prediction["predicted_load_lost_percent"])


def test_inference_from_scenario_uses_pre_failure_features_only() -> None:
    prediction = predict_from_scenario(
        component_type="line",
        component_id="line-101",
        load_multiplier=1.5,
        generation_multiplier=1.0,
        line_rating_multiplier=0.32,
        dispatch_profile="balanced",
    )

    assert 0.0 <= prediction["cascade_probability"] <= 1.0
    assert 0.0 <= prediction["predicted_load_lost_percent"] <= 100.0


def test_predict_api_valid_request() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/predict",
        json={
            "component_type": "line",
            "component_id": "line-101",
            "operating_condition": {
                "load_multiplier": 1.5,
                "generation_multiplier": 1.0,
                "line_rating_multiplier": 0.32,
                "dispatch_profile": "balanced",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert 0.0 <= payload["cascade_probability"] <= 1.0
    assert 0.0 <= payload["predicted_load_lost_percent"] <= 100.0
    assert payload["risk_level"] in {"LOW", "MODERATE", "HIGH", "CRITICAL"}
    assert payload["model_version"]


def test_predict_api_rejects_invalid_component() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/predict",
        json={
            "component_type": "line",
            "component_id": "bad-line",
        },
    )

    assert response.status_code == 404
