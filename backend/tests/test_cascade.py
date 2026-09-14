from __future__ import annotations

import math
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.simulation import cascade
from app.simulation.grid import GridComponentNotFoundError, create_test_grid


def test_cascade_with_no_secondary_failures_is_stable() -> None:
    result = cascade.simulate_cascade("line", "line-101")

    assert result["termination_reason"] == "stable"
    assert result["cascade_depth"] == 0
    assert len(result["steps"]) == 1
    assert result["steps"][0]["newly_failed_components"] == [
        {"component_type": "line", "component_id": "line-101"}
    ]
    assert result["final_metrics"]["failed_lines"] == 1
    assert result["final_metrics"]["load_lost_percent"] == pytest.approx(0.0)


def test_cascade_trips_one_secondary_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    patch_line_ratings(monkeypatch, {"line-202": 0.25})

    result = cascade.simulate_cascade("line", "line-101")

    assert result["termination_reason"] == "stable"
    assert result["cascade_depth"] == 1
    assert result["steps"][0]["overloaded_lines"] == [
        {"component_id": "line-202", "loading_percent": pytest.approx(145.485)}
    ]
    assert result["steps"][1]["newly_failed_components"] == [
        {"component_type": "line", "component_id": "line-202"}
    ]
    assert result["final_metrics"]["failed_lines"] == 2


def test_cascade_supports_multi_step_propagation(monkeypatch: pytest.MonkeyPatch) -> None:
    patch_line_ratings(
        monkeypatch,
        {
            "line-102": 0.1,
            "line-201": 0.2,
            "line-202": 0.25,
            "line-403": 0.2,
        },
    )

    result = cascade.simulate_cascade("line", "line-101")

    assert result["termination_reason"] == "total_blackout"
    assert result["cascade_depth"] == 2
    assert len(result["steps"]) == 3
    assert result["steps"][1]["overloaded_lines"] == [
        {"component_id": "line-201", "loading_percent": pytest.approx(385.9246)}
    ]
    assert result["final_metrics"]["load_lost_percent"] == pytest.approx(100.0)
    assert result["final_metrics"]["failed_lines"] == 11


def test_already_failed_line_is_not_tripped_twice(monkeypatch: pytest.MonkeyPatch) -> None:
    patch_line_ratings(monkeypatch, {"line-202": 0.25})

    result = cascade.simulate_cascade("line", "line-101")
    failed_ids = [
        component["component_id"]
        for step in result["steps"]
        for component in step["newly_failed_components"]
    ]

    assert failed_ids.count("line-101") == 1
    assert failed_ids.count("line-202") == 1


def test_cascade_stops_at_max_steps(monkeypatch: pytest.MonkeyPatch) -> None:
    patch_line_ratings(monkeypatch, {"line-202": 0.25})

    result = cascade.simulate_cascade("line", "line-101", max_steps=0)

    assert result["termination_reason"] == "max_steps_reached"
    assert result["cascade_depth"] == 0
    assert len(result["steps"]) == 1
    assert result["steps"][0]["overloaded_lines"]


def test_cascade_handles_islanded_network_safely() -> None:
    result = cascade.simulate_cascade("bus", "bus-3")

    assert result["termination_reason"] == "stable"
    assert result["final_metrics"]["unserved_load_mw"] == pytest.approx(110.0)
    assert result["final_metrics"]["load_lost_percent"] == pytest.approx(27.5)
    assert_no_nonfinite_numbers(result)


def test_cascade_handles_total_blackout_case() -> None:
    result = cascade.simulate_cascade("bus", "bus-0")

    assert result["termination_reason"] == "total_blackout"
    assert result["final_metrics"]["served_load_mw"] == pytest.approx(0.0)
    assert result["final_metrics"]["unserved_load_mw"] == pytest.approx(400.0)
    assert result["final_metrics"]["load_lost_percent"] == pytest.approx(100.0)
    assert_no_nonfinite_numbers(result)


def test_cascade_response_has_no_nan_or_infinity_values(monkeypatch: pytest.MonkeyPatch) -> None:
    patch_line_ratings(monkeypatch, {"line-202": 0.25})

    assert_no_nonfinite_numbers(cascade.simulate_cascade("line", "line-101"))


def test_cascade_depth_matches_recorded_step_count(monkeypatch: pytest.MonkeyPatch) -> None:
    patch_line_ratings(monkeypatch, {"line-202": 0.25})

    result = cascade.simulate_cascade("line", "line-101")

    assert result["cascade_depth"] == len(result["steps"]) - 1
    assert result["cascade_depth"] == result["final_metrics"]["cascade_depth"]


def test_cascade_load_lost_percentage_is_based_on_total_demand() -> None:
    result = cascade.simulate_cascade("bus", "bus-3")

    assert result["final_metrics"]["total_demand_mw"] == pytest.approx(400.0)
    assert result["final_metrics"]["unserved_load_mw"] == pytest.approx(110.0)
    assert result["final_metrics"]["load_lost_percent"] == pytest.approx(27.5)


def test_cascade_is_deterministic_for_repeated_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    patch_line_ratings(monkeypatch, {"line-202": 0.25})

    first = cascade.simulate_cascade("line", "line-101")
    second = cascade.simulate_cascade("line", "line-101")

    assert first == second


def test_cascade_rejects_invalid_initial_component() -> None:
    with pytest.raises(GridComponentNotFoundError, match="Unknown line"):
        cascade.simulate_cascade("line", "bad-id")


def test_post_api_cascade_returns_cascade_response() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/cascade",
        json={"component_type": "line", "component_id": "line-101"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["initial_failure"] == {
        "component_type": "line",
        "component_id": "line-101",
    }
    assert payload["termination_reason"] == "stable"
    assert payload["steps"]


def test_post_api_cascade_validates_request() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/cascade",
        json={"component_type": "line", "component_id": "line-101", "max_steps": -1},
    )

    assert response.status_code == 422


def test_post_api_cascade_rejects_invalid_initial_component() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/cascade",
        json={"component_type": "line", "component_id": "bad-id"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Unknown line: bad-id"


def patch_line_ratings(
    monkeypatch: pytest.MonkeyPatch,
    ratings: dict[str, float],
) -> None:
    def weak_grid():
        net = create_test_grid()
        for line_id, max_i_ka in ratings.items():
            line_index = net.line.index[net.line["tripwire_id"] == line_id][0]
            net.line.loc[line_index, "max_i_ka"] = max_i_ka
        return net

    monkeypatch.setattr(cascade, "create_test_grid", weak_grid)


def assert_no_nonfinite_numbers(value: Any) -> None:
    if isinstance(value, dict):
        for nested in value.values():
            assert_no_nonfinite_numbers(nested)
        return

    if isinstance(value, list):
        for nested in value:
            assert_no_nonfinite_numbers(nested)
        return

    if isinstance(value, float):
        assert math.isfinite(value)
