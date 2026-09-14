from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from math import isfinite
from pathlib import Path
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
    apply_component_outage,
    create_test_grid,
    run_power_flow,
    serialize_grid_state,
)

DEFAULT_LOAD_MULTIPLIERS = (0.8, 0.9, 1.0, 1.1, 1.2)
DEFAULT_RANDOM_SEED = 42
GRID_VERSION = "tripwire-8bus-230kv-v1"

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
    "random_seed",
    "total_demand_mw",
    "total_generation_mw",
    "reserve_margin_mw",
    "max_line_loading_percent",
    "mean_line_loading_percent",
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


@dataclass(frozen=True)
class ScenarioCandidate:
    component_type: GridComponentType
    component_id: str


@dataclass(frozen=True)
class DatasetGenerationResult:
    dataframe: pd.DataFrame
    metadata: dict[str, Any]
    failed_simulations: list[dict[str, Any]]


def generate_dataset(
    seed: int = DEFAULT_RANDOM_SEED,
    load_multipliers: tuple[float, ...] = DEFAULT_LOAD_MULTIPLIERS,
    component_types: tuple[GridComponentType, ...] = ("line", "bus"),
    max_scenarios: int | None = None,
    max_cascade_steps: int = DEFAULT_MAX_CASCADE_STEPS,
) -> DatasetGenerationResult:
    scenario_specs = _scenario_specs(seed, load_multipliers, component_types, max_scenarios)
    rows: list[dict[str, Any]] = []
    failed_simulations: list[dict[str, Any]] = []

    for index, (candidate, load_multiplier) in enumerate(scenario_specs):
        scenario_id = _scenario_id(index, seed, candidate, load_multiplier)

        try:
            row = _build_scenario_row(
                scenario_id=scenario_id,
                seed=seed,
                candidate=candidate,
                load_multiplier=load_multiplier,
                max_cascade_steps=max_cascade_steps,
            )
        except (GridConvergenceError, ValueError) as exc:
            failed_simulations.append(
                {
                    "scenario_id": scenario_id,
                    "component_type": candidate.component_type,
                    "component_id": candidate.component_id,
                    "load_multiplier": load_multiplier,
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
    dataframe = result.dataframe
    severity_counts = Counter(dataframe["severity_label"]) if not dataframe.empty else Counter()
    cascade_count = int(dataframe["cascade_happened"].sum()) if not dataframe.empty else 0
    no_cascade_count = len(dataframe) - cascade_count
    average_load_lost = float(dataframe["load_lost_percent"].mean()) if not dataframe.empty else 0.0
    maximum_load_lost = float(dataframe["load_lost_percent"].max()) if not dataframe.empty else 0.0
    average_depth = float(dataframe["cascade_depth"].mean()) if not dataframe.empty else 0.0

    lines = [
        f"Scenarios generated: {len(dataframe)}",
        f"Cascades: {cascade_count}",
        f"No cascades: {no_cascade_count}",
        "",
        "Severity:",
    ]
    for label in SEVERITY_THRESHOLDS:
        lines.append(f"{label}: {severity_counts.get(label, 0)}")

    lines.extend(
        [
            "",
            f"Average load lost: {average_load_lost:.2f}%",
            f"Maximum load lost: {maximum_load_lost:.2f}%",
            f"Average cascade depth: {average_depth:.2f}",
            f"Failed simulations: {len(result.failed_simulations)}",
        ]
    )

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

    valid_labels = set(SEVERITY_THRESHOLDS)
    invalid_labels = set(dataframe["severity_label"]) - valid_labels
    if invalid_labels:
        raise ValueError(f"Dataset contains invalid severity labels: {sorted(invalid_labels)}")


def build_metadata(
    dataframe: pd.DataFrame,
    seed: int,
    load_multipliers: tuple[float, ...],
    component_types: tuple[GridComponentType, ...],
    max_scenarios: int | None,
    failed_simulations: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "generation_timestamp": datetime.now(UTC).isoformat(),
        "number_of_scenarios": len(dataframe),
        "grid_version": GRID_VERSION,
        "feature_columns": FEATURE_COLUMNS,
        "target_columns": TARGET_COLUMNS,
        "cascade_threshold_percent": CASCADE_TRIP_THRESHOLD_PERCENT,
        "load_multipliers": list(load_multipliers),
        "component_types": list(component_types),
        "random_seed": seed,
        "max_scenarios": max_scenarios,
        "severity_thresholds": _metadata_severity_thresholds(),
        "failed_simulation_count": len(failed_simulations),
        "failed_simulations": failed_simulations,
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
        help="Comma-separated load multipliers, for example 0.8,0.9,1.0",
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
    load_multipliers = tuple(float(value) for value in args.load_multipliers.split(",") if value)
    component_types = tuple(
        value.strip() for value in args.component_types.split(",") if value.strip()
    )
    _validate_component_types(component_types)

    result = generate_dataset(
        seed=args.seed,
        load_multipliers=load_multipliers,
        component_types=component_types,
        max_scenarios=args.max_scenarios,
    )
    write_dataset(result, args.output)
    print(summarize_dataset(result))
    print(f"\nDataset written to: {args.output}")
    print(f"Metadata written to: {args.output.with_name('dataset_metadata.json')}")
    return 0


def _build_scenario_row(
    scenario_id: str,
    seed: int,
    candidate: ScenarioCandidate,
    load_multiplier: float,
    max_cascade_steps: int,
) -> dict[str, Any]:
    pre_failure_net = _create_operating_grid(load_multiplier)
    run_power_flow(pre_failure_net)
    pre_failure_grid = serialize_grid_state(pre_failure_net)
    graph_features = _topology_features(pre_failure_net)
    feature_row = _feature_row(
        scenario_id=scenario_id,
        seed=seed,
        candidate=candidate,
        load_multiplier=load_multiplier,
        pre_failure_grid=pre_failure_grid,
        pre_failure_net=pre_failure_net,
        graph_features=graph_features,
    )

    cascade_result = simulate_cascade(
        candidate.component_type,
        candidate.component_id,
        max_steps=max_cascade_steps,
        net_factory=lambda: _create_operating_grid(load_multiplier),
    )
    target_row = _target_row(cascade_result)

    return {**feature_row, **target_row}


def _feature_row(
    scenario_id: str,
    seed: int,
    candidate: ScenarioCandidate,
    load_multiplier: float,
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
    stressed_lines = sum(1 for line in pre_failure_grid["lines"] if line["status"] == "stressed")
    overloaded_lines = sum(1 for line in pre_failure_grid["lines"] if line["status"] == "overloaded")
    initial_component_features = _initial_component_features(
        candidate,
        pre_failure_grid,
        graph_features,
    )
    metrics = pre_failure_grid["metrics"]

    return {
        "scenario_id": scenario_id,
        "component_type": candidate.component_type,
        "component_id": candidate.component_id,
        "load_multiplier": _round(load_multiplier),
        "random_seed": seed,
        "total_demand_mw": metrics["total_demand_mw"],
        "total_generation_mw": metrics["total_generation_mw"],
        "reserve_margin_mw": _round(metrics["total_generation_mw"] - metrics["total_demand_mw"]),
        "max_line_loading_percent": metrics["max_line_loading_percent"],
        "mean_line_loading_percent": _round(mean_line_loading),
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
    }


def _topology_features(net: Any) -> dict[str, dict[str, dict[str, float]]]:
    graph = nx.Graph()
    for bus_index, bus in net.bus.iterrows():
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


def _scenario_specs(
    seed: int,
    load_multipliers: tuple[float, ...],
    component_types: tuple[GridComponentType, ...],
    max_scenarios: int | None,
) -> list[tuple[ScenarioCandidate, float]]:
    candidates = _failure_candidates(component_types)
    specs = [
        (candidate, load_multiplier)
        for load_multiplier in sorted(load_multipliers)
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


def _create_operating_grid(load_multiplier: float) -> Any:
    net = create_test_grid()
    net.load.loc[:, "p_mw"] = net.load["p_mw"] * load_multiplier
    net.load.loc[:, "q_mvar"] = net.load["q_mvar"] * load_multiplier
    net.gen.loc[:, "p_mw"] = net.gen["p_mw"] * load_multiplier
    return net


def _bus_voltage(pre_failure_grid: dict[str, Any], bus_id: str) -> float:
    bus = next(node for node in pre_failure_grid["nodes"] if node["id"] == bus_id)
    return bus["voltage"] or 0.0


def _scenario_id(
    index: int,
    seed: int,
    candidate: ScenarioCandidate,
    load_multiplier: float,
) -> str:
    multiplier = str(load_multiplier).replace(".", "p")
    return f"tw-{seed}-{index:05d}-{candidate.component_type}-{candidate.component_id}-{multiplier}"


def _validate_component_types(component_types: tuple[str, ...]) -> None:
    valid_types = {"line", "bus"}
    invalid_types = sorted(set(component_types) - valid_types)
    if invalid_types:
        raise ValueError(f"Unsupported component types: {invalid_types}")


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
