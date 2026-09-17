from __future__ import annotations

from math import isfinite
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.simulation.config import ScenarioCandidate, ScenarioConfig, build_scenario_network
from app.main import app
from app.simulation.mitigation import (
    MAX_GENERATOR_REDISPATCH_PERCENT,
    MAX_LOAD_SHED_PERCENT,
    MitigationAction,
    generate_candidate_actions,
    is_feasible_action,
    recommend_mitigations,
)


def severe_line_config() -> ScenarioConfig:
    return ScenarioConfig(
        load_multiplier=1.25,
        generation_multiplier=1.0,
        line_rating_multiplier=0.35,
        dispatch_profile="balanced",
        initial_failure=ScenarioCandidate("line", "line-101"),
        seed=42,
    )


def test_mitigation_candidate_generation_is_bounded() -> None:
    candidates = generate_candidate_actions(severe_line_config(), max_candidates=10)

    assert 1 <= len(candidates) <= 10
    assert {candidate.action_type for candidate in candidates}.issubset(
        {"generator_redispatch", "load_shedding"}
    )


def test_load_shedding_candidates_stay_within_bounds() -> None:
    candidates = generate_candidate_actions(severe_line_config(), max_candidates=30)
    load_shedding = [
        candidate for candidate in candidates if candidate.action_type == "load_shedding"
    ]

    assert load_shedding
    assert all(
        0.0 < float(candidate.parameters["shed_percent"]) <= MAX_LOAD_SHED_PERCENT
        for candidate in load_shedding
    )


def test_generator_redispatch_respects_limits() -> None:
    candidates = generate_candidate_actions(severe_line_config(), max_candidates=30)
    redispatch = [
        candidate for candidate in candidates if candidate.action_type == "generator_redispatch"
    ]

    assert redispatch
    assert all(
        0.0 < float(candidate.parameters["redispatch_percent"]) <= MAX_GENERATOR_REDISPATCH_PERCENT
        for candidate in redispatch
    )
    assert all(is_feasible_action(severe_line_config(), candidate) for candidate in redispatch)


def test_infeasible_generator_redispatch_is_rejected() -> None:
    action = MitigationAction(
        action_type="generator_redispatch",
        description="bad redispatch",
        parameters={
            "increase_generator_id": "gen-south",
            "decrease_generator_id": "gen-harbor",
            "delta_mw": 10000.0,
        },
        cost=10.0,
    )

    assert not is_feasible_action(severe_line_config(), action)


def test_baseline_is_always_included_and_recommendations_are_sorted() -> None:
    result = recommend_mitigations(
        "line",
        "line-101",
        {
            "load_multiplier": 1.25,
            "generation_multiplier": 1.0,
            "line_rating_multiplier": 0.35,
            "dispatch_profile": "balanced",
        },
    )

    scores = [recommendation["score"] for recommendation in result["recommendations"]]
    assert result["baseline"]["load_lost_percent"] == 100.0
    assert scores == sorted(scores, reverse=True)


def test_known_scenario_has_simulated_improving_mitigation() -> None:
    result = recommend_mitigations(
        "line",
        "line-101",
        {
            "load_multiplier": 1.25,
            "generation_multiplier": 1.0,
            "line_rating_multiplier": 0.35,
            "dispatch_profile": "balanced",
        },
    )

    assert result["recommendations"]
    best = result["recommendations"][0]
    assert best["improvement"]["load_loss_reduction_percent_points"] > 0
    assert (
        best["predicted_or_simulated_outcome"]["load_lost_percent"]
        < result["baseline"]["load_lost_percent"]
    )
    assert best["cascade_result"]["final_metrics"]["load_lost_percent"] == best[
        "predicted_or_simulated_outcome"
    ]["load_lost_percent"]


def test_low_risk_scenario_can_report_no_beneficial_action() -> None:
    result = recommend_mitigations("line", "line-402")

    assert result["baseline"]["load_lost_percent"] == 0.0
    assert result["recommendations"] == []
    assert "No beneficial mitigation" in result["summary"]


def test_repeated_recommendation_calls_are_deterministic() -> None:
    condition = {
        "load_multiplier": 1.25,
        "generation_multiplier": 1.0,
        "line_rating_multiplier": 0.35,
        "dispatch_profile": "balanced",
    }
    first = recommend_mitigations("line", "line-101", condition)
    second = recommend_mitigations("line", "line-101", condition)

    assert first["baseline"] == second["baseline"]
    assert first["recommendations"] == second["recommendations"]


def test_recommendation_response_has_no_nan_or_infinity() -> None:
    result = recommend_mitigations(
        "line",
        "line-101",
        {
            "load_multiplier": 1.25,
            "generation_multiplier": 1.0,
            "line_rating_multiplier": 0.35,
            "dispatch_profile": "balanced",
        },
    )

    assert_no_nonfinite_numbers(result)


def test_recommend_api_valid_request() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/recommend",
        json={
            "component_type": "line",
            "component_id": "line-101",
            "operating_condition": {
                "load_multiplier": 1.25,
                "generation_multiplier": 1.0,
                "line_rating_multiplier": 0.35,
                "dispatch_profile": "balanced",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["baseline"]["load_lost_percent"] == 100.0
    assert payload["candidate_count"] <= 24
    assert payload["recommendations"]


def test_recommend_api_rejects_invalid_component() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/recommend",
        json={"component_type": "line", "component_id": "bad-line"},
    )

    assert response.status_code == 404


def test_mitigated_grid_does_not_shed_more_load_than_exists() -> None:
    net = build_scenario_network(severe_line_config())
    original_load = float(net.load["p_mw"].sum())
    candidates = generate_candidate_actions(severe_line_config(), max_candidates=30)
    shedding = next(candidate for candidate in candidates if candidate.action_type == "load_shedding")

    from app.simulation.mitigation import apply_mitigation_action

    apply_mitigation_action(net, shedding)

    assert 0.0 <= float(net.load["p_mw"].sum()) <= original_load


def test_generator_redispatch_preserves_demand() -> None:
    config = severe_line_config()
    net = build_scenario_network(config)
    original_demand = float(net.load["p_mw"].sum())
    action = next(
        candidate
        for candidate in generate_candidate_actions(config, max_candidates=30)
        if candidate.action_type == "generator_redispatch"
    )

    from app.simulation.mitigation import apply_mitigation_action

    apply_mitigation_action(net, action)

    assert float(net.load["p_mw"].sum()) == pytest.approx(original_demand)


def assert_no_nonfinite_numbers(value: Any) -> None:
    if isinstance(value, dict):
        for child in value.values():
            assert_no_nonfinite_numbers(child)
        return
    if isinstance(value, list):
        for child in value:
            assert_no_nonfinite_numbers(child)
        return
    if isinstance(value, (int, float)):
        assert isfinite(float(value))
