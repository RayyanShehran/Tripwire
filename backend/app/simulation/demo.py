from __future__ import annotations

from typing import Literal, TypedDict

from app.simulation.config import ScenarioCandidate, ScenarioConfig


class DemoOperatingCondition(TypedDict):
    load_multiplier: float
    generation_multiplier: float
    line_rating_multiplier: float
    dispatch_profile: str


class DemoInitialFailure(TypedDict):
    component_type: Literal["line", "bus", "generator", "load"]
    component_id: str


class DemoExpectedOutcome(TypedDict):
    cascade_depth: int
    load_lost_percent: float
    failed_lines: int
    mitigation_expected: bool


class DemoPreset(TypedDict):
    id: str
    name: str
    summary: str
    initial_failure: DemoInitialFailure
    operating_condition: DemoOperatingCondition
    expected_outcome: DemoExpectedOutcome
    suggested_steps: list[str]


DEMO_PRESETS: tuple[DemoPreset, ...] = (
    {
        "id": "low-risk",
        "name": "Low Risk",
        "summary": "Trips a lightly loaded corridor under normal demand; the grid remains served.",
        "initial_failure": {"component_type": "line", "component_id": "line-402"},
        "operating_condition": {
            "load_multiplier": 1.0,
            "generation_multiplier": 1.0,
            "line_rating_multiplier": 1.0,
            "dispatch_profile": "balanced",
        },
        "expected_outcome": {
            "cascade_depth": 0,
            "load_lost_percent": 0.0,
            "failed_lines": 1,
            "mitigation_expected": False,
        },
        "suggested_steps": [
            "Predict risk",
            "Run cascade",
            "Show that the outage is contained",
        ],
    },
    {
        "id": "severe-cascade",
        "name": "Severe Cascade",
        "summary": "Trips a central tie line during constrained operation; overloads propagate to blackout.",
        "initial_failure": {"component_type": "line", "component_id": "line-101"},
        "operating_condition": {
            "load_multiplier": 1.25,
            "generation_multiplier": 1.0,
            "line_rating_multiplier": 0.35,
            "dispatch_profile": "balanced",
        },
        "expected_outcome": {
            "cascade_depth": 2,
            "load_lost_percent": 100.0,
            "failed_lines": 12,
            "mitigation_expected": True,
        },
        "suggested_steps": [
            "Predict risk",
            "Run cascade",
            "Play the timeline",
            "Inspect failed lines and lost load",
        ],
    },
    {
        "id": "mitigation-example",
        "name": "Mitigation Example",
        "summary": "Uses the same risky line outage so the recommendation panel can compare before and after.",
        "initial_failure": {"component_type": "line", "component_id": "line-101"},
        "operating_condition": {
            "load_multiplier": 1.25,
            "generation_multiplier": 1.0,
            "line_rating_multiplier": 0.35,
            "dispatch_profile": "balanced",
        },
        "expected_outcome": {
            "cascade_depth": 2,
            "load_lost_percent": 100.0,
            "failed_lines": 12,
            "mitigation_expected": True,
        },
        "suggested_steps": [
            "Predict risk",
            "Run cascade",
            "Find mitigation",
            "Simulate the top recommendation",
        ],
    },
)


def list_demo_presets() -> list[DemoPreset]:
    return [dict(preset) for preset in DEMO_PRESETS]


def demo_config(preset: DemoPreset) -> ScenarioConfig:
    condition = preset["operating_condition"]
    failure = preset["initial_failure"]
    return ScenarioConfig(
        load_multiplier=condition["load_multiplier"],
        generation_multiplier=condition["generation_multiplier"],
        line_rating_multiplier=condition["line_rating_multiplier"],
        dispatch_profile=condition["dispatch_profile"],
        initial_failure=ScenarioCandidate(
            failure["component_type"],
            failure["component_id"],
        ),
        seed=42,
    )
