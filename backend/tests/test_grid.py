import pytest
from fastapi.testclient import TestClient

from app import main
from app.main import app
from app.simulation.grid import GridConvergenceError
from app.simulation.grid import create_test_grid, get_grid_response, run_power_flow


def test_create_test_grid_contains_expected_components() -> None:
    net = create_test_grid()

    assert len(net.bus) == 8
    assert len(net.ext_grid) + len(net.gen) == 3
    assert len(net.load) == 4
    assert len(net.line) == 10


def test_run_power_flow_converges() -> None:
    net = run_power_flow(create_test_grid())

    assert net.converged is True
    assert not net.res_line.empty
    assert net.res_line["loading_percent"].max() > 0


def test_grid_response_contains_expected_fields() -> None:
    response = get_grid_response()

    assert set(response) == {"nodes", "lines", "metrics"}
    assert len(response["nodes"]) == 15
    assert len(response["lines"]) == 10
    assert response["metrics"]["total_generation_mw"] > 0
    assert response["metrics"]["total_load_mw"] == pytest.approx(650.0)
    assert response["metrics"]["max_line_loading_percent"] > 0

    first_node = response["nodes"][0]
    assert {
        "id",
        "name",
        "type",
        "status",
        "voltage",
    }.issubset(first_node)

    first_line = response["lines"][0]
    assert {
        "id",
        "source",
        "target",
        "capacity_mw",
        "loading_percent",
        "status",
    }.issubset(first_line)


def test_get_api_grid_response() -> None:
    client = TestClient(app)

    response = client.get("/api/grid")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["nodes"]) == 15
    assert len(payload["lines"]) == 10
    assert payload["metrics"]["total_load_mw"] == pytest.approx(650.0)


def test_get_api_grid_handles_convergence_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_convergence_error() -> None:
        raise GridConvergenceError("Power flow did not converge")

    monkeypatch.setattr(main, "get_grid_response", raise_convergence_error)
    client = TestClient(app)

    response = client.get("/api/grid")

    assert response.status_code == 503
    assert response.json() == {"detail": "Power flow did not converge"}
