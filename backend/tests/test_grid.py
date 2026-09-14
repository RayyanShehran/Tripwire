from __future__ import annotations

import math
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app import main
from app.simulation.scenario import ComponentFailure, get_baseline_grid, simulate_failure
from app.simulation.grid import (
    GridComponentNotFoundError,
    GridConvergenceError,
    apply_component_outage,
    create_test_grid,
    get_grid_response,
    run_power_flow,
    serialize_grid_state,
)


def test_create_test_grid_contains_expected_components() -> None:
    net = create_test_grid()

    assert len(net.bus) == 8
    assert len(net.ext_grid) + len(net.gen) == 3
    assert len(net.load) == 4
    assert len(net.line) == 12
    assert set(net.bus["vn_kv"]) == {230.0}


def test_run_power_flow_converges() -> None:
    net = run_power_flow(create_test_grid())

    assert net.converged is True
    assert not net.res_line.empty
    assert net.res_line["loading_percent"].max() > 0


def test_grid_response_contains_expected_fields() -> None:
    response = get_grid_response()

    assert set(response) == {"nodes", "lines", "metrics"}
    assert len(response["nodes"]) == 15
    assert len(response["lines"]) == 12
    assert response["metrics"]["total_demand_mw"] == pytest.approx(400.0)
    assert response["metrics"]["served_load_mw"] == pytest.approx(400.0)
    assert response["metrics"]["unserved_load_mw"] == pytest.approx(0.0)
    assert response["metrics"]["total_generation_mw"] > response["metrics"]["served_load_mw"]
    assert response["metrics"]["max_line_loading_percent"] > 0

    first_node = response["nodes"][0]
    assert {
        "id",
        "name",
        "type",
        "status",
        "voltage",
        "generation_mw",
        "load_mw",
        "connected_bus_id",
    }.issubset(first_node)

    first_line = response["lines"][0]
    assert {
        "id",
        "name",
        "source",
        "target",
        "capacity_mw",
        "loading_percent",
        "status",
    }.issubset(first_line)


def test_baseline_grid_is_healthy_and_below_stress_threshold() -> None:
    response = get_grid_response()

    assert {node["status"] for node in response["nodes"]} == {"healthy"}
    assert {line["status"] for line in response["lines"]} == {"healthy"}
    assert response["metrics"]["max_line_loading_percent"] < 80.0


def test_grid_response_has_no_nan_or_infinity_values() -> None:
    assert_no_nonfinite_numbers(get_grid_response())


def test_line_outage_marks_line_failed_without_losing_load() -> None:
    response = get_grid_response(outage_type="line", outage_id="line-101")

    outaged_line = next(line for line in response["lines"] if line["id"] == "line-101")
    assert outaged_line["status"] == "failed"
    assert outaged_line["loading_percent"] is None
    assert outaged_line["capacity_mw"] is None
    assert response["metrics"]["served_load_mw"] == pytest.approx(400.0)
    assert response["metrics"]["unserved_load_mw"] == pytest.approx(0.0)
    assert_no_nonfinite_numbers(response)


def test_bus_outage_marks_connected_components_failed_and_tracks_unserved_load() -> None:
    response = get_grid_response(outage_type="bus", outage_id="bus-3")

    nodes_by_id = {node["id"]: node for node in response["nodes"]}
    assert nodes_by_id["bus-3"]["status"] == "failed"
    assert nodes_by_id["load-east"]["status"] == "failed"
    assert response["metrics"]["total_demand_mw"] == pytest.approx(400.0)
    assert response["metrics"]["served_load_mw"] == pytest.approx(290.0)
    assert response["metrics"]["unserved_load_mw"] == pytest.approx(110.0)
    assert_no_nonfinite_numbers(response)


def test_islanded_load_is_not_reported_as_healthy() -> None:
    net = create_test_grid()
    for line_id in ("line-401", "line-402", "line-403"):
        apply_component_outage(net, "line", line_id)

    run_power_flow(net)
    response = serialize_grid_state(net)
    nodes_by_id = {node["id"]: node for node in response["nodes"]}

    assert nodes_by_id["bus-6"]["status"] == "failed"
    assert nodes_by_id["load-west"]["status"] == "failed"
    assert response["metrics"]["total_demand_mw"] == pytest.approx(400.0)
    assert response["metrics"]["served_load_mw"] == pytest.approx(320.0)
    assert response["metrics"]["unserved_load_mw"] == pytest.approx(80.0)
    assert_no_nonfinite_numbers(response)


def test_invalid_component_id_raises_clear_error() -> None:
    with pytest.raises(GridComponentNotFoundError, match="Unknown line"):
        apply_component_outage(create_test_grid(), "line", "line-does-not-exist")


