from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.simulation.demo import list_demo_presets


def test_demo_presets_are_available_from_api() -> None:
    client = TestClient(app)

    response = client.get("/api/demo-presets")

    assert response.status_code == 200
    payload = response.json()
    assert [preset["id"] for preset in payload["presets"]] == [
        "low-risk",
        "severe-cascade",
        "mitigation-example",
    ]


def test_demo_presets_have_deterministic_expected_cascade_outputs() -> None:
    client = TestClient(app)

    for preset in list_demo_presets():
        response = client.post(
            "/api/cascade",
            json={
                "component_type": preset["initial_failure"]["component_type"],
                "component_id": preset["initial_failure"]["component_id"],
                "operating_condition": preset["operating_condition"],
            },
        )

        assert response.status_code == 200
        payload = response.json()
        expected = preset["expected_outcome"]
        assert payload["cascade_depth"] == expected["cascade_depth"]
        assert payload["final_metrics"]["load_lost_percent"] == expected["load_lost_percent"]
        assert payload["final_metrics"]["failed_lines"] == expected["failed_lines"]


def test_demo_mitigation_preset_has_beneficial_recommendation() -> None:
    client = TestClient(app)
    preset = next(
        preset for preset in list_demo_presets() if preset["id"] == "mitigation-example"
    )

    response = client.post(
        "/api/recommend",
        json={
            "component_type": preset["initial_failure"]["component_type"],
            "component_id": preset["initial_failure"]["component_id"],
            "operating_condition": preset["operating_condition"],
            "top_n": 1,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["recommendations"]
    best = payload["recommendations"][0]["predicted_or_simulated_outcome"]
    assert best["load_lost_percent"] < payload["baseline"]["load_lost_percent"]
