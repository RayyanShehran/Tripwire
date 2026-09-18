from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from math import isfinite, sqrt
from typing import Any, Literal, TypedDict

import pandapower as pp
from pandapower.auxiliary import LoadflowNotConverged

from app.simulation.definition import BUILTIN_GRID_DEFINITION, build_network_from_definition

GridStatus = Literal["healthy", "stressed", "overloaded", "failed"]
GridNodeType = Literal["generator", "bus", "load"]
GridComponentType = Literal["bus", "line", "generator", "load"]

HEALTHY_LOADING_LIMIT = 80.0
OVERLOADED_LOADING_LIMIT = 100.0
LOW_VOLTAGE_LIMIT = 0.95
HIGH_VOLTAGE_LIMIT = 1.05


class GridNodeResponse(TypedDict):
    id: str
    name: str
    type: GridNodeType
    status: GridStatus
    voltage: float | None
    generation_mw: float | None
    load_mw: float | None
    connected_bus_id: str | None


class GridLineResponse(TypedDict):
    id: str
    name: str
    source: str
    target: str
    capacity_mw: float | None
    loading_percent: float | None
    status: GridStatus


class GridMetricsResponse(TypedDict):
    original_demand_mw: float
    total_demand_mw: float
    served_load_mw: float
    controlled_shed_mw: float
    involuntary_unserved_mw: float
    total_unserved_mw: float
    unserved_load_mw: float
    load_lost_percent: float
    total_generation_mw: float
    failed_components: int
    failed_lines: int
    max_line_loading_percent: float


class GridResponse(TypedDict):
    nodes: list[GridNodeResponse]
    lines: list[GridLineResponse]
    metrics: GridMetricsResponse


class GridConvergenceError(RuntimeError):
    pass


class GridComponentNotFoundError(ValueError):
    pass


@dataclass(frozen=True)
class NamedIndex:
    key: str
    name: str
    index: int


def create_test_grid() -> pp.pandapowerNet:
    """Create Tripwire's small solved transmission network."""
    return build_network_from_definition(BUILTIN_GRID_DEFINITION)


def get_grid_response(
    outage_type: GridComponentType | None = None,
    outage_id: str | None = None,
) -> GridResponse:
    net = create_test_grid()

    if outage_type is not None or outage_id is not None:
        if outage_type is None or outage_id is None:
            raise GridComponentNotFoundError("Both outage_type and outage_id are required")
        apply_component_outage(net, outage_type, outage_id)

    run_power_flow(net)
    return serialize_grid_state(net)


def apply_component_outage(
    net: pp.pandapowerNet,
    component_type: GridComponentType,
    component_id: str,
) -> None:
    if component_type == "bus":
        bus_index = _find_component_index(net.bus, component_id, "bus")
        net.bus.loc[bus_index, "in_service"] = False
        connected_lines = (net.line.from_bus == bus_index) | (net.line.to_bus == bus_index)
        net.line.loc[connected_lines, "in_service"] = False
        net.load.loc[net.load.bus == bus_index, "in_service"] = False
        net.gen.loc[net.gen.bus == bus_index, "in_service"] = False
        net.ext_grid.loc[net.ext_grid.bus == bus_index, "in_service"] = False
        return

    if component_type == "line":
        line_index = _find_component_index(net.line, component_id, "line")
        net.line.loc[line_index, "in_service"] = False
        return

    if component_type == "load":
        load_index = _find_component_index(net.load, component_id, "load")
        net.load.loc[load_index, "in_service"] = False
        return

    if component_type == "generator":
        table_name, generator_index = _find_generator_location(net, component_id)
        getattr(net, table_name).loc[generator_index, "in_service"] = False
        return

    raise GridComponentNotFoundError(f"Unknown component type: {component_type}")


def reset_component_outages(net: pp.pandapowerNet) -> None:
    for table_name in ("bus", "line", "load", "gen", "ext_grid"):
        table = getattr(net, table_name)
        if "in_service" in table:
            table.loc[:, "in_service"] = True


def run_power_flow(net: pp.pandapowerNet) -> pp.pandapowerNet:
    if net.ext_grid.empty or not bool(net.ext_grid.in_service.any()):
        raise GridConvergenceError("Power flow requires at least one in-service grid source")

    try:
        pp.runpp(net, algorithm="nr", init="auto", check_connectivity=True, numba=False)
    except LoadflowNotConverged as exc:
        raise GridConvergenceError("Power flow did not converge") from exc

    if not bool(net.converged):
        raise GridConvergenceError("Power flow did not converge")

    return net


