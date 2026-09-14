from __future__ import annotations

import math
import json

import pandas as pd
import pytest

from app.ml.dataset import (
    DATASET_COLUMNS,
    FEATURE_COLUMNS,
    SEVERITY_THRESHOLDS,
    TARGET_COLUMNS,
    generate_dataset,
    severity_label,
    validate_dataset,
    write_dataset,
)


def test_dataset_generation_is_deterministic() -> None:
    first = generate_dataset(
        seed=7,
        load_multipliers=(1.0,),
        component_types=("line",),
        max_scenarios=4,
    )
    second = generate_dataset(
        seed=7,
        load_multipliers=(1.0,),
        component_types=("line",),
        max_scenarios=4,
    )

    pd.testing.assert_frame_equal(first.dataframe, second.dataframe)


def test_dataset_has_unique_scenario_ids() -> None:
    result = generate_dataset(
        seed=3,
        load_multipliers=(0.9, 1.0),
        component_types=("line",),
        max_scenarios=8,
    )

    assert result.dataframe["scenario_id"].is_unique


def test_dataset_has_no_nan_or_infinity_values() -> None:
    result = generate_dataset(
        seed=5,
        load_multipliers=(1.0,),
        component_types=("line", "bus"),
        max_scenarios=6,
    )

    assert not result.dataframe.isna().any().any()
    numeric_columns = result.dataframe.select_dtypes(include=["number"]).columns
    for column in numeric_columns:
        assert result.dataframe[column].map(lambda value: math.isfinite(float(value))).all()


def test_dataset_required_columns_exist() -> None:
    result = generate_dataset(
        seed=2,
        load_multipliers=(1.0,),
        component_types=("line",),
        max_scenarios=2,
    )

    assert list(result.dataframe.columns) == DATASET_COLUMNS


def test_feature_and_target_columns_are_separated() -> None:
    leakage_columns = {
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

    assert not leakage_columns.intersection(FEATURE_COLUMNS)
    assert leakage_columns.issubset(TARGET_COLUMNS)


def test_cascade_happened_matches_secondary_failure_definition() -> None:
    result = generate_dataset(
        seed=11,
        load_multipliers=(1.0,),
        component_types=("line",),
        max_scenarios=5,
    )

    for _, row in result.dataframe.iterrows():
        assert bool(row["cascade_happened"]) is (row["cascade_depth"] > 0)


def test_severity_label_thresholds_are_deterministic() -> None:
    assert set(SEVERITY_THRESHOLDS) == {"LOW", "MODERATE", "HIGH", "CRITICAL"}
    assert severity_label(0.0) == "LOW"
    assert severity_label(4.99) == "LOW"
    assert severity_label(5.0) == "MODERATE"
    assert severity_label(19.99) == "MODERATE"
    assert severity_label(20.0) == "HIGH"
    assert severity_label(49.99) == "HIGH"
    assert severity_label(50.0) == "CRITICAL"


def test_output_csv_can_be_loaded(tmp_path) -> None:
    result = generate_dataset(
        seed=13,
        load_multipliers=(1.0,),
        component_types=("bus",),
        max_scenarios=3,
    )
    output = tmp_path / "tripwire_scenarios.csv"

    write_dataset(result, output)
    loaded = pd.read_csv(output)

    assert len(loaded) == len(result.dataframe)
    assert list(loaded.columns) == DATASET_COLUMNS


def test_metadata_json_can_be_loaded_without_nonstandard_numbers(tmp_path) -> None:
    result = generate_dataset(
        seed=19,
        load_multipliers=(1.0,),
        component_types=("line",),
        max_scenarios=2,
    )
    output = tmp_path / "tripwire_scenarios.csv"
    metadata = tmp_path / "dataset_metadata.json"

    write_dataset(result, output, metadata)
    loaded = json.loads(metadata.read_text(encoding="utf-8"))

    assert loaded["severity_thresholds"]["CRITICAL"]["max_load_lost_percent"] is None


def test_max_scenarios_limits_rows() -> None:
    result = generate_dataset(
        seed=17,
        load_multipliers=(0.8, 0.9, 1.0),
        component_types=("line", "bus"),
        max_scenarios=5,
    )

    assert len(result.dataframe) == 5


def test_same_seed_produces_same_scenario_order() -> None:
    first = generate_dataset(
        seed=23,
        load_multipliers=(0.8, 1.0),
        component_types=("line", "bus"),
        max_scenarios=8,
    )
    second = generate_dataset(
        seed=23,
        load_multipliers=(0.8, 1.0),
        component_types=("line", "bus"),
        max_scenarios=8,
    )

    assert first.dataframe["scenario_id"].tolist() == second.dataframe["scenario_id"].tolist()
    assert first.dataframe["component_id"].tolist() == second.dataframe["component_id"].tolist()


def test_validate_dataset_rejects_duplicate_scenario_ids() -> None:
    result = generate_dataset(
        seed=29,
        load_multipliers=(1.0,),
        component_types=("line",),
        max_scenarios=2,
    )
    invalid = result.dataframe.copy()
    invalid.loc[1, "scenario_id"] = invalid.loc[0, "scenario_id"]

    with pytest.raises(ValueError, match="duplicate scenario IDs"):
        validate_dataset(invalid)
