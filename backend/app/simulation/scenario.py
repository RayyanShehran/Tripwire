from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypedDict

from app.simulation.grid import (
    GridComponentType,
    GridConvergenceError,
    GridResponse,
    apply_component_outage,
    create_test_grid,
    find_supplied_buses,
    run_power_flow,
    serialize_grid_state,
)

ScenarioStatus = Literal["solved", "blackout"]
FailureTerminationReason = Literal["solved", "no_slack_source", "total_blackout"]


class ScenarioMetrics(TypedDict):
    total_demand_mw: float
    served_load_mw: float
    unserved_load_mw: float
    load_lost_percent: float
    total_generation_mw: float
    failed_components: int
    failed_lines: int
    max_line_loading_percent: float


class FailureScenarioResponse(TypedDict):
    status: ScenarioStatus
    termination_reason: FailureTerminationReason
    initial_failure: dict[str, str]
    grid: GridResponse
    metrics: ScenarioMetrics


@dataclass(frozen=True)
class ComponentFailure:
    component_type: GridComponentType
    component_id: str


def create_baseline_network():
    return create_test_grid()


def get_baseline_grid() -> GridResponse:
    net = create_baseline_network()
    run_power_flow(net)
    return serialize_grid_state(net)


def simulate_failure(failure: ComponentFailure) -> FailureScenarioResponse:
    net = create_baseline_network()
    apply_component_outage(net, failure.component_type, failure.component_id)

    termination_reason: FailureTerminationReason = "solved"
    try:
        run_power_flow(net)
    except GridConvergenceError as exc:
        if _is_expected_blackout_state(net):
            termination_reason = "no_slack_source"
        else:
            raise exc

    grid = serialize_grid_state(net)
    if _is_total_blackout(grid):
        termination_reason = "total_blackout" if termination_reason == "solved" else termination_reason

    return {
        "status": "blackout" if _is_total_blackout(grid) else "solved",
        "termination_reason": termination_reason,
        "initial_failure": {
            "component_type": failure.component_type,
            "component_id": failure.component_id,
        },
        "grid": grid,
        "metrics": scenario_metrics(grid),
    }


def scenario_metrics(grid: GridResponse) -> ScenarioMetrics:
    total_demand = grid["metrics"]["total_demand_mw"]
    unserved_load = grid["metrics"]["unserved_load_mw"]
    failed_lines = sum(1 for line in grid["lines"] if line["status"] == "failed")
    failed_nodes = sum(1 for node in grid["nodes"] if node["status"] == "failed")
    load_lost_percent = 0.0 if total_demand == 0 else round((unserved_load / total_demand) * 100, 2)

    return {
        "total_demand_mw": total_demand,
        "served_load_mw": grid["metrics"]["served_load_mw"],
        "unserved_load_mw": unserved_load,
        "load_lost_percent": load_lost_percent,
        "total_generation_mw": grid["metrics"]["total_generation_mw"],
        "failed_components": failed_lines + failed_nodes,
        "failed_lines": failed_lines,
        "max_line_loading_percent": grid["metrics"]["max_line_loading_percent"],
    }


def _is_expected_blackout_state(net) -> bool:
    return net.ext_grid.empty or not bool(net.ext_grid.in_service.any()) or not find_supplied_buses(net)


def _is_total_blackout(grid: GridResponse) -> bool:
    metrics = grid["metrics"]
    return metrics["total_demand_mw"] > 0 and metrics["served_load_mw"] == 0