def serialize_grid_state(net: pp.pandapowerNet) -> GridResponse:
    supplied_buses = find_supplied_buses(net)
    bus_statuses = _bus_statuses(net, supplied_buses)
    nodes = _bus_nodes(net, bus_statuses)
    nodes.extend(_generator_nodes(net, bus_statuses))
    nodes.extend(_load_nodes(net, bus_statuses, supplied_buses))

    lines = _line_responses(net)

    return {
        "nodes": nodes,
        "lines": lines,
        "metrics": calculate_grid_metrics(net, supplied_buses, lines, nodes),
    }


def serialize_grid(net: pp.pandapowerNet) -> GridResponse:
    return serialize_grid_state(net)


def calculate_grid_metrics(
    net: pp.pandapowerNet,
    supplied_buses: set[int] | None = None,
    lines: list[GridLineResponse] | None = None,
    nodes: list[GridNodeResponse] | None = None,
) -> GridMetricsResponse:
    if supplied_buses is None:
        supplied_buses = find_supplied_buses(net)
    if lines is None:
        lines = _line_responses(net)

    current_demand = float(net.load["p_mw"].sum()) if not net.load.empty else 0.0
    original_demand = float(net.get("tripwire_original_demand_mw", current_demand))
    controlled_shed = float(net.get("tripwire_controlled_shed_mw", 0.0))
    served_load = _served_load_mw(net, supplied_buses)
    total_generation = _total_generation_mw(net, supplied_buses)
    finite_line_loadings = [
        line["loading_percent"]
        for line in lines
        if line["loading_percent"] is not None
    ]
    max_loading = max(finite_line_loadings, default=0.0)
    involuntary_unserved = max(current_demand - served_load, 0.0)
    total_unserved = controlled_shed + involuntary_unserved
    load_lost_percent = (
        0.0 if original_demand == 0 else (total_unserved / original_demand) * 100
    )
    failed_lines = sum(1 for line in lines if line["status"] == "failed")
    failed_nodes = sum(1 for node in nodes or [] if node["status"] == "failed")

    metrics: GridMetricsResponse = {
        "original_demand_mw": round(original_demand, 2),
        "total_demand_mw": round(original_demand, 2),
        "served_load_mw": round(served_load, 2),
        "controlled_shed_mw": round(controlled_shed, 2),
        "involuntary_unserved_mw": round(involuntary_unserved, 2),
        "total_unserved_mw": round(total_unserved, 2),
        "unserved_load_mw": round(total_unserved, 2),
        "load_lost_percent": round(min(max(load_lost_percent, 0.0), 100.0), 2),
        "total_generation_mw": round(total_generation, 2),
        "failed_components": failed_lines + failed_nodes,
        "failed_lines": failed_lines,
        "max_line_loading_percent": round(max_loading, 2),
    }
    _validate_load_accounting(metrics)
    return metrics


def _validate_load_accounting(metrics: GridMetricsResponse) -> None:
    numeric_values = (
        metrics["original_demand_mw"],
        metrics["served_load_mw"],
        metrics["controlled_shed_mw"],
        metrics["involuntary_unserved_mw"],
        metrics["total_unserved_mw"],
        metrics["load_lost_percent"],
    )
    if not all(isfinite(value) and value >= 0 for value in numeric_values):
        raise ValueError("Grid load accounting produced an invalid value")

    accounted = (
        metrics["served_load_mw"]
        + metrics["controlled_shed_mw"]
        + metrics["involuntary_unserved_mw"]
    )
    if abs(accounted - metrics["original_demand_mw"]) > 0.05:
        raise ValueError("Grid load accounting does not balance to original demand")


def find_supplied_buses(net: pp.pandapowerNet) -> set[int]:
    in_service_buses = {
        int(bus_index)
        for bus_index, bus in net.bus.iterrows()
        if bool(bus["in_service"])
    }
    source_buses = {
        int(source["bus"])
        for _, source in net.ext_grid.iterrows()
        if bool(source["in_service"]) and int(source["bus"]) in in_service_buses
    }
    adjacency: dict[int, set[int]] = {bus_index: set() for bus_index in in_service_buses}

    for _, line in net.line.iterrows():
        if not bool(line["in_service"]):
            continue
        from_bus = int(line["from_bus"])
        to_bus = int(line["to_bus"])
        if from_bus not in in_service_buses or to_bus not in in_service_buses:
            continue
        adjacency[from_bus].add(to_bus)
        adjacency[to_bus].add(from_bus)

    supplied: set[int] = set()
    queue: deque[int] = deque(source_buses)
    while queue:
        bus_index = queue.popleft()
        if bus_index in supplied:
            continue
        supplied.add(bus_index)
        queue.extend(adjacency[bus_index] - supplied)

    return supplied


