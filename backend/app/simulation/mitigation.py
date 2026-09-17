from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from typing import Any, Literal, TypedDict

from app.simulation.config import (
    DISPATCH_FACTORS,
    GENERATOR_CAPACITY_MW,
    ScenarioConfig,
    build_scenario_network,
    scenario_config,
    scenario_config_payload,
    scenario_fingerprint,
)
from app.simulation.cascade import CascadeResponse, simulate_cascade
from app.simulation.grid import GridComponentNotFoundError, GridComponentType

MitigationActionType = Literal["none", "generator_redispatch", "load_shedding"]

MAX_GENERATOR_REDISPATCH_PERCENT = 10.0
MAX_LOAD_SHED_PERCENT = 10.0
LOAD_LOSS_REDUCTION_WEIGHT = 10.0
FAILED_COMPONENT_REDUCTION_WEIGHT = 2.0
CASCADE_DEPTH_REDUCTION_WEIGHT = 3.0
INTERVENTION_COST_WEIGHT = 0.25


class MitigationOutcome(TypedDict):
    original_demand_mw: float
    served_load_mw: float
    controlled_shed_mw: float
    involuntary_unserved_mw: float
    total_unserved_mw: float
    load_lost_percent: float
    cascade_depth: int
    failed_lines: int
    failed_components: int
    unserved_load_mw: float
    termination_reason: str


class MitigationImprovement(TypedDict):
    load_loss_reduction_percent_points: float
    failed_lines_reduced: int
    failed_components_reduced: int
    cascade_depth_reduced: int
    unserved_load_reduction_mw: float


class RecommendationResponse(TypedDict):
    scenario_id: str
    scenario_config: dict[str, object]
    baseline: MitigationOutcome
    baseline_cascade_result: CascadeResponse
    recommendations: list[dict[str, Any]]
    summary: str
    candidate_count: int
    feasible_candidate_count: int
    evaluated_candidate_count: int
    execution_time_ms: float
    scoring_weights: dict[str, float]


@dataclass(frozen=True)
class MitigationAction:
    action_type: MitigationActionType
    description: str
    parameters: dict[str, Any]
    cost: float


def recommend_mitigations(
    component_type: GridComponentType,
    component_id: str,
    operating_condition: dict[str, Any] | None = None,
    config: ScenarioConfig | None = None,
    max_candidates: int = 24,
    top_n: int = 3,
) -> RecommendationResponse:
    started = perf_counter()
    config = config or scenario_config(component_type, component_id, operating_condition)
    baseline_result = simulate_cascade(
        component_type=component_type,
        component_id=component_id,
        config=config,
    )
    baseline = _outcome(baseline_result)
    candidates = generate_candidate_actions(config, max_candidates=max_candidates)
    evaluated: list[dict[str, Any]] = []

    for action in candidates:
        result = simulate_cascade(
            component_type=component_type,
            component_id=component_id,
            net_factory=lambda action=action: _mitigated_grid(config, action),
            config=config,
        )
        outcome = _outcome(result)
        improvement = _improvement(baseline, outcome)
        score = _score(improvement, action.cost)
        evaluated.append(
            {
                "action_type": action.action_type,
                "description": action.description,
                "parameters": action.parameters,
                "predicted_or_simulated_outcome": outcome,
                "improvement": improvement,
                "score": score,
                "cascade_result": result,
            }
        )

    evaluated.sort(
        key=lambda item: (
            item["score"],
            item["improvement"]["load_loss_reduction_percent_points"],
            item["improvement"]["failed_components_reduced"],
        ),
        reverse=True,
    )

    beneficial = [item for item in evaluated if item["score"] > 0]
    selected = beneficial[:top_n]

    return {
        "scenario_id": scenario_fingerprint(config),
        "scenario_config": scenario_config_payload(config),
        "baseline": baseline,
        "baseline_cascade_result": baseline_result,
        "recommendations": [
            {**item, "rank": index + 1}
            for index, item in enumerate(selected)
        ],
        "summary": _summary(selected),
        "candidate_count": len(candidates),
        "feasible_candidate_count": len(candidates),
        "evaluated_candidate_count": len(evaluated),
        "execution_time_ms": round((perf_counter() - started) * 1000, 2),
        "scoring_weights": scoring_weights(),
    }


def generate_candidate_actions(
    config: ScenarioConfig,
    max_candidates: int = 24,
) -> list[MitigationAction]:
    actions = [
        action
        for action in [*_generator_redispatch_candidates(config), *_load_shedding_candidates(config)]
        if is_feasible_action(config, action)
    ]
    return actions[:max_candidates]


