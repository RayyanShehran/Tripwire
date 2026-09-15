from __future__ import annotations

import argparse
import hashlib
import json
import random
import subprocess
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from math import isfinite
from pathlib import Path
from statistics import quantiles
from typing import Any, Literal

import networkx as nx
import pandas as pd

from app.simulation.cascade import (
    CASCADE_TRIP_THRESHOLD_PERCENT,
    DEFAULT_MAX_CASCADE_STEPS,
    CascadeResponse,
    simulate_cascade,
)
from app.simulation.grid import (
    GridComponentType,
    GridConvergenceError,
    create_test_grid,
    run_power_flow,
    serialize_grid_state,
)

DEFAULT_LOAD_MULTIPLIERS = (1.0, 1.15, 1.25, 1.35, 1.5)
DEFAULT_GENERATION_MULTIPLIERS = (0.8, 0.9, 1.0, 1.1)
DEFAULT_LINE_RATING_MULTIPLIERS = (0.6, 0.5, 0.45, 0.4, 0.38, 0.35, 0.32)
DEFAULT_DISPATCH_PROFILES = ("balanced", "south_heavy", "harbor_heavy", "south_reduced")
DEFAULT_RANDOM_SEED = 42
DATASET_SCHEMA_VERSION = "2.0"
GRID_VERSION = "tripwire-8bus-230kv-v1"
SLACK_CAPACITY_MW = 500.0
GENERATOR_CAPACITY_MW = {
    "gen-south": 180.0,
    "gen-harbor": 120.0,
}
DISPATCH_FACTORS = {
    "balanced": {"gen-south": 1.0, "gen-harbor": 1.0},
    "south_heavy": {"gen-south": 1.15, "gen-harbor": 0.85},
    "harbor_heavy": {"gen-south": 0.85, "gen-harbor": 1.15},
    "south_reduced": {"gen-south": 0.75, "gen-harbor": 1.05},
}

SeverityLabel = Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]

SEVERITY_THRESHOLDS = {
    "LOW": (0.0, 5.0),
    "MODERATE": (5.0, 20.0),
    "HIGH": (20.0, 50.0),
    "CRITICAL": (50.0, float("inf")),
}

FEATURE_COLUMNS = [
    "component_type",
    "component_id",
    "load_multiplier",
    "generation_multiplier",
    "line_rating_multiplier",
    "dispatch_profile",
    "random_seed",
    "total_demand_mw",
    "available_generation_capacity_mw",
    "reserve_margin_mw",
    "reserve_margin_percent",
    "total_generation_mw",
    "gen_south_dispatch_mw",
    "gen_harbor_dispatch_mw",
    "max_line_loading_percent",
    "mean_line_loading_percent",
    "p95_line_loading_percent",
    "number_of_stressed_lines",
    "number_of_overloaded_lines",
    "number_of_buses",
    "number_of_lines",
    "number_of_generators",
    "number_of_loads",
    "pre_failure_loading_percent",
    "capacity_mw",
    "source_bus_voltage",
    "target_bus_voltage",
    "source_degree",
    "target_degree",
    "component_betweenness_centrality",
    "endpoint_degree_sum",
    "endpoint_shortest_path_length",
    "source_bus_load_mw",
    "target_bus_load_mw",
    "source_bus_generation_mw",
    "target_bus_generation_mw",
]

TARGET_COLUMNS = [
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
]

IDENTIFIER_COLUMNS = ["scenario_id"]
DATASET_COLUMNS = [*IDENTIFIER_COLUMNS, *FEATURE_COLUMNS, *TARGET_COLUMNS]
NON_NEGATIVE_NUMERIC_COLUMNS = [
    column
    for column in DATASET_COLUMNS
    if column not in {"reserve_margin_mw", "reserve_margin_percent"}
]


@dataclass(frozen=True)
class ScenarioCandidate:
    component_type: GridComponentType
    component_id: str


@dataclass(frozen=True)
class ScenarioConfig:
    load_multiplier: float
    generation_multiplier: float
    line_rating_multiplier: float
    dispatch_profile: str
    initial_failure: ScenarioCandidate
    seed: int


@dataclass(frozen=True)
class DatasetGenerationResult:
    dataframe: pd.DataFrame
    metadata: dict[str, Any]
    failed_simulations: list[dict[str, Any]]


