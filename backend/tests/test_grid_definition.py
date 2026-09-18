from copy import deepcopy

from app.simulation.definition import (
    BUILTIN_GRID_DEFINITION,
    GridDefinition,
    build_network_from_definition,
    validate_grid_definition,
)
from app.simulation.grid import run_power_flow, serialize_grid_state


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
