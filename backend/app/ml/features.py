from __future__ import annotations

from typing import Any

import pandas as pd

from app.ml.dataset import FEATURE_COLUMNS, build_feature_row
from app.simulation.config import ScenarioCandidate, ScenarioConfig
from app.simulation.grid import GridComponentNotFoundError, GridComponentType

CATEGORICAL_FEATURES = [
    "component_type",
    "component_id",
    "dispatch_profile",
]
NUMERIC_FEATURES = [column for column in FEATURE_COLUMNS if column not in CATEGORICAL_FEATURES]
MODEL_FEATURE_COLUMNS = [*CATEGORICAL_FEATURES, *NUMERIC_FEATURES]

TARGET_LEAKAGE_COLUMNS = {
    "cascade_happened",
    "cascade_depth",
    "total_failed_lines",
    "total_failed_components",
    "overloaded_events",
    "served_load_mw",
    "unserved_load_mw",
    "load_lost_percent",
    "peak_line_loading_percent",
    "termination_reason",
    "severity_label",
}


def assert_no_feature_leakage() -> None:
    leaked = TARGET_LEAKAGE_COLUMNS.intersection(MODEL_FEATURE_COLUMNS)
    if leaked:
        raise ValueError(f"Model feature list contains target leakage columns: {sorted(leaked)}")


def feature_frame(dataframe: pd.DataFrame) -> pd.DataFrame:
    assert_no_feature_leakage()
    missing = [column for column in MODEL_FEATURE_COLUMNS if column not in dataframe.columns]
    if missing:
        raise ValueError(f"Dataset is missing model feature columns: {missing}")
    return dataframe.loc[:, MODEL_FEATURE_COLUMNS].copy()


def feature_frame_from_config(
    component_type: GridComponentType,
    component_id: str,
    load_multiplier: float = 1.0,
    generation_multiplier: float = 1.0,
    line_rating_multiplier: float = 1.0,
    dispatch_profile: str = "balanced",
    seed: int = 42,
) -> pd.DataFrame:
    config = ScenarioConfig(
        load_multiplier=load_multiplier,
        generation_multiplier=generation_multiplier,
        line_rating_multiplier=line_rating_multiplier,
        dispatch_profile=dispatch_profile,
        initial_failure=ScenarioCandidate(component_type, component_id),
        seed=seed,
    )
    try:
        row = build_feature_row(config)
    except StopIteration as exc:
        raise GridComponentNotFoundError(f"Unknown {component_type}: {component_id}") from exc
    return pd.DataFrame([{column: row[column] for column in MODEL_FEATURE_COLUMNS}])


def validate_feature_payload(features: dict[str, Any]) -> pd.DataFrame:
    missing = [column for column in MODEL_FEATURE_COLUMNS if column not in features]
    if missing:
        raise ValueError(f"Missing required features: {missing}")
    return pd.DataFrame([{column: features[column] for column in MODEL_FEATURE_COLUMNS}])