def is_feasible_action(config: ScenarioConfig, action: MitigationAction) -> bool:
    if action.action_type == "generator_redispatch":
        increase_id = str(action.parameters["increase_generator_id"])
        decrease_id = str(action.parameters["decrease_generator_id"])
        delta_mw = float(action.parameters["delta_mw"])
        dispatch = _generator_dispatch_targets(config)
        return (
            delta_mw > 0
            and increase_id in dispatch
            and decrease_id in dispatch
            and increase_id != decrease_id
            and dispatch[increase_id] + delta_mw <= _generator_capacity(config, increase_id)
            and dispatch[decrease_id] - delta_mw >= 0
        )

    if action.action_type == "load_shedding":
        shed_percent = float(action.parameters["shed_percent"])
        return 0.0 < shed_percent <= MAX_LOAD_SHED_PERCENT

    return action.action_type == "none"


def scoring_weights() -> dict[str, float]:
    return {
        "load_loss_reduction": LOAD_LOSS_REDUCTION_WEIGHT,
        "failed_component_reduction": FAILED_COMPONENT_REDUCTION_WEIGHT,
        "cascade_depth_reduction": CASCADE_DEPTH_REDUCTION_WEIGHT,
        "intervention_cost_penalty": INTERVENTION_COST_WEIGHT,
    }


def _summary(recommendations: list[dict[str, Any]]) -> str:
    if recommendations:
        return "Recommended based on Tripwire simulation."
    return "No beneficial mitigation found within the bounded candidate set."


def _generator_redispatch_candidates(config: ScenarioConfig) -> list[MitigationAction]:
    actions: list[MitigationAction] = []
    dispatch = _generator_dispatch_targets(config)
    for percent in (5.0, 10.0):
        for increase_id, decrease_id in (("gen-south", "gen-harbor"), ("gen-harbor", "gen-south")):
            delta_mw = round(dispatch[decrease_id] * (percent / 100.0), 4)
            actions.append(
                MitigationAction(
                    action_type="generator_redispatch",
                    description=(
                        f"Increase {increase_id} by {delta_mw:.1f} MW and reduce "
                        f"{decrease_id} by {delta_mw:.1f} MW"
                    ),
                    parameters={
                        "increase_generator_id": increase_id,
                        "decrease_generator_id": decrease_id,
                        "delta_mw": delta_mw,
                        "redispatch_percent": percent,
                    },
                    cost=percent,
                )
            )
    return actions


def _load_shedding_candidates(config: ScenarioConfig) -> list[MitigationAction]:
    net = build_scenario_network(config)
    actions: list[MitigationAction] = []
    for shed_percent in (2.0, 5.0, 10.0):
        actions.append(
            MitigationAction(
                action_type="load_shedding",
                description=f"Shed {shed_percent:.0f}% of total load across all load buses",
                parameters={
                    "bus_id": "all",
                    "shed_percent": shed_percent,
                },
                cost=shed_percent,
            )
        )
        for _, load in net.load.sort_values("tripwire_id").iterrows():
            bus_id = str(net.bus.at[int(load["bus"]), "tripwire_id"])
            load_mw = float(load["p_mw"])
            shed_mw = round(load_mw * (shed_percent / 100.0), 4)
            actions.append(
                MitigationAction(
                    action_type="load_shedding",
                    description=f"Shed {shed_percent:.0f}% ({shed_mw:.1f} MW) at {bus_id}",
                    parameters={
                        "bus_id": bus_id,
                        "shed_percent": shed_percent,
                        "shed_mw": shed_mw,
                    },
                    cost=shed_percent,
                )
            )
    return actions


def _mitigated_grid(config: ScenarioConfig, action: MitigationAction):
    net = build_scenario_network(config)
    apply_mitigation_action(net, action)
    return net


