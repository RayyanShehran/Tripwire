from __future__ import annotations

from typing import Any, Literal, TypedDict

RANDOM_SEED = 42
MODEL_VERSION = "tripwire-ml-v1"

CLASSIFICATION_TARGET = "cascade_happened"
REGRESSION_TARGET = "load_lost_percent"

RiskLevel = Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]

RISK_THRESHOLDS = {
    "LOW": (0.0, 0.25),
    "MODERATE": (0.25, 0.5),
    "HIGH": (0.5, 0.75),
    "CRITICAL": (0.75, 1.0),
}


class PredictionResult(TypedDict):
    cascade_probability: float
    predicted_load_lost_percent: float
    risk_level: RiskLevel
    model_version: str


class ModelBundle(TypedDict):
    classifier: Any
    regressor: Any
    metadata: dict[str, Any]


def risk_level(cascade_probability: float) -> RiskLevel:
    probability = max(0.0, min(float(cascade_probability), 1.0))
    if probability < 0.25:
        return "LOW"
    if probability < 0.5:
        return "MODERATE"
    if probability < 0.75:
        return "HIGH"
    return "CRITICAL"
