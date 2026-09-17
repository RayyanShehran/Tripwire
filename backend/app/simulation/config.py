from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from app.simulation.grid import GridComponentType, create_test_grid

DEFAULT_SCENARIO_SEED = 42
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
    seed: int = DEFAULT_SCENARIO_SEED
    preset_id: str | None = None


def scenario_config(
    component_type: GridComponentType,
    component_id: str,
    operating_condition: dict[str, Any] | None = None,
    *,
    preset_id: str | None = None,
    seed: int = DEFAULT_SCENARIO_SEED,
) -> ScenarioConfig:
    condition = operating_condition or {}
    config = ScenarioConfig(
        load_multiplier=float(condition.get("load_multiplier", 1.0)),
        generation_multiplier=float(condition.get("generation_multiplier", 1.0)),
        line_rating_multiplier=float(condition.get("line_rating_multiplier", 1.0)),
        dispatch_profile=str(condition.get("dispatch_profile", "balanced")),
        initial_failure=ScenarioCandidate(component_type, component_id),
        seed=seed,
        preset_id=preset_id,
    )
    validate_scenario_config(config)
    return config


def validate_scenario_config(config: ScenarioConfig) -> None:
    if config.load_multiplier <= 0:
        raise ValueError("load_multiplier must be greater than 0")
    if config.generation_multiplier <= 0:
        raise ValueError("generation_multiplier must be greater than 0")
    if config.line_rating_multiplier <= 0:
        raise ValueError("line_rating_multiplier must be greater than 0")
    if config.dispatch_profile not in DISPATCH_FACTORS:
        raise ValueError(f"Unsupported dispatch profile: {config.dispatch_profile}")


def build_scenario_network(config: ScenarioConfig) -> Any:
    validate_scenario_config(config)
    net = create_test_grid()
    net.load.loc[:, "p_mw"] = net.load["p_mw"] * config.load_multiplier
    net.load.loc[:, "q_mvar"] = net.load["q_mvar"] * config.load_multiplier

    factors = DISPATCH_FACTORS[config.dispatch_profile]
    net.ext_grid.loc[:, "max_p_mw"] = SLACK_CAPACITY_MW * config.generation_multiplier
    for generator_index, generator in net.gen.iterrows():
        generator_id = str(generator["tripwire_id"])
        factor = config.generation_multiplier * factors[generator_id]
        net.gen.loc[generator_index, "p_mw"] = float(generator["p_mw"]) * factor
        net.gen.loc[generator_index, "max_p_mw"] = GENERATOR_CAPACITY_MW[generator_id] * factor

    net.line.loc[:, "max_i_ka"] = net.line["max_i_ka"] * config.line_rating_multiplier
    original_demand = float(net.load["p_mw"].sum()) if not net.load.empty else 0.0
    net["tripwire_original_demand_mw"] = original_demand
    net["tripwire_controlled_shed_mw"] = 0.0
    net["tripwire_scenario_id"] = scenario_fingerprint(config)
    return net


def available_generation_capacity_mw(config: ScenarioConfig) -> float:
    factors = DISPATCH_FACTORS[config.dispatch_profile]
    total = SLACK_CAPACITY_MW * config.generation_multiplier
    for generator_id, base_capacity in GENERATOR_CAPACITY_MW.items():
        total += base_capacity * config.generation_multiplier * factors[generator_id]
    return round(total, 4)


def scenario_config_payload(config: ScenarioConfig) -> dict[str, Any]:
    return {
        "preset_id": config.preset_id,
        "load_multiplier": round(config.load_multiplier, 4),
        "generation_multiplier": round(config.generation_multiplier, 4),
        "line_rating_multiplier": round(config.line_rating_multiplier, 4),
        "dispatch_profile": config.dispatch_profile,
        "initial_component_type": config.initial_failure.component_type,
        "initial_component_id": config.initial_failure.component_id,
        "seed": config.seed,
    }


def scenario_fingerprint(config: ScenarioConfig) -> str:
    payload = scenario_config_payload(config)
    payload.pop("preset_id", None)
    digest_source = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(digest_source.encode("utf-8")).hexdigest()[:16]
    return f"tw-{digest}"