def generate_dataset(
    seed: int = DEFAULT_RANDOM_SEED,
    load_multipliers: tuple[float, ...] = DEFAULT_LOAD_MULTIPLIERS,
    generation_multipliers: tuple[float, ...] = DEFAULT_GENERATION_MULTIPLIERS,
    line_rating_multipliers: tuple[float, ...] = DEFAULT_LINE_RATING_MULTIPLIERS,
    dispatch_profiles: tuple[str, ...] = DEFAULT_DISPATCH_PROFILES,
    component_types: tuple[GridComponentType, ...] = ("line", "bus"),
    max_scenarios: int | None = None,
    max_cascade_steps: int = DEFAULT_MAX_CASCADE_STEPS,
) -> DatasetGenerationResult:
    scenario_configs = _scenario_configs(
        seed=seed,
        load_multipliers=load_multipliers,
        generation_multipliers=generation_multipliers,
        line_rating_multipliers=line_rating_multipliers,
        dispatch_profiles=dispatch_profiles,
        component_types=component_types,
        max_scenarios=max_scenarios,
    )
    rows: list[dict[str, Any]] = []
    failed_simulations: list[dict[str, Any]] = []

    for config in scenario_configs:
        scenario_id = _scenario_id(config)

        try:
            row = _build_scenario_row(
                scenario_id=scenario_id,
                config=config,
                max_cascade_steps=max_cascade_steps,
            )
        except (GridConvergenceError, ValueError) as exc:
            failed_simulations.append(
                {
                    "scenario_id": scenario_id,
                    **_metadata_config(config),
                    "reason": str(exc),
                }
            )
            continue

        rows.append(row)

    dataframe = pd.DataFrame(rows, columns=DATASET_COLUMNS)
    validate_dataset(dataframe)

    metadata = build_metadata(
        dataframe=dataframe,
        seed=seed,
        load_multipliers=load_multipliers,
        generation_multipliers=generation_multipliers,
        line_rating_multipliers=line_rating_multipliers,
        dispatch_profiles=dispatch_profiles,
        component_types=component_types,
        max_scenarios=max_scenarios,
        failed_simulations=failed_simulations,
    )

    return DatasetGenerationResult(
        dataframe=dataframe,
        metadata=metadata,
        failed_simulations=failed_simulations,
    )


