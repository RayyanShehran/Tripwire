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
from app.simulation.config import (
    ScenarioConfig,
    build_scenario_network,
    scenario_config as make_scenario_config,
    scenario_config_payload,
    scenario_fingerprint,
)

ScenarioStatus = Literal["solved", "blackout"]
FailureTerminationReason = Literal["solved", "no_slack_source", "total_blackout"]


class ScenarioMetrics(TypedDict):
    original_demand_mw: float
    total_demand_mw: float
    served_load_mw: float
    controlled_shed_mw: float
    involuntary_unserved_mw: float
    total_unserved_mw: float
    unserved_load_mw: float
    load_lost_percent: float
    total_generation_mw: float
    failed_components: int
    failed_lines: int
    max_line_loading_percent: float


class FailureScenarioResponse(TypedDict):
    scenario_id: str
    scenario_config: dict[str, object]
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


def simulate_failure(
    failure: ComponentFailure,
    config: ScenarioConfig | None = None,
) -> FailureScenarioResponse:
    resolved_config = config or make_scenario_config(
        failure.component_type,
        failure.component_id,
    )
    if resolved_config.initial_failure.component_type != failure.component_type or (
        resolved_config.initial_failure.component_id != failure.component_id
    ):
        raise ValueError("Scenario initial failure does not match requested failure")

    net = build_scenario_network(resolved_config)
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
        "scenario_id": scenario_fingerprint(resolved_config),
        "scenario_config": scenario_config_payload(resolved_config),
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
    return {
        "original_demand_mw": grid["metrics"]["original_demand_mw"],
        "total_demand_mw": grid["metrics"]["total_demand_mw"],
        "served_load_mw": grid["metrics"]["served_load_mw"],
        "controlled_shed_mw": grid["metrics"]["controlled_shed_mw"],
        "involuntary_unserved_mw": grid["metrics"]["involuntary_unserved_mw"],
        "total_unserved_mw": grid["metrics"]["total_unserved_mw"],
        "unserved_load_mw": grid["metrics"]["unserved_load_mw"],
        "load_lost_percent": grid["metrics"]["load_lost_percent"],
        "total_generation_mw": grid["metrics"]["total_generation_mw"],
        "failed_components": grid["metrics"]["failed_components"],
        "failed_lines": grid["metrics"]["failed_lines"],
        "max_line_loading_percent": grid["metrics"]["max_line_loading_percent"],
    }


def _is_expected_blackout_state(net) -> bool:
    return net.ext_grid.empty or not bool(net.ext_grid.in_service.any()) or not find_supplied_buses(net)


def _is_total_blackout(grid: GridResponse) -> bool:
    metrics = grid["metrics"]
    return metrics["total_demand_mw"] > 0 and metrics["served_load_mw"] == 0