def apply_mitigation_action(net: Any, action: MitigationAction) -> None:
    if action.action_type == "generator_redispatch":
        demand_before = float(net.load["p_mw"].sum())
        increase_id = str(action.parameters["increase_generator_id"])
        decrease_id = str(action.parameters["decrease_generator_id"])
        delta_mw = float(action.parameters["delta_mw"])
        _adjust_generator(net, increase_id, delta_mw)
        _adjust_generator(net, decrease_id, -delta_mw)
        if abs(float(net.load["p_mw"].sum()) - demand_before) > 1e-9:
            raise ValueError("Generator redispatch must not change demand")
        return

    if action.action_type == "load_shedding":
        demand_before = float(net.load["p_mw"].sum())
        bus_id = str(action.parameters["bus_id"])
        shed_percent = float(action.parameters["shed_percent"])
        if bus_id == "all":
            net.load.loc[:, "p_mw"] = net.load["p_mw"] * (1.0 - shed_percent / 100.0)
            net.load.loc[:, "q_mvar"] = net.load["q_mvar"] * (1.0 - shed_percent / 100.0)
            _record_controlled_shed(net, demand_before)
            return

        bus_matches = net.bus.index[net.bus["tripwire_id"] == bus_id].tolist()
        if not bus_matches:
            raise GridComponentNotFoundError(f"Unknown bus: {bus_id}")
        bus_index = int(bus_matches[0])
        load_rows = net.load.bus == bus_index
        net.load.loc[load_rows, "p_mw"] = net.load.loc[load_rows, "p_mw"] * (1.0 - shed_percent / 100.0)
        net.load.loc[load_rows, "q_mvar"] = net.load.loc[load_rows, "q_mvar"] * (1.0 - shed_percent / 100.0)
        _record_controlled_shed(net, demand_before)


def _record_controlled_shed(net: Any, demand_before: float) -> None:
    shed_mw = max(demand_before - float(net.load["p_mw"].sum()), 0.0)
    current = float(net.get("tripwire_controlled_shed_mw", 0.0))
    net["tripwire_controlled_shed_mw"] = current + shed_mw


def _adjust_generator(net: Any, generator_id: str, delta_mw: float) -> None:
    matches = net.gen.index[net.gen["tripwire_id"] == generator_id].tolist()
    if not matches:
        raise GridComponentNotFoundError(f"Unknown generator: {generator_id}")
    generator_index = int(matches[0])
    dispatch = float(net.gen.at[generator_index, "p_mw"]) + delta_mw
    capacity = float(net.gen.at[generator_index, "max_p_mw"])
    if dispatch < 0 or dispatch > capacity + 1e-9:
        raise ValueError(f"Redispatch exceeds limits for {generator_id}")
    net.gen.loc[generator_index, "p_mw"] = dispatch


def _generator_dispatch_targets(config: ScenarioConfig) -> dict[str, float]:
    factors = DISPATCH_FACTORS[config.dispatch_profile]
    return {
        generator_id: round(base_mw * config.generation_multiplier * factors[generator_id], 4)
        for generator_id, base_mw in {"gen-south": 150.0, "gen-harbor": 95.0}.items()
    }


def _generator_capacity(config: ScenarioConfig, generator_id: str) -> float:
    return round(
        GENERATOR_CAPACITY_MW[generator_id]
        * config.generation_multiplier
        * DISPATCH_FACTORS[config.dispatch_profile][generator_id],
        4,
    )


def _outcome(result: CascadeResponse) -> MitigationOutcome:
    metrics = result["final_metrics"]
    return {
        "original_demand_mw": metrics["original_demand_mw"],
        "served_load_mw": metrics["served_load_mw"],
        "controlled_shed_mw": metrics["controlled_shed_mw"],
        "involuntary_unserved_mw": metrics["involuntary_unserved_mw"],
        "total_unserved_mw": metrics["total_unserved_mw"],
        "load_lost_percent": metrics["load_lost_percent"],
        "cascade_depth": metrics["cascade_depth"],
        "failed_lines": metrics["failed_lines"],
        "failed_components": metrics["failed_components"],
        "unserved_load_mw": metrics["unserved_load_mw"],
        "termination_reason": result["termination_reason"],
    }


def _improvement(
    baseline: MitigationOutcome,
    outcome: MitigationOutcome,
) -> MitigationImprovement:
    return {
        "load_loss_reduction_percent_points": round(
            baseline["load_lost_percent"] - outcome["load_lost_percent"], 4
        ),
        "failed_lines_reduced": baseline["failed_lines"] - outcome["failed_lines"],
        "failed_components_reduced": baseline["failed_components"] - outcome["failed_components"],
        "cascade_depth_reduced": baseline["cascade_depth"] - outcome["cascade_depth"],
        "unserved_load_reduction_mw": round(
            baseline["unserved_load_mw"] - outcome["unserved_load_mw"], 4
        ),
    }


def _score(improvement: MitigationImprovement, cost: float) -> float:
    return round(
        improvement["load_loss_reduction_percent_points"] * LOAD_LOSS_REDUCTION_WEIGHT
        + improvement["failed_components_reduced"] * FAILED_COMPONENT_REDUCTION_WEIGHT
        + improvement["cascade_depth_reduced"] * CASCADE_DEPTH_REDUCTION_WEIGHT
        - cost * INTERVENTION_COST_WEIGHT,
        4,
    )
