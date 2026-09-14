from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal, TypedDict

from app.simulation.grid import (
    GridComponentType,
    GridConvergenceError,
    GridResponse,
    apply_component_outage,
    create_test_grid,
    run_power_flow,
    serialize_grid_state,
)

CASCADE_TRIP_THRESHOLD_PERCENT = 100.0
DEFAULT_MAX_CASCADE_STEPS = 20

TerminationReason = Literal[
    "stable",
    "max_steps_reached",
    "power_flow_failed",
    "total_blackout",
    "no_additional_failures",
]
CascadeEvent = Literal["initial_failure", "cascade_step", "power_flow_failed"]


class FailedComponent(TypedDict):
    component_type: GridComponentType
    component_id: str


class OverloadedLine(TypedDict):
    component_id: str
    loading_percent: float


class CascadeStepMetrics(TypedDict):
    total_demand_mw: float
    served_load_mw: float
    unserved_load_mw: float
    load_lost_percent: float
    total_generation_mw: float
    max_line_loading_percent: float
    failed_components: int
    failed_lines: int
    overloaded_lines: int


class CascadeStep(TypedDict):
    step: int
    event: CascadeEvent
    newly_failed_components: list[FailedComponent]
    overloaded_lines: list[OverloadedLine]
    grid: GridResponse
    metrics: CascadeStepMetrics


class CascadeFinalMetrics(TypedDict):
    total_demand_mw: float
    served_load_mw: float
    unserved_load_mw: float
    load_lost_percent: float
    total_generation_mw: float
    failed_components: int
    failed_lines: int
    cascade_depth: int
    peak_line_loading_percent: float
    overload_events: int


class CascadeResponse(TypedDict):
    initial_failure: FailedComponent
    termination_reason: TerminationReason
    cascade_depth: int
    steps: list[CascadeStep]
    final_metrics: CascadeFinalMetrics


def simulate_cascade(
    component_type: GridComponentType,
    component_id: str,
    max_steps: int = DEFAULT_MAX_CASCADE_STEPS,
    cascade_trip_threshold_percent: float = CASCADE_TRIP_THRESHOLD_PERCENT,
    net_factory: Callable[[], Any] | None = None,
) -> CascadeResponse:
    if max_steps < 0:
        raise ValueError("max_steps must be greater than or equal to 0")
    if cascade_trip_threshold_percent <= 0:
        raise ValueError("cascade_trip_threshold_percent must be greater than 0")

    net = net_factory() if net_factory is not None else create_test_grid()
    initial_failure: FailedComponent = {
        "component_type": component_type,
        "component_id": component_id,
    }
    failed_component_keys = {(component_type, component_id)}

    apply_component_outage(net, component_type, component_id)

    steps: list[CascadeStep] = []
    pending_failures = [initial_failure]
    step_index = 0
    termination_reason: TerminationReason = "stable"

    while True:
        event: CascadeEvent = "initial_failure" if step_index == 0 else "cascade_step"

        try:
            run_power_flow(net)
        except GridConvergenceError:
            grid = serialize_grid_state(net)
            step = _build_step(
                step_index=step_index,
                event="power_flow_failed",
                newly_failed_components=pending_failures,
                overloaded_lines=[],
                grid=grid,
            )
            steps.append(step)
            termination_reason = _blackout_or_power_failure_reason(grid)
            break

        grid = serialize_grid_state(net)
        overloaded_lines = _overloaded_lines(grid, cascade_trip_threshold_percent)
        step = _build_step(
            step_index=step_index,
            event=event,
            newly_failed_components=pending_failures,
            overloaded_lines=overloaded_lines,
            grid=grid,
        )
        steps.append(step)

        if _is_total_blackout(grid):
            termination_reason = "total_blackout"
            break

        next_failures = _new_line_failures(overloaded_lines, failed_component_keys)
        if not next_failures:
            termination_reason = "stable" if not overloaded_lines else "no_additional_failures"
            break

        if step_index >= max_steps:
            termination_reason = "max_steps_reached"
            break

        for failure in next_failures:
            failed_component_keys.add((failure["component_type"], failure["component_id"]))
            apply_component_outage(net, failure["component_type"], failure["component_id"])

        pending_failures = next_failures
        step_index += 1

    final_metrics = _final_metrics(steps)

    return {
        "initial_failure": initial_failure,
        "termination_reason": termination_reason,
        "cascade_depth": final_metrics["cascade_depth"],
        "steps": steps,
        "final_metrics": final_metrics,
    }