def _bus_nodes(
    net: pp.pandapowerNet,
    bus_statuses: dict[int, GridStatus],
) -> list[GridNodeResponse]:
    nodes: list[GridNodeResponse] = []
    for bus_index, bus in net.bus.iterrows():
        bus_index_int = int(bus_index)
        nodes.append(
            {
                "id": _bus_identifier(net, bus_index_int),
                "name": str(bus["name"]),
                "type": "bus",
                "status": bus_statuses[bus_index_int],
                "voltage": _result_value(net.res_bus, bus_index, "vm_pu"),
                "generation_mw": None,
                "load_mw": None,
                "connected_bus_id": None,
            }
        )

    return nodes


def _generator_nodes(
    net: pp.pandapowerNet,
    bus_statuses: dict[int, GridStatus],
) -> list[GridNodeResponse]:
    nodes: list[GridNodeResponse] = []

    for ext_index, ext_grid in net.ext_grid.iterrows():
        bus_index = int(ext_grid["bus"])
        nodes.append(
            {
                "id": str(ext_grid["tripwire_id"]),
                "name": str(ext_grid["name"]),
                "type": "generator",
                "status": _component_status(bool(ext_grid["in_service"]), bus_statuses[bus_index]),
                "voltage": _result_value(net.res_bus, bus_index, "vm_pu"),
                "generation_mw": _result_value(net.res_ext_grid, ext_index, "p_mw"),
                "load_mw": None,
                "connected_bus_id": _bus_identifier(net, bus_index),
            }
        )

    for gen_index, generator in net.gen.iterrows():
        bus_index = int(generator["bus"])
        nodes.append(
            {
                "id": str(generator["tripwire_id"]),
                "name": str(generator["name"]),
                "type": "generator",
                "status": _component_status(bool(generator["in_service"]), bus_statuses[bus_index]),
                "voltage": _result_value(net.res_bus, bus_index, "vm_pu"),
                "generation_mw": _result_value(net.res_gen, gen_index, "p_mw"),
                "load_mw": None,
                "connected_bus_id": _bus_identifier(net, bus_index),
            }
        )

    return nodes


def _load_nodes(
    net: pp.pandapowerNet,
    bus_statuses: dict[int, GridStatus],
    supplied_buses: set[int],
) -> list[GridNodeResponse]:
    nodes: list[GridNodeResponse] = []
    for _, load in net.load.iterrows():
        bus_index = int(load["bus"])
        is_served = bool(load["in_service"]) and bus_index in supplied_buses
        nodes.append(
            {
                "id": str(load["tripwire_id"]),
                "name": str(load["name"]),
                "type": "load",
                "status": _component_status(is_served, bus_statuses[bus_index]),
                "voltage": _result_value(net.res_bus, bus_index, "vm_pu"),
                "generation_mw": None,
                "load_mw": _safe_float(load["p_mw"]),
                "connected_bus_id": _bus_identifier(net, bus_index),
            }
        )

    return nodes


def _line_responses(net: pp.pandapowerNet) -> list[GridLineResponse]:
    lines: list[GridLineResponse] = []
    for line_index, line in net.line.iterrows():
        in_service = bool(line["in_service"])
        loading_percent = (
            _result_value(net.res_line, line_index, "loading_percent") if in_service else None
        )
        capacity_mw = _line_capacity_mw(net, line) if in_service else None
        lines.append(
            {
                "id": str(line["tripwire_id"]),
                "name": str(line["name"]),
                "source": _bus_identifier(net, int(line["from_bus"])),
                "target": _bus_identifier(net, int(line["to_bus"])),
                "capacity_mw": capacity_mw,
                "loading_percent": loading_percent,
                "status": _line_status(in_service, loading_percent),
            }
        )

    return lines


