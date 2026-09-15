from __future__ import annotations

from functools import lru_cache
import json
from math import isfinite
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from app.ml.features import feature_frame_from_config, validate_feature_payload
from app.ml.schemas import MODEL_VERSION, ModelBundle, PredictionResult, risk_level
from app.ml.train import CLASSIFIER_ARTIFACT, METADATA_ARTIFACT, MODEL_DIR, REGRESSOR_ARTIFACT
from app.simulation.grid import GridComponentType


class ModelNotTrainedError(RuntimeError):
    pass


class PredictionInputError(ValueError):
    pass


@lru_cache(maxsize=1)
def load_model_bundle(model_dir: str | Path = MODEL_DIR) -> ModelBundle:
    model_dir = Path(model_dir)
    classifier_path = model_dir / CLASSIFIER_ARTIFACT
    regressor_path = model_dir / REGRESSOR_ARTIFACT
    metadata_path = model_dir / METADATA_ARTIFACT

    missing = [
        str(path)
        for path in (classifier_path, regressor_path, metadata_path)
        if not path.exists()
    ]
    if missing:
        raise ModelNotTrainedError(
            "Model artifacts are missing. Run backend/scripts/train_models.py first. "
            f"Missing: {missing}"
        )

    return {
        "classifier": joblib.load(classifier_path),
        "regressor": joblib.load(regressor_path),
        "metadata": json.loads(metadata_path.read_text(encoding="utf-8")),
    }


def predict_from_features(features: dict[str, Any]) -> PredictionResult:
    frame = validate_feature_payload(features)
    return predict_from_frame(frame)


def predict_from_scenario(
    component_type: GridComponentType,
    component_id: str,
    load_multiplier: float = 1.0,
    generation_multiplier: float = 1.0,
    line_rating_multiplier: float = 1.0,
    dispatch_profile: str = "balanced",
) -> PredictionResult:
    frame = feature_frame_from_config(
        component_type=component_type,
        component_id=component_id,
        load_multiplier=load_multiplier,
        generation_multiplier=generation_multiplier,
        line_rating_multiplier=line_rating_multiplier,
        dispatch_profile=dispatch_profile,
    )
    return predict_from_frame(frame)


def predict_from_frame(frame: pd.DataFrame) -> PredictionResult:
    bundle = load_model_bundle()
    classifier = bundle["classifier"]
    regressor = bundle["regressor"]
    metadata = bundle["metadata"]

    probability = float(classifier.predict_proba(frame)[0][1])
    load_loss = float(regressor.predict(frame)[0])
    if not isfinite(probability) or not isfinite(load_loss):
        raise PredictionInputError("Model returned a non-finite prediction")

    probability = max(0.0, min(probability, 1.0))
    load_loss = max(0.0, min(load_loss, 100.0))
    model_version = str(metadata.get("model_version") or MODEL_VERSION)

    return {
        "cascade_probability": round(probability, 4),
        "predicted_load_lost_percent": round(load_loss, 2),
        "risk_level": risk_level(probability),
        "model_version": model_version,
    }