def write_dataset(
    result: DatasetGenerationResult,
    output_path: Path,
    metadata_path: Path | None = None,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result.dataframe.to_csv(output_path, index=False)

    if metadata_path is None:
        metadata_path = output_path.with_name("dataset_metadata.json")

    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(
        json.dumps(result.metadata, allow_nan=False, indent=2),
        encoding="utf-8",
    )


def summarize_dataset(result: DatasetGenerationResult) -> str:
    return summarize_dataframe(result.dataframe, failed_count=len(result.failed_simulations))


def summarize_dataframe(dataframe: pd.DataFrame, failed_count: int = 0) -> str:
    severity_counts = Counter(dataframe["severity_label"]) if not dataframe.empty else Counter()
    depth_counts = Counter(dataframe["cascade_depth"]) if not dataframe.empty else Counter()
    termination_counts = Counter(dataframe["termination_reason"]) if not dataframe.empty else Counter()
    cascade_count = int(dataframe["cascade_happened"].sum()) if not dataframe.empty else 0
    no_cascade_count = len(dataframe) - cascade_count
    positive_rate = 0.0 if dataframe.empty else cascade_count / len(dataframe)

    lines = [
        f"Scenarios generated: {len(dataframe)}",
        f"Cascades: {cascade_count}",
        f"No cascades: {no_cascade_count}",
        f"Positive cascade rate: {positive_rate:.2%}",
        "",
        "Severity:",
    ]
    for label in SEVERITY_THRESHOLDS:
        lines.append(f"{label}: {severity_counts.get(label, 0)}")

    lines.extend(["", "Cascade depth:"])
    for depth, count in sorted(depth_counts.items()):
        lines.append(f"{depth}: {count}")

    lines.extend(["", "Termination reasons:"])
    for reason, count in sorted(termination_counts.items()):
        lines.append(f"{reason}: {count}")

    if dataframe.empty:
        average_load_lost = maximum_load_lost = 0.0
    else:
        average_load_lost = float(dataframe["load_lost_percent"].mean())
        maximum_load_lost = float(dataframe["load_lost_percent"].max())

    lines.extend(
        [
            "",
            f"Average load lost: {average_load_lost:.2f}%",
            f"Maximum load lost: {maximum_load_lost:.2f}%",
            f"Failed simulations: {failed_count}",
        ]
    )

    return "\n".join(lines)


def analyze_dataset(dataframe: pd.DataFrame) -> dict[str, Any]:
    validate_dataset(dataframe)
    cascade_count = int(dataframe["cascade_happened"].sum()) if not dataframe.empty else 0
    duplicate_count = int(dataframe["scenario_id"].duplicated().sum()) if "scenario_id" in dataframe else 0
    numeric_columns = dataframe.select_dtypes(include=["number"]).columns.tolist()
    categorical_columns = dataframe.select_dtypes(exclude=["number"]).columns.tolist()

    numeric_feature_columns = [
        column for column in FEATURE_COLUMNS if column in numeric_columns
    ]
    feature_ranges = {
        column: {
            "min": _round(dataframe[column].min()),
            "max": _round(dataframe[column].max()),
        }
        for column in numeric_feature_columns
        if not dataframe.empty
    }
    constant_columns = [
        column for column in dataframe.columns if dataframe[column].nunique(dropna=False) <= 1
    ]
    imbalanced_categorical_values = {}
    for column in categorical_columns:
        if dataframe.empty:
            continue
        normalized = dataframe[column].value_counts(normalize=True)
        if not normalized.empty and float(normalized.iloc[0]) >= 0.95:
            imbalanced_categorical_values[column] = {
                "dominant_value": str(normalized.index[0]),
                "dominant_share": _round(float(normalized.iloc[0])),
            }

    return {
        "dataset_size": len(dataframe),
        "cascade_positive_count": cascade_count,
        "cascade_negative_count": len(dataframe) - cascade_count,
        "positive_rate": 0.0 if dataframe.empty else cascade_count / len(dataframe),
        "severity_distribution": dict(Counter(dataframe["severity_label"])) if not dataframe.empty else {},
        "cascade_depth_distribution": {
            int(depth): int(count)
            for depth, count in Counter(dataframe["cascade_depth"]).items()
        }
        if not dataframe.empty
        else {},
        "termination_reason_distribution": dict(Counter(dataframe["termination_reason"]))
        if not dataframe.empty
        else {},
        "feature_ranges": feature_ranges,
        "constant_columns": constant_columns,
        "imbalanced_categorical_values": imbalanced_categorical_values,
        "missing_value_count": int(dataframe.isna().sum().sum()),
        "nonfinite_value_count": _nonfinite_value_count(dataframe),
        "duplicate_scenario_id_count": duplicate_count,
    }


def summarize_diagnostics(diagnostics: dict[str, Any]) -> str:
    lines = [
        f"Dataset size: {diagnostics['dataset_size']}",
        f"Positive cascade count: {diagnostics['cascade_positive_count']}",
        f"Negative cascade count: {diagnostics['cascade_negative_count']}",
        f"Positive cascade rate: {diagnostics['positive_rate']:.2%}",
        f"Missing values: {diagnostics['missing_value_count']}",
        f"Non-finite values: {diagnostics['nonfinite_value_count']}",
        f"Duplicate scenario IDs: {diagnostics['duplicate_scenario_id_count']}",
        "",
        "Severity distribution:",
    ]
    lines.extend(_counter_lines(diagnostics["severity_distribution"]))
    lines.extend(["", "Cascade depth distribution:"])
    lines.extend(_counter_lines(diagnostics["cascade_depth_distribution"]))
    lines.extend(["", "Termination reason distribution:"])
    lines.extend(_counter_lines(diagnostics["termination_reason_distribution"]))
    lines.extend(["", "Potential constant columns:"])
    lines.extend(str(column) for column in diagnostics["constant_columns"] or ["none"])
    lines.extend(["", "Highly imbalanced categorical values:"])
    if diagnostics["imbalanced_categorical_values"]:
        for column, detail in diagnostics["imbalanced_categorical_values"].items():
            lines.append(
                f"{column}: {detail['dominant_value']} ({detail['dominant_share']:.2%})"
            )
    else:
        lines.append("none")
    lines.extend(["", "Feature ranges:"])
    for column, range_values in diagnostics["feature_ranges"].items():
        lines.append(f"{column}: {range_values['min']} to {range_values['max']}")
    return "\n".join(lines)


def validate_dataset(dataframe: pd.DataFrame) -> None:
    missing_columns = [column for column in DATASET_COLUMNS if column not in dataframe.columns]
    if missing_columns:
        raise ValueError(f"Dataset is missing columns: {missing_columns}")

    if dataframe["scenario_id"].duplicated().any():
        raise ValueError("Dataset contains duplicate scenario IDs")

    if dataframe.isna().any().any():
        raise ValueError("Dataset contains missing values")

    numeric_columns = dataframe.select_dtypes(include=["number"]).columns
    for column in numeric_columns:
        if not dataframe[column].map(lambda value: isfinite(float(value))).all():
            raise ValueError(f"Dataset contains non-finite values in {column}")

    for column in numeric_columns:
        if column in NON_NEGATIVE_NUMERIC_COLUMNS and (dataframe[column] < 0).any():
            raise ValueError(f"Dataset contains impossible negative values in {column}")

    if not dataframe["load_lost_percent"].between(0.0, 100.0).all():
        raise ValueError("load_lost_percent must be between 0 and 100")

    if (dataframe["cascade_depth"] < 0).any():
        raise ValueError("cascade_depth must be greater than or equal to 0")

    mismatch = dataframe["cascade_happened"].astype(bool) != (dataframe["cascade_depth"] > 0)
    if mismatch.any():
        raise ValueError("cascade_happened does not match secondary-failure behavior")

    balance_error = (
        dataframe["served_load_mw"] + dataframe["unserved_load_mw"] - dataframe["total_demand_mw"]
    ).abs()
    if (balance_error > 0.05).any():
        raise ValueError("served and unserved load do not balance to demand")

    valid_labels = set(SEVERITY_THRESHOLDS)
    invalid_labels = set(dataframe["severity_label"]) - valid_labels
    if invalid_labels:
        raise ValueError(f"Dataset contains invalid severity labels: {sorted(invalid_labels)}")

    leakage_columns = set(FEATURE_COLUMNS).intersection(TARGET_COLUMNS)
    if leakage_columns:
        raise ValueError(f"Feature columns leak target columns: {sorted(leakage_columns)}")


def build_metadata(
    dataframe: pd.DataFrame,
    seed: int,
    load_multipliers: tuple[float, ...],
    generation_multipliers: tuple[float, ...],
    line_rating_multipliers: tuple[float, ...],
    dispatch_profiles: tuple[str, ...],
    component_types: tuple[GridComponentType, ...],
    max_scenarios: int | None,
    failed_simulations: list[dict[str, Any]],
) -> dict[str, Any]:
    cascade_count = int(dataframe["cascade_happened"].sum()) if not dataframe.empty else 0
    return {
        "dataset_schema_version": DATASET_SCHEMA_VERSION,
        "generation_timestamp": datetime.now(UTC).isoformat(),
        "git_commit": _git_commit(),
        "number_of_scenarios": len(dataframe),
        "positive_cascade_count": cascade_count,
        "negative_cascade_count": len(dataframe) - cascade_count,
        "positive_rate": 0.0 if dataframe.empty else cascade_count / len(dataframe),
        "grid_version": GRID_VERSION,
        "feature_columns": FEATURE_COLUMNS,
        "target_columns": TARGET_COLUMNS,
        "cascade_threshold_percent": CASCADE_TRIP_THRESHOLD_PERCENT,
        "load_multipliers": list(load_multipliers),
        "generation_multipliers": list(generation_multipliers),
        "line_rating_multipliers": list(line_rating_multipliers),
        "dispatch_profiles": list(dispatch_profiles),
        "component_types": list(component_types),
        "random_seed": seed,
        "max_scenarios": max_scenarios,
        "severity_thresholds": _metadata_severity_thresholds(),
        "failed_simulation_count": len(failed_simulations),
        "excluded_failed_scenario_count": len(failed_simulations),
        "failed_simulations": failed_simulations,
        "reserve_margin_definition": (
            "available_generation_capacity_mw - total_demand_mw, where available "
            "generation capacity uses pre-failure slack and generator capacity after "
            "the scenario's generation availability and dispatch profile are applied"
        ),
        "reserve_margin_percent_definition": "reserve_margin_mw / total_demand_mw * 100",
        "cascade_happened_definition": (
            "true when at least one secondary failure occurs after the initial failure"
        ),
    }


def default_output_path() -> Path:
    return Path(__file__).resolve().parents[2] / "data" / "generated" / "tripwire_scenarios.csv"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Tripwire scenario dataset CSV.")
    parser.add_argument("--output", type=Path, default=default_output_path())
    parser.add_argument("--seed", type=int, default=DEFAULT_RANDOM_SEED)
    parser.add_argument(
        "--load-multipliers",
        default=",".join(str(value) for value in DEFAULT_LOAD_MULTIPLIERS),
        help="Comma-separated load multipliers, for example 1.0,1.15,1.25",
    )
    parser.add_argument(
        "--generation-multipliers",
        default=",".join(str(value) for value in DEFAULT_GENERATION_MULTIPLIERS),
        help="Comma-separated generation availability multipliers, for example 0.8,0.9,1.0",
    )
    parser.add_argument(
        "--line-rating-multipliers",
        default=",".join(str(value) for value in DEFAULT_LINE_RATING_MULTIPLIERS),
        help="Comma-separated thermal-rating multipliers, for example 0.6,0.5,0.4",
    )
    parser.add_argument(
        "--dispatch-profiles",
        default=",".join(DEFAULT_DISPATCH_PROFILES),
        help="Comma-separated dispatch profiles.",
    )
    parser.add_argument(
        "--component-types",
        default="line,bus",
        help="Comma-separated component types to include: line,bus",
    )
    parser.add_argument("--max-scenarios", type=int, default=None)
    return parser.parse_args(argv)


def run_cli(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    load_multipliers = _parse_float_tuple(args.load_multipliers)
    generation_multipliers = _parse_float_tuple(args.generation_multipliers)
    line_rating_multipliers = _parse_float_tuple(args.line_rating_multipliers)
    dispatch_profiles = tuple(
        value.strip() for value in args.dispatch_profiles.split(",") if value.strip()
    )
    component_types = tuple(
        value.strip() for value in args.component_types.split(",") if value.strip()
    )
    _validate_component_types(component_types)
    _validate_dispatch_profiles(dispatch_profiles)

    result = generate_dataset(
        seed=args.seed,
        load_multipliers=load_multipliers,
        generation_multipliers=generation_multipliers,
        line_rating_multipliers=line_rating_multipliers,
        dispatch_profiles=dispatch_profiles,
        component_types=component_types,
        max_scenarios=args.max_scenarios,
    )
    write_dataset(result, args.output)
    print(summarize_dataset(result))
    print(f"\nDataset written to: {args.output}")
    print(f"Metadata written to: {args.output.with_name('dataset_metadata.json')}")
    return 0


def create_operating_grid(config: ScenarioConfig) -> Any:
    net = create_test_grid()
    _apply_load_multiplier(net, config.load_multiplier)
    _apply_generation_profile(net, config.generation_multiplier, config.dispatch_profile)
    _apply_line_rating_multiplier(net, config.line_rating_multiplier)
    return net


def available_generation_capacity_mw(config: ScenarioConfig) -> float:
    factors = DISPATCH_FACTORS[config.dispatch_profile]
    total = SLACK_CAPACITY_MW * config.generation_multiplier
    for generator_id, base_capacity in GENERATOR_CAPACITY_MW.items():
        total += base_capacity * config.generation_multiplier * factors[generator_id]
    return _round(total)


def build_feature_row(config: ScenarioConfig, scenario_id: str = "prediction") -> dict[str, Any]:
    pre_failure_net = create_operating_grid(config)
    run_power_flow(pre_failure_net)
    pre_failure_grid = serialize_grid_state(pre_failure_net)
    return _feature_row(
        scenario_id=scenario_id,
        config=config,
        pre_failure_grid=pre_failure_grid,
        pre_failure_net=pre_failure_net,
        graph_features=_topology_features(pre_failure_net),
    )


def _build_scenario_row(
    scenario_id: str,
    config: ScenarioConfig,
    max_cascade_steps: int,
) -> dict[str, Any]:
    pre_failure_net = create_operating_grid(config)
    run_power_flow(pre_failure_net)
    pre_failure_grid = serialize_grid_state(pre_failure_net)
    graph_features = _topology_features(pre_failure_net)
    feature_row = _feature_row(
        scenario_id=scenario_id,
        config=config,
        pre_failure_grid=pre_failure_grid,
        pre_failure_net=pre_failure_net,
        graph_features=graph_features,
    )

    cascade_result = simulate_cascade(
        config.initial_failure.component_type,
        config.initial_failure.component_id,
        max_steps=max_cascade_steps,
        net_factory=lambda: create_operating_grid(config),
    )
    target_row = _target_row(cascade_result)

    return {**feature_row, **target_row}


def _feature_row(
    scenario_id: str,
    config: ScenarioConfig,
    pre_failure_grid: dict[str, Any],
    pre_failure_net: Any,
    graph_features: dict[str, Any],
) -> dict[str, Any]:
    line_loadings = [
        line["loading_percent"]
        for line in pre_failure_grid["lines"]
        if line["loading_percent"] is not None
    ]
    mean_line_loading = sum(line_loadings) / len(line_loadings) if line_loadings else 0.0
    p95_line_loading = _percentile_95(line_loadings)
    stressed_lines = sum(1 for line in pre_failure_grid["lines"] if line["status"] == "stressed")
    overloaded_lines = sum(1 for line in pre_failure_grid["lines"] if line["status"] == "overloaded")
    initial_component_features = _initial_component_features(
        config.initial_failure,
        pre_failure_grid,
        graph_features,
    )
    metrics = pre_failure_grid["metrics"]
    available_capacity = available_generation_capacity_mw(config)
    reserve_margin = _round(available_capacity - metrics["total_demand_mw"])
    reserve_margin_percent = (
        0.0
        if metrics["total_demand_mw"] == 0
        else _round((reserve_margin / metrics["total_demand_mw"]) * 100)
    )
    generator_dispatch = _generator_dispatch(pre_failure_grid)

    return {
        "scenario_id": scenario_id,
        "component_type": config.initial_failure.component_type,
        "component_id": config.initial_failure.component_id,
        "load_multiplier": _round(config.load_multiplier),
        "generation_multiplier": _round(config.generation_multiplier),
        "line_rating_multiplier": _round(config.line_rating_multiplier),
        "dispatch_profile": config.dispatch_profile,
        "random_seed": config.seed,
        "total_demand_mw": metrics["total_demand_mw"],
        "available_generation_capacity_mw": available_capacity,
        "reserve_margin_mw": reserve_margin,
        "reserve_margin_percent": reserve_margin_percent,
        "total_generation_mw": metrics["total_generation_mw"],
        "gen_south_dispatch_mw": generator_dispatch["gen-south"],
        "gen_harbor_dispatch_mw": generator_dispatch["gen-harbor"],
        "max_line_loading_percent": metrics["max_line_loading_percent"],
        "mean_line_loading_percent": _round(mean_line_loading),
        "p95_line_loading_percent": _round(p95_line_loading),
        "number_of_stressed_lines": stressed_lines,
        "number_of_overloaded_lines": overloaded_lines,
        "number_of_buses": len(pre_failure_net.bus),
        "number_of_lines": len(pre_failure_net.line),
        "number_of_generators": len(pre_failure_net.ext_grid) + len(pre_failure_net.gen),
        "number_of_loads": len(pre_failure_net.load),
        **initial_component_features,
    }


def _target_row(cascade_result: CascadeResponse) -> dict[str, Any]:
    final_metrics = cascade_result["final_metrics"]
    cascade_happened = any(
        step["step"] > 0 and step["newly_failed_components"]
        for step in cascade_result["steps"]
    )
    load_lost_percent = final_metrics["load_lost_percent"]

    return {
        "cascade_happened": cascade_happened,
        "cascade_depth": final_metrics["cascade_depth"],
        "total_failed_lines": final_metrics["failed_lines"],
        "total_failed_components": final_metrics["failed_components"],
        "overloaded_events": final_metrics["overload_events"],
        "served_load_mw": final_metrics["served_load_mw"],
        "unserved_load_mw": final_metrics["unserved_load_mw"],
        "load_lost_percent": load_lost_percent,
        "peak_line_loading_percent": final_metrics["peak_line_loading_percent"],
        "termination_reason": cascade_result["termination_reason"],
        "severity_label": severity_label(load_lost_percent),
    }


def severity_label(load_lost_percent: float) -> SeverityLabel:
    if load_lost_percent < 5.0:
        return "LOW"
    if load_lost_percent < 20.0:
        return "MODERATE"
    if load_lost_percent < 50.0:
        return "HIGH"
    return "CRITICAL"


def _initial_component_features(
    candidate: ScenarioCandidate,
    pre_failure_grid: dict[str, Any],
    graph_features: dict[str, Any],
) -> dict[str, float]:
    if candidate.component_type == "line":
        line = next(line for line in pre_failure_grid["lines"] if line["id"] == candidate.component_id)
        source_voltage = _bus_voltage(pre_failure_grid, line["source"])
        target_voltage = _bus_voltage(pre_failure_grid, line["target"])
        topology = graph_features["lines"].get(candidate.component_id, {})

        return {
            "pre_failure_loading_percent": line["loading_percent"] or 0.0,
            "capacity_mw": line["capacity_mw"] or 0.0,
            "source_bus_voltage": source_voltage,
            "target_bus_voltage": target_voltage,
            "source_degree": topology.get("source_degree", 0),
            "target_degree": topology.get("target_degree", 0),
            "component_betweenness_centrality": topology.get("edge_betweenness", 0.0),
            "endpoint_degree_sum": topology.get("endpoint_degree_sum", 0),
            "endpoint_shortest_path_length": topology.get("endpoint_shortest_path_length", 0),
            "source_bus_load_mw": _bus_load(pre_failure_grid, line["source"]),
            "target_bus_load_mw": _bus_load(pre_failure_grid, line["target"]),
            "source_bus_generation_mw": _bus_generation(pre_failure_grid, line["source"]),
            "target_bus_generation_mw": _bus_generation(pre_failure_grid, line["target"]),
        }

    bus = next(node for node in pre_failure_grid["nodes"] if node["id"] == candidate.component_id)
    topology = graph_features["buses"].get(candidate.component_id, {})
    voltage = bus["voltage"] or 0.0

    return {
        "pre_failure_loading_percent": 0.0,
        "capacity_mw": 0.0,
        "source_bus_voltage": voltage,
        "target_bus_voltage": voltage,
        "source_degree": topology.get("degree", 0),
        "target_degree": topology.get("degree", 0),
        "component_betweenness_centrality": topology.get("betweenness", 0.0),
        "endpoint_degree_sum": topology.get("degree", 0),
        "endpoint_shortest_path_length": 0,
        "source_bus_load_mw": _bus_load(pre_failure_grid, candidate.component_id),
        "target_bus_load_mw": _bus_load(pre_failure_grid, candidate.component_id),
        "source_bus_generation_mw": _bus_generation(pre_failure_grid, candidate.component_id),
        "target_bus_generation_mw": _bus_generation(pre_failure_grid, candidate.component_id),
    }


def _topology_features(net: Any) -> dict[str, dict[str, dict[str, float]]]:
    graph = nx.Graph()
    for _, bus in net.bus.iterrows():
        graph.add_node(str(bus["tripwire_id"]))

    line_id_by_edge: dict[tuple[str, str], str] = {}
    for _, line in net.line.iterrows():
        source = str(net.bus.at[int(line["from_bus"]), "tripwire_id"])
        target = str(net.bus.at[int(line["to_bus"]), "tripwire_id"])
        graph.add_edge(source, target)
        line_id_by_edge[tuple(sorted((source, target)))] = str(line["tripwire_id"])

    bus_betweenness = nx.betweenness_centrality(graph, normalized=True)
    edge_betweenness = nx.edge_betweenness_centrality(graph, normalized=True)
    bus_features = {
        node: {
            "degree": graph.degree[node],
            "betweenness": _round(bus_betweenness[node]),
        }
        for node in graph.nodes
    }

    line_features: dict[str, dict[str, float]] = {}
    for edge, centrality in edge_betweenness.items():
        source, target = edge
        line_id = line_id_by_edge[tuple(sorted((source, target)))]
        graph_without_edge = graph.copy()
        graph_without_edge.remove_edge(source, target)
        if nx.has_path(graph_without_edge, source, target):
            path_length = nx.shortest_path_length(graph_without_edge, source, target)
        else:
            path_length = 0
        line_features[line_id] = {
            "source_degree": graph.degree[source],
            "target_degree": graph.degree[target],
            "edge_betweenness": _round(centrality),
            "endpoint_degree_sum": graph.degree[source] + graph.degree[target],
            "endpoint_shortest_path_length": path_length,
        }

    return {"buses": bus_features, "lines": line_features}


def _scenario_configs(
    seed: int,
    load_multipliers: tuple[float, ...],
    generation_multipliers: tuple[float, ...],
    line_rating_multipliers: tuple[float, ...],
    dispatch_profiles: tuple[str, ...],
    component_types: tuple[GridComponentType, ...],
    max_scenarios: int | None,
) -> list[ScenarioConfig]:
    candidates = _failure_candidates(component_types)
    specs = [
        ScenarioConfig(
            load_multiplier=load_multiplier,
            generation_multiplier=generation_multiplier,
            line_rating_multiplier=line_rating_multiplier,
            dispatch_profile=dispatch_profile,
            initial_failure=candidate,
            seed=seed,
        )
        for load_multiplier in sorted(load_multipliers)
        for generation_multiplier in sorted(generation_multipliers)
        for line_rating_multiplier in sorted(line_rating_multipliers, reverse=True)
        for dispatch_profile in dispatch_profiles
        for candidate in candidates
    ]

    rng = random.Random(seed)
    rng.shuffle(specs)

    if max_scenarios is not None:
        return specs[:max_scenarios]
    return specs


def _failure_candidates(component_types: tuple[GridComponentType, ...]) -> list[ScenarioCandidate]:
    net = create_test_grid()
    candidates: list[ScenarioCandidate] = []

    if "line" in component_types:
        for _, line in net.line.sort_values("tripwire_id").iterrows():
            candidates.append(ScenarioCandidate("line", str(line["tripwire_id"])))

    if "bus" in component_types:
        for _, bus in net.bus.sort_values("tripwire_id").iterrows():
            candidates.append(ScenarioCandidate("bus", str(bus["tripwire_id"])))

    return candidates


def _apply_load_multiplier(net: Any, load_multiplier: float) -> None:
    net.load.loc[:, "p_mw"] = net.load["p_mw"] * load_multiplier
    net.load.loc[:, "q_mvar"] = net.load["q_mvar"] * load_multiplier


def _apply_generation_profile(net: Any, generation_multiplier: float, dispatch_profile: str) -> None:
    factors = DISPATCH_FACTORS[dispatch_profile]
    net.ext_grid.loc[:, "max_p_mw"] = SLACK_CAPACITY_MW * generation_multiplier

    for generator_index, generator in net.gen.iterrows():
        generator_id = str(generator["tripwire_id"])
        factor = generation_multiplier * factors[generator_id]
        net.gen.loc[generator_index, "p_mw"] = float(generator["p_mw"]) * factor
        net.gen.loc[generator_index, "max_p_mw"] = GENERATOR_CAPACITY_MW[generator_id] * factor


def _apply_line_rating_multiplier(net: Any, line_rating_multiplier: float) -> None:
    net.line.loc[:, "max_i_ka"] = net.line["max_i_ka"] * line_rating_multiplier


def _bus_voltage(pre_failure_grid: dict[str, Any], bus_id: str) -> float:
    bus = next(node for node in pre_failure_grid["nodes"] if node["id"] == bus_id)
    return bus["voltage"] or 0.0


def _bus_load(pre_failure_grid: dict[str, Any], bus_id: str) -> float:
    return _round(
        sum(
            node["load_mw"] or 0.0
            for node in pre_failure_grid["nodes"]
            if node["type"] == "load" and node["connected_bus_id"] == bus_id
        )
    )


def _bus_generation(pre_failure_grid: dict[str, Any], bus_id: str) -> float:
    return _round(
        sum(
            node["generation_mw"] or 0.0
            for node in pre_failure_grid["nodes"]
            if node["type"] == "generator" and node["connected_bus_id"] == bus_id
        )
    )


def _generator_dispatch(pre_failure_grid: dict[str, Any]) -> dict[str, float]:
    values = {"gen-south": 0.0, "gen-harbor": 0.0}
    for node in pre_failure_grid["nodes"]:
        if node["id"] in values:
            values[node["id"]] = _round(node["generation_mw"] or 0.0)
    return values


def _scenario_id(config: ScenarioConfig) -> str:
    digest_source = json.dumps(_metadata_config(config), sort_keys=True)
    digest = hashlib.sha1(digest_source.encode("utf-8")).hexdigest()[:12]
    failure = config.initial_failure
    return f"tw-{config.seed}-{failure.component_type}-{failure.component_id}-{digest}"


def _metadata_config(config: ScenarioConfig) -> dict[str, Any]:
    return {
        "component_type": config.initial_failure.component_type,
        "component_id": config.initial_failure.component_id,
        "load_multiplier": _round(config.load_multiplier),
        "generation_multiplier": _round(config.generation_multiplier),
        "line_rating_multiplier": _round(config.line_rating_multiplier),
        "dispatch_profile": config.dispatch_profile,
        "seed": config.seed,
    }


def _validate_component_types(component_types: tuple[str, ...]) -> None:
    valid_types = {"line", "bus"}
    invalid_types = sorted(set(component_types) - valid_types)
    if invalid_types:
        raise ValueError(f"Unsupported component types: {invalid_types}")


def _validate_dispatch_profiles(dispatch_profiles: tuple[str, ...]) -> None:
    invalid_profiles = sorted(set(dispatch_profiles) - set(DISPATCH_FACTORS))
    if invalid_profiles:
        raise ValueError(f"Unsupported dispatch profiles: {invalid_profiles}")


def _parse_float_tuple(raw_value: str) -> tuple[float, ...]:
    return tuple(float(value) for value in raw_value.split(",") if value.strip())


def _percentile_95(values: list[float]) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    return quantiles(sorted(values), n=100, method="inclusive")[94]


def _nonfinite_value_count(dataframe: pd.DataFrame) -> int:
    count = 0
    for column in dataframe.select_dtypes(include=["number"]).columns:
        count += int((~dataframe[column].map(lambda value: isfinite(float(value)))).sum())
    return count


def _counter_lines(values: dict[Any, int]) -> list[str]:
    if not values:
        return ["none"]
    return [f"{key}: {value}" for key, value in sorted(values.items())]


def _round(value: float) -> float:
    return round(float(value), 4)


def _metadata_severity_thresholds() -> dict[str, dict[str, float | None]]:
    return {
        label: {
            "min_load_lost_percent": lower,
            "max_load_lost_percent": upper if isfinite(upper) else None,
        }
        for label, (lower, upper) in SEVERITY_THRESHOLDS.items()
    }


def _git_commit() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=Path(__file__).resolve().parents[3],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.SubprocessError):
        return None