def test_get_api_grid_response() -> None:
    client = TestClient(app)

    response = client.get("/api/grid")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["nodes"]) == 15
    assert len(payload["lines"]) == 12
    assert payload["metrics"]["total_demand_mw"] == pytest.approx(400.0)
    assert payload["metrics"]["served_load_mw"] == pytest.approx(400.0)


def test_get_api_grid_ignores_previous_failure_and_returns_baseline() -> None:
    client = TestClient(app)

    failure_response = client.post(
        "/api/failure",
        json={"component_type": "line", "component_id": "line-101"},
    )
    grid_response = client.get("/api/grid")

    assert failure_response.status_code == 200
    assert grid_response.status_code == 200
    payload = grid_response.json()
    assert {node["status"] for node in payload["nodes"]} == {"healthy"}
    assert {line["status"] for line in payload["lines"]} == {"healthy"}


def test_post_api_failure_applies_component_failure() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/failure",
        json={"component_type": "line", "component_id": "line-101"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "solved"
    assert payload["termination_reason"] == "solved"
    line = next(line for line in payload["grid"]["lines"] if line["id"] == "line-101")
    assert line["status"] == "failed"
    assert line["loading_percent"] is None


def test_post_api_failure_requests_are_independent() -> None:
    client = TestClient(app)

    first_response = client.post(
        "/api/failure",
        json={"component_type": "line", "component_id": "line-101"},
    )
    second_response = client.post(
        "/api/failure",
        json={"component_type": "line", "component_id": "line-102"},
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    lines = {line["id"]: line for line in second_response.json()["grid"]["lines"]}
    assert lines["line-101"]["status"] == "healthy"
    assert lines["line-102"]["status"] == "failed"


def test_post_api_failure_is_idempotent_for_same_component() -> None:
    client = TestClient(app)

    first_response = client.post(
        "/api/failure",
        json={"component_type": "line", "component_id": "line-101"},
    )
    second_response = client.post(
        "/api/failure",
        json={"component_type": "line", "component_id": "line-101"},
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert first_response.json() == second_response.json()


def test_post_api_reset_restores_baseline_grid() -> None:
    client = TestClient(app)

    client.post("/api/failure", json={"component_type": "bus", "component_id": "bus-3"})
    response = client.post("/api/reset")

    assert response.status_code == 200
    payload = response.json()
    assert {node["status"] for node in payload["nodes"]} == {"healthy"}
    assert {line["status"] for line in payload["lines"]} == {"healthy"}
    assert payload["metrics"]["served_load_mw"] == pytest.approx(400.0)
    assert payload["metrics"]["unserved_load_mw"] == pytest.approx(0.0)


def test_post_api_failure_rejects_invalid_component_without_changing_scenario() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/failure",
        json={"component_type": "line", "component_id": "bad-id"},
    )
    grid_response = client.get("/api/grid")

    assert response.status_code == 404
    assert response.json()["detail"] == "Unknown line: bad-id"
    assert grid_response.status_code == 200
    assert grid_response.json()["metrics"]["unserved_load_mw"] == pytest.approx(0.0)


def test_post_api_failure_validates_request_shape() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/failure",
        json={"component_type": "line", "component_id": ""},
    )

    assert response.status_code == 422


def test_simulate_failure_is_stateless_for_repeated_failures() -> None:
    first = simulate_failure(ComponentFailure("line", "line-101"))
    second = simulate_failure(ComponentFailure("line", "line-102"))

    first_lines = {line["id"]: line for line in first["grid"]["lines"]}
    second_lines = {line["id"]: line for line in second["grid"]["lines"]}
    assert first_lines["line-101"]["status"] == "failed"
    assert first_lines["line-102"]["status"] == "healthy"
    assert second_lines["line-101"]["status"] == "healthy"
    assert second_lines["line-102"]["status"] == "failed"


def test_stateless_failure_rejects_invalid_component_without_state() -> None:
    with pytest.raises(GridComponentNotFoundError):
        simulate_failure(ComponentFailure("line", "bad-id"))

    response = get_baseline_grid()
    assert response["metrics"]["unserved_load_mw"] == pytest.approx(0.0)


def test_get_api_grid_handles_convergence_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_convergence_error() -> None:
        raise GridConvergenceError("Power flow did not converge")

    monkeypatch.setattr(main, "get_baseline_grid", raise_convergence_error)
    client = TestClient(app)

    response = client.get("/api/grid")

    assert response.status_code == 503
    assert response.json() == {"detail": "Power flow did not converge"}


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