def _bus_statuses(net: pp.pandapowerNet, supplied_buses: set[int]) -> dict[int, GridStatus]:
    statuses: dict[int, GridStatus] = {}
    for bus_index, bus in net.bus.iterrows():
        bus_index_int = int(bus_index)
        voltage = _result_value(net.res_bus, bus_index, "vm_pu")
        if not bool(bus["in_service"]) or bus_index_int not in supplied_buses or voltage is None:
            statuses[bus_index_int] = "failed"
            continue

        connected_loadings: list[float] = []
        for line_index, line in net.line.iterrows():
            if not bool(line["in_service"]):
                continue
            if int(line["from_bus"]) == bus_index_int or int(line["to_bus"]) == bus_index_int:
                loading = _result_value(net.res_line, line_index, "loading_percent")
                if loading is not None:
                    connected_loadings.append(loading)

        statuses[bus_index_int] = _node_status(voltage, max(connected_loadings, default=0.0))

    return statuses


def _node_status(voltage_pu: float, max_connected_loading: float) -> GridStatus:
    if max_connected_loading > OVERLOADED_LOADING_LIMIT:
        return "overloaded"
    if (
        max_connected_loading >= HEALTHY_LOADING_LIMIT
        or voltage_pu < LOW_VOLTAGE_LIMIT
        or voltage_pu > HIGH_VOLTAGE_LIMIT
    ):
        return "stressed"
    return "healthy"


def _line_status(in_service: bool, loading_percent: float | None) -> GridStatus:
    if not in_service or loading_percent is None:
        return "failed"
    if loading_percent > OVERLOADED_LOADING_LIMIT:
        return "overloaded"
    if loading_percent >= HEALTHY_LOADING_LIMIT:
        return "stressed"
    return "healthy"


def _component_status(in_service: bool, connected_bus_status: GridStatus) -> GridStatus:
    if not in_service or connected_bus_status == "failed":
        return "failed"
    return connected_bus_status


def _served_load_mw(net: pp.pandapowerNet, supplied_buses: set[int]) -> float:
    total = 0.0
    for _, load in net.load.iterrows():
        if bool(load["in_service"]) and int(load["bus"]) in supplied_buses:
            total += float(load["p_mw"])
    return total


def _total_generation_mw(net: pp.pandapowerNet, supplied_buses: set[int]) -> float:
    total = 0.0
    for ext_index, source in net.ext_grid.iterrows():
        if bool(source["in_service"]) and int(source["bus"]) in supplied_buses:
            total += _result_value(net.res_ext_grid, ext_index, "p_mw") or 0.0
    for gen_index, generator in net.gen.iterrows():
        if bool(generator["in_service"]) and int(generator["bus"]) in supplied_buses:
            total += _result_value(net.res_gen, gen_index, "p_mw") or 0.0
    return total


def _find_component_index(table: Any, component_id: str, component_type: str) -> int:
    if "tripwire_id" not in table:
        raise GridComponentNotFoundError(f"Unknown {component_type}: {component_id}")

    matches = table.index[table["tripwire_id"] == component_id].tolist()
    if not matches:
        raise GridComponentNotFoundError(f"Unknown {component_type}: {component_id}")

    return int(matches[0])


def _find_generator_location(net: pp.pandapowerNet, component_id: str) -> tuple[str, int]:
    for table_name in ("ext_grid", "gen"):
        table = getattr(net, table_name)
        if "tripwire_id" not in table:
            continue
        matches = table.index[table["tripwire_id"] == component_id].tolist()
        if matches:
            return table_name, int(matches[0])

    raise GridComponentNotFoundError(f"Unknown generator: {component_id}")


def _line_capacity_mw(net: pp.pandapowerNet, line: Any) -> float | None:
    from_bus = int(line["from_bus"])
    raw_capacity = sqrt(3) * float(net.bus.at[from_bus, "vn_kv"]) * float(line["max_i_ka"])
    return _safe_float(raw_capacity)


def _result_value(table: Any, index: Any, column: str) -> float | None:
    if table.empty or index not in table.index or column not in table:
        return None
    return _safe_float(table.at[index, column])


def _safe_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    if not isfinite(number):
        return None
    return round(number, 4)


def _bus_id(bus_index: int) -> str:
    return f"bus-{bus_index}"


def _bus_identifier(net: pp.pandapowerNet, bus_index: int) -> str:
    if "tripwire_id" in net.bus and bus_index in net.bus.index:
        return str(net.bus.at[bus_index, "tripwire_id"])
    return _bus_id(bus_index)
