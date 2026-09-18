from copy import deepcopy

from app.simulation.definition import (
    BUILTIN_GRID_DEFINITION,
    GridDefinition,
    build_network_from_definition,
    validate_grid_definition,
)
from app.simulation.grid import run_power_flow, serialize_grid_state
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def definition_copy(**updates) -> GridDefinition:
    payload = deepcopy(BUILTIN_GRID_DEFINITION.model_dump())
    payload.update(updates)
    return GridDefinition.model_validate(payload)


def test_builtin_grid_is_built_from_serializable_definition() -> None:
    payload = BUILTIN_GRID_DEFINITION.model_dump(mode="json")
    restored = GridDefinition.model_validate(payload)
    net = build_network_from_definition(restored)

    assert net["tripwire_definition_id"] == restored.id
    assert set(net.bus["tripwire_id"]) == {bus.id for bus in restored.buses}
    assert set(net.line["tripwire_id"]) == {line.id for line in restored.lines}


def test_custom_component_ids_survive_solve_and_serialization() -> None:
    definition = GridDefinition.model_validate({
        "id": "small-grid", "name": "Small Grid", "version": 1,
        "buses": [
            {"id": "source-bus", "name": "Source", "voltage_kv": 110},
            {"id": "load-bus", "name": "Load", "voltage_kv": 110},
        ],
        "generators": [{
            "id": "source-gen", "name": "Source", "bus_id": "source-bus",
            "min_mw": 0, "max_mw": 200, "setpoint_mw": 80, "is_slack": True,
        }],
        "loads": [{"id": "custom-load", "name": "Demand", "bus_id": "load-bus", "demand_mw": 60}],
        "lines": [{
            "id": "custom-line", "name": "Intertie", "source_bus_id": "source-bus",
            "target_bus_id": "load-bus", "length_km": 10, "capacity_mw": 150,
        }],
    })
    net = build_network_from_definition(definition)
    run_power_flow(net)
    grid = serialize_grid_state(net)

    assert {node["id"] for node in grid["nodes"]} >= {"source-bus", "load-bus", "source-gen", "custom-load"}
    assert grid["lines"][0]["id"] == "custom-line"
    assert grid["metrics"]["served_load_mw"] == 60


def test_builtin_definition_is_valid_and_solves() -> None:
    validation = validate_grid_definition(BUILTIN_GRID_DEFINITION)
    assert validation.valid
    assert not validation.errors
    net = build_network_from_definition(BUILTIN_GRID_DEFINITION)
    run_power_flow(net)
    assert net.converged


def test_validation_reports_duplicate_ids_and_bad_references() -> None:
    payload = deepcopy(BUILTIN_GRID_DEFINITION.model_dump())
    payload["loads"][0]["id"] = payload["buses"][0]["id"]
    payload["loads"][0]["bus_id"] = "missing-bus"
    result = validate_grid_definition(GridDefinition.model_validate(payload))

    assert not result.valid
    assert {issue.code for issue in result.errors} >= {"duplicate_id", "missing_bus_reference"}


def test_validation_reports_invalid_line_and_generator() -> None:
    payload = deepcopy(BUILTIN_GRID_DEFINITION.model_dump())
    payload["lines"][0]["target_bus_id"] = payload["lines"][0]["source_bus_id"]
    payload["lines"][0]["capacity_mw"] = -1
    payload["generators"][1]["setpoint_mw"] = payload["generators"][1]["max_mw"] + 1
    result = validate_grid_definition(GridDefinition.model_validate(payload))

    assert not result.valid
    assert {issue.code for issue in result.errors} >= {"self_loop", "not_positive", "invalid_generator_limits"}


def test_islanded_grid_is_valid_with_warning() -> None:
    payload = deepcopy(BUILTIN_GRID_DEFINITION.model_dump())
    payload["lines"] = [line for line in payload["lines"] if "bus-3" not in (line["source_bus_id"], line["target_bus_id"])]
    result = validate_grid_definition(GridDefinition.model_validate(payload))

    assert result.valid
    assert result.island_count == 2
    assert any(issue.code == "unsupplied_island" for issue in result.warnings)


def test_grid_validation_and_solve_api() -> None:
    definition = BUILTIN_GRID_DEFINITION.model_dump(mode="json")
    validation = client.post("/api/grid/validate", json={"grid_definition": definition})
    solve = client.post("/api/grid/solve", json={"grid_definition": definition})

    assert validation.status_code == 200
    assert validation.json()["valid"] is True
    assert solve.status_code == 200
    assert solve.json()["grid"]["metrics"]["served_load_mw"] == 400
    assert solve.json()["ml_compatible"] is True


def test_solve_api_rejects_invalid_definition_with_structured_errors() -> None:
    definition = deepcopy(BUILTIN_GRID_DEFINITION.model_dump(mode="json"))
    definition["loads"][0]["bus_id"] = "missing"
    response = client.post("/api/grid/solve", json={"grid_definition": definition})

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["valid"] is False
    assert detail["errors"][0]["component_id"] == "load-east"