def _build_step(
    step_index: int,
    event: CascadeEvent,
    newly_failed_components: list[FailedComponent],
    overloaded_lines: list[OverloadedLine],
    grid: GridResponse,
) -> CascadeStep:
    return {
        "step": step_index,
        "event": event,
        "newly_failed_components": newly_failed_components,
        "overloaded_lines": overloaded_lines,
        "grid": grid,
        "metrics": {
            "total_demand_mw": grid["metrics"]["total_demand_mw"],
            "served_load_mw": grid["metrics"]["served_load_mw"],
            "unserved_load_mw": grid["metrics"]["unserved_load_mw"],
            "load_lost_percent": grid["metrics"]["load_lost_percent"],
            "total_generation_mw": grid["metrics"]["total_generation_mw"],
            "max_line_loading_percent": grid["metrics"]["max_line_loading_percent"],
            "failed_components": grid["metrics"]["failed_components"],
            "failed_lines": grid["metrics"]["failed_lines"],
            "overloaded_lines": len(overloaded_lines),
        },
    }


def _overloaded_lines(
    grid: GridResponse,
    cascade_trip_threshold_percent: float,
) -> list[OverloadedLine]:
    overloaded_lines: list[OverloadedLine] = []

    for line in grid["lines"]:
        loading_percent = line["loading_percent"]
        if line["status"] != "failed" and loading_percent is not None:
            if loading_percent > cascade_trip_threshold_percent:
                overloaded_lines.append(
                    {
                        "component_id": line["id"],
                        "loading_percent": loading_percent,
                    }
                )

    return overloaded_lines


def _new_line_failures(
    overloaded_lines: list[OverloadedLine],
    failed_component_keys: set[tuple[str, str]],
) -> list[FailedComponent]:
    failures: list[FailedComponent] = []

    for line in overloaded_lines:
        failure_key = ("line", line["component_id"])
        if failure_key in failed_component_keys:
            continue
        failures.append(
            {
                "component_type": "line",
                "component_id": line["component_id"],
            }
        )

    return failures


def _final_metrics(steps: list[CascadeStep]) -> CascadeFinalMetrics:
    final_step = steps[-1]
    total_demand = final_step["metrics"]["total_demand_mw"]
    unserved_load = final_step["metrics"]["unserved_load_mw"]
    load_lost_percent = 0.0
    if total_demand > 0:
        load_lost_percent = round((unserved_load / total_demand) * 100, 2)

    return {
        "total_demand_mw": total_demand,
        "served_load_mw": final_step["metrics"]["served_load_mw"],
        "unserved_load_mw": unserved_load,
        "load_lost_percent": load_lost_percent,
        "total_generation_mw": final_step["metrics"]["total_generation_mw"],
        "failed_components": final_step["metrics"]["failed_components"],
        "failed_lines": final_step["metrics"]["failed_lines"],
        "cascade_depth": max(len(steps) - 1, 0),
        "peak_line_loading_percent": max(
            step["metrics"]["max_line_loading_percent"] for step in steps
        ),
        "overload_events": sum(step["metrics"]["overloaded_lines"] for step in steps),
    }


def _blackout_or_power_failure_reason(grid: GridResponse) -> TerminationReason:
    return "total_blackout" if _is_total_blackout(grid) else "power_flow_failed"


def _is_total_blackout(grid: GridResponse) -> bool:
    metrics = grid["metrics"]
    return metrics["total_demand_mw"] > 0 and metrics["served_load_mw"] == 0
