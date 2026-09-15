from __future__ import annotations

import math
import json
from io import StringIO

import pandas as pd
import pytest

from app.ml.dataset import (
    DATASET_COLUMNS,
    FEATURE_COLUMNS,
    SEVERITY_THRESHOLDS,
    TARGET_COLUMNS,
    ScenarioCandidate,
    ScenarioConfig,
    analyze_dataset,
    available_generation_capacity_mw,
    generate_dataset,
    severity_label,
    validate_dataset,
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


def test_representative_dataset_contains_positive_and_negative_cascades() -> None:
    result = generate_dataset(
        seed=9,
        load_multipliers=(1.0, 1.5),
        generation_multipliers=(1.0,),
        line_rating_multipliers=(1.0, 0.32),
        dispatch_profiles=("balanced",),
        component_types=("line", "bus"),
    )

    assert result.dataframe["cascade_happened"].any()
    assert (~result.dataframe["cascade_happened"]).any()


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
    assert "available_generation_capacity_mw" in FEATURE_COLUMNS
    assert "reserve_margin_percent" in FEATURE_COLUMNS
    assert "load_lost_percent" not in FEATURE_COLUMNS


def test_cascade_happened_matches_secondary_failure_definition() -> None:
    result = generate_dataset(
        seed=11,
        load_multipliers=(1.0,),
        component_types=("line",),
        max_scenarios=5,
    )

    for _, row in result.dataframe.iterrows():
        assert bool(row["cascade_happened"]) is (row["cascade_depth"] > 0)


def test_positive_cascade_rows_contain_secondary_failures() -> None:
    result = generate_dataset(
        seed=9,
        load_multipliers=(1.5,),
        generation_multipliers=(1.0,),
        line_rating_multipliers=(0.32,),
        dispatch_profiles=("balanced",),
        component_types=("line", "bus"),
    )

    positives = result.dataframe[result.dataframe["cascade_happened"]]

    assert not positives.empty
    assert (positives["cascade_depth"] > 0).all()


def test_severity_label_thresholds_are_deterministic() -> None:
    assert set(SEVERITY_THRESHOLDS) == {"LOW", "MODERATE", "HIGH", "CRITICAL"}
    assert severity_label(0.0) == "LOW"
    assert severity_label(4.99) == "LOW"
    assert severity_label(5.0) == "MODERATE"
    assert severity_label(19.99) == "MODERATE"
    assert severity_label(20.0) == "HIGH"
    assert severity_label(49.99) == "HIGH"
    assert severity_label(50.0) == "CRITICAL"


def test_output_csv_can_be_loaded() -> None:
    result = generate_dataset(
        seed=13,
        load_multipliers=(1.0,),
        component_types=("bus",),
        max_scenarios=3,
    )
    loaded = pd.read_csv(StringIO(result.dataframe.to_csv(index=False)))

    assert len(loaded) == len(result.dataframe)
    assert list(loaded.columns) == DATASET_COLUMNS


def test_metadata_json_can_be_loaded_without_nonstandard_numbers() -> None:
    result = generate_dataset(
        seed=19,
        load_multipliers=(1.0,),
        component_types=("line",),
        max_scenarios=2,
    )
    loaded = json.loads(json.dumps(result.metadata, allow_nan=False))

    assert loaded["severity_thresholds"]["CRITICAL"]["max_load_lost_percent"] is None
    assert loaded["dataset_schema_version"] == "2.0"
    assert loaded["generation_multipliers"] == [0.8, 0.9, 1.0, 1.1]
    assert loaded["line_rating_multipliers"] == [0.6, 0.5, 0.45, 0.4, 0.38, 0.35, 0.32]
    assert "reserve_margin_definition" in loaded


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


def test_scenario_ids_change_with_operating_configuration() -> None:
    result = generate_dataset(
        seed=31,
        load_multipliers=(1.0,),
        generation_multipliers=(1.0,),
        line_rating_multipliers=(1.0, 0.32),
        dispatch_profiles=("balanced",),
        component_types=("line",),
    )

    assert result.dataframe["scenario_id"].is_unique
    assert result.dataframe[["component_id", "line_rating_multiplier"]].drop_duplicates().shape[0] == len(
        result.dataframe
    )


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


def test_reserve_margin_uses_available_capacity_not_solved_generation() -> None:
    result = generate_dataset(
        seed=37,
        load_multipliers=(1.25,),
        generation_multipliers=(0.9,),
        line_rating_multipliers=(0.6,),
        dispatch_profiles=("south_heavy",),
        component_types=("line",),
        max_scenarios=1,
    )
    row = result.dataframe.iloc[0]
    config = ScenarioConfig(
        load_multiplier=1.25,
        generation_multiplier=0.9,
        line_rating_multiplier=0.6,
        dispatch_profile="south_heavy",
        initial_failure=ScenarioCandidate("line", str(row["component_id"])),
        seed=37,
    )
    expected_capacity = available_generation_capacity_mw(config)
    expected_margin = round(expected_capacity - float(row["total_demand_mw"]), 4)
    expected_percent = round((expected_margin / float(row["total_demand_mw"])) * 100, 4)

    assert row["available_generation_capacity_mw"] == expected_capacity
    assert row["reserve_margin_mw"] == expected_margin
    assert row["reserve_margin_percent"] == expected_percent
    assert row["reserve_margin_mw"] != round(
        float(row["total_generation_mw"]) - float(row["total_demand_mw"]), 4
    )


def test_validate_dataset_rejects_label_mismatch() -> None:
    result = generate_dataset(
        seed=41,
        load_multipliers=(1.0,),
        generation_multipliers=(1.0,),
        line_rating_multipliers=(1.0,),
        dispatch_profiles=("balanced",),
        component_types=("line",),
        max_scenarios=2,
    )
    invalid = result.dataframe.copy()
    invalid.loc[0, "cascade_happened"] = not bool(invalid.loc[0, "cascade_happened"])

    with pytest.raises(ValueError, match="cascade_happened"):
        validate_dataset(invalid)


def test_analyze_dataset_reports_quality_checks() -> None:
    result = generate_dataset(
        seed=43,
        load_multipliers=(1.0, 1.5),
        generation_multipliers=(1.0,),
        line_rating_multipliers=(1.0, 0.32),
        dispatch_profiles=("balanced",),
        component_types=("line", "bus"),
        max_scenarios=20,
    )

    diagnostics = analyze_dataset(result.dataframe)

    assert diagnostics["dataset_size"] == len(result.dataframe)
    assert diagnostics["missing_value_count"] == 0
    assert diagnostics["nonfinite_value_count"] == 0
    assert diagnostics["duplicate_scenario_id_count"] == 0
    assert "load_lost_percent" not in diagnostics["feature_ranges"]
