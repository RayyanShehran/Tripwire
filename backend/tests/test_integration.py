from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_full_api_demo_sequence() -> None:
    client = TestClient(app)
    operating_condition = {
        "load_multiplier": 1.25,
        "generation_multiplier": 1.0,
        "line_rating_multiplier": 0.35,
        "dispatch_profile": "balanced",
    }

    health = client.get("/health")
    ready = client.get("/ready")
    grid = client.get("/api/grid")
    prediction = client.post(
        "/api/predict",
        json={
            "component_type": "line",
            "component_id": "line-101",
            "operating_condition": operating_condition,
        },
    )
    failure = client.post(
        "/api/failure",
        json={"component_type": "line", "component_id": "line-101"},
    )
    cascade = client.post(
        "/api/cascade",
        json={
            "component_type": "line",
            "component_id": "line-101",
            "operating_condition": operating_condition,
        },
    )
    recommendation = client.post(
        "/api/recommend",
        json={
            "component_type": "line",
            "component_id": "line-101",
            "operating_condition": operating_condition,
            "top_n": 3,
        },
    )
    reset = client.post("/api/reset")

    assert health.status_code == 200
    assert ready.status_code == 200
    assert grid.status_code == 200
    assert prediction.status_code == 200
    assert failure.status_code == 200
    assert cascade.status_code == 200
    assert recommendation.status_code == 200
    assert reset.status_code == 200

    grid_payload = grid.json()
    prediction_payload = prediction.json()
    cascade_payload = cascade.json()
    recommendation_payload = recommendation.json()

    assert grid_payload == reset.json()
    assert 0.0 <= prediction_payload["cascade_probability"] <= 1.0
    assert cascade_payload["final_metrics"]["load_lost_percent"] == 100.0
    assert recommendation_payload["baseline"]["load_lost_percent"] == 100.0
    assert recommendation_payload["recommendations"]
    assert (
        recommendation_payload["recommendations"][0]["predicted_or_simulated_outcome"][
            "load_lost_percent"
        ]
        < recommendation_payload["baseline"]["load_lost_percent"]
    )


def test_predict_and_recommend_reject_same_invalid_component_consistently() -> None:
    client = TestClient(app)
    payload = {"component_type": "line", "component_id": "not-a-line"}

    assert client.post("/api/predict", json=payload).status_code == 404
    assert client.post("/api/recommend", json=payload).status_code == 404
