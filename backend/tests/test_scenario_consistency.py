from __future__ import annotations

from copy import deepcopy
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.simulation.config import build_scenario_network, scenario_config, scenario_fingerprint
from app.simulation.grid import run_power_flow, serialize_grid_state
from app.simulation.mitigation import MitigationAction, apply_mitigation_action, recommend_mitigations


STRESSED_CONDITION = {
    "load_multiplier": 1.25,
    "generation_multiplier": 1.0,
    "line_rating_multiplier": 0.35,
    "dispatch_profile": "balanced",
}


def test_failure_and_cascade_use_same_prefailure_demand() -> None:
    client = TestClient(app)
    payload = {
        "component_type": "line",
        "component_id": "line-101",
        "operating_condition": STRESSED_CONDITION,
    }

    failure = client.post("/api/failure", json=payload)
    cascade = client.post("/api/cascade", json=payload)

    assert failure.status_code == 200
    assert cascade.status_code == 200
    assert failure.json()["metrics"]["original_demand_mw"] == pytest.approx(500.0)
    assert cascade.json()["final_metrics"]["original_demand_mw"] == pytest.approx(500.0)
    assert failure.json()["scenario_id"] == cascade.json()["scenario_id"]


def test_prediction_cascade_and_recommendation_share_scenario_fingerprint() -> None:
    client = TestClient(app)
    payload = {
        "component_type": "line",
        "component_id": "line-101",
        "operating_condition": STRESSED_CONDITION,
    }

    prediction = client.post("/api/predict", json=payload)
    cascade = client.post("/api/cascade", json=payload)
    recommendation = client.post("/api/recommend", json={**payload, "top_n": 1})

    assert prediction.status_code == 200
    assert cascade.status_code == 200
    assert recommendation.status_code == 200
    scenario_ids = {
        prediction.json()["scenario_id"],
        cascade.json()["scenario_id"],
        recommendation.json()["scenario_id"],
    }
    assert len(scenario_ids) == 1
    assert prediction.json()["pre_failure_metrics"]["total_demand_mw"] == 500.0
    assert prediction.json()["scenario_config"] == cascade.json()["scenario_config"]
    assert recommendation.json()["scenario_config"] == cascade.json()["scenario_config"]


def test_controlled_load_shedding_counts_as_unserved_load() -> None:
    config = scenario_config("line", "line-101", STRESSED_CONDITION)
    net = build_scenario_network(config)
    apply_mitigation_action(
        net,
        MitigationAction(
            action_type="load_shedding",
            description="Shed 5% across all loads",
            parameters={"bus_id": "all", "shed_percent": 5.0},
            cost=5.0,
        ),
    )
    run_power_flow(net)

    metrics = serialize_grid_state(net)["metrics"]
    assert metrics["original_demand_mw"] == pytest.approx(500.0)
    assert metrics["served_load_mw"] == pytest.approx(475.0)
    assert metrics["controlled_shed_mw"] == pytest.approx(25.0)
    assert metrics["involuntary_unserved_mw"] == pytest.approx(0.0)
    assert metrics["total_unserved_mw"] == pytest.approx(25.0)
    assert metrics["load_lost_percent"] == pytest.approx(5.0)


def test_blackout_to_five_percent_reports_ninety_five_point_reduction() -> None:
    result = recommend_mitigations("line", "line-101", STRESSED_CONDITION, top_n=1)

    assert result["baseline"]["load_lost_percent"] == pytest.approx(100.0)
    best = result["recommendations"][0]
    assert best["predicted_or_simulated_outcome"]["load_lost_percent"] == pytest.approx(5.0)
    assert best["improvement"]["load_loss_reduction_percent_points"] == pytest.approx(95.0)


def test_recommendation_replay_does_not_mutate_original_cascade() -> None:
    result = recommend_mitigations("line", "line-101", STRESSED_CONDITION, top_n=1)
    original = deepcopy(result["baseline_cascade_result"])
    mitigated = result["recommendations"][0]["cascade_result"]

    assert original["final_metrics"]["load_lost_percent"] == pytest.approx(100.0)
    assert mitigated["final_metrics"]["load_lost_percent"] == pytest.approx(5.0)
    assert result["baseline_cascade_result"] == original


def test_grid_preview_matches_operating_profile() -> None:
    response = TestClient(app).get("/api/grid", params=STRESSED_CONDITION)
    assert response.status_code == 200
    assert response.json()["metrics"]["total_demand_mw"] == 500.0


@pytest.mark.parametrize("endpoint", ["failure", "cascade", "predict", "recommend"])
def test_invalid_dispatch_is_rejected_consistently(endpoint: str) -> None:
    response = TestClient(app).post(f"/api/{endpoint}", json={
        "component_type": "line", "component_id": "line-101",
        "operating_condition": {"dispatch_profile": "invalid"},
    })
    assert response.status_code == 422


def test_fingerprints_preserve_precision_but_ignore_preset_label() -> None:
    config = scenario_config("line", "line-101", STRESSED_CONDITION)
    assert scenario_fingerprint(config) != scenario_fingerprint(replace(config, load_multiplier=1.250001))
    assert scenario_fingerprint(config) == scenario_fingerprint(replace(config, preset_id="example"))


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -1.0])
def test_scenario_builder_rejects_nonfinite_or_negative_inputs(value: float) -> None:
    with pytest.raises(ValueError):
        scenario_config("line", "line-101", {"load_multiplier": value})
