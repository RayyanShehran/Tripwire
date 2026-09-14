from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from math import isfinite, sqrt
from typing import Any, Literal, TypedDict

import pandapower as pp
from pandapower.auxiliary import LoadflowNotConverged

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
    total_demand_mw: float
    served_load_mw: float
    unserved_load_mw: float
    total_generation_mw: float
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
    net = pp.create_empty_network(name="Tripwire teaching transmission grid")

    bus_specs = [
        ("north", "North 230 kV Bus"),
        ("central-a", "Central A 230 kV Bus"),
        ("central-b", "Central B 230 kV Bus"),
        ("east", "East 230 kV Bus"),
        ("south", "South 230 kV Bus"),
        ("metro", "Metro 230 kV Bus"),
        ("west", "West 230 kV Bus"),
        ("harbor", "Harbor 230 kV Bus"),
    ]
    buses: dict[str, NamedIndex] = {}
    for key, name in bus_specs:
        bus_index = pp.create_bus(net, vn_kv=230.0, name=name)
        tripwire_id = _bus_id(bus_index)
        net.bus.loc[bus_index, "tripwire_id"] = tripwire_id
        net.bus.loc[bus_index, "tripwire_key"] = key
        buses[key] = NamedIndex(tripwire_id, name, bus_index)

    ext_grid_id = pp.create_ext_grid(
        net,
        bus=buses["north"].index,
        vm_pu=1.01,
        name="North Ridge Slack Generator",
    )
    net.ext_grid.loc[ext_grid_id, "tripwire_id"] = "gen-north"

    generators = {
        "gen-south": pp.create_gen(
            net,
            bus=buses["south"].index,
            p_mw=150.0,
            vm_pu=1.01,
            name="South Thermal Generator",
        ),
        "gen-harbor": pp.create_gen(
            net,
            bus=buses["harbor"].index,
            p_mw=95.0,
            vm_pu=1.0,
            name="Harbor Gas Generator",
        ),
    }
    for key, index in generators.items():
        net.gen.loc[index, "tripwire_id"] = key

    loads = {
        "load-east": pp.create_load(
            net,
            bus=buses["east"].index,
            p_mw=110.0,
            q_mvar=22.0,
            name="East Industrial Load",
        ),
        "load-metro": pp.create_load(
            net,
            bus=buses["metro"].index,
            p_mw=145.0,
            q_mvar=31.0,
            name="Metro Load",
        ),
        "load-west": pp.create_load(
            net,
            bus=buses["west"].index,
            p_mw=80.0,
            q_mvar=16.0,
            name="West Residential Load",
        ),
        "load-harbor": pp.create_load(
            net,
            bus=buses["harbor"].index,
            p_mw=65.0,
            q_mvar=13.0,
            name="Harbor Load",
        ),
    }
    for key, index in loads.items():
        net.load.loc[index, "tripwire_id"] = key

    line_specs = [
        ("line-101", "L-101 North-Central A", "north", "central-a", 34.0, 1.8),
        ("line-102", "L-102 Central A-Central B", "central-a", "central-b", 28.0, 1.65),
        ("line-103", "L-103 Central B-East", "central-b", "east", 24.0, 1.45),
        ("line-104", "L-104 North-South", "north", "south", 42.0, 1.6),
        ("line-201", "L-201 South-Central A", "south", "central-a", 26.0, 1.5),
        ("line-202", "L-202 South-Metro", "south", "metro", 22.0, 1.45),
        ("line-203", "L-203 Metro-East", "metro", "east", 18.0, 1.25),
        ("line-301", "Tie-301 Central B-Harbor", "central-b", "harbor", 30.0, 1.35),
        ("line-302", "Tie-302 Harbor-Metro", "harbor", "metro", 20.0, 1.25),
        ("line-401", "L-401 Central A-West", "central-a", "west", 31.0, 1.2),
        ("line-402", "L-402 West-Metro", "west", "metro", 24.0, 1.15),
        ("line-403", "L-403 West-North", "west", "north", 36.0, 1.1),
    ]

    for key, name, from_bus, to_bus, length_km, max_i_ka in line_specs:
        line_index = pp.create_line_from_parameters(
            net,
            from_bus=buses[from_bus].index,
            to_bus=buses[to_bus].index,
            length_km=length_km,
            r_ohm_per_km=0.04,
            x_ohm_per_km=0.28,
            c_nf_per_km=11.0,
            max_i_ka=max_i_ka,
            name=name,
        )
        net.line.loc[line_index, "tripwire_id"] = key

    return net


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
        "metrics": calculate_grid_metrics(net, supplied_buses, lines),
    }


def serialize_grid(net: pp.pandapowerNet) -> GridResponse:
    return serialize_grid_state(net)


def calculate_grid_metrics(
    net: pp.pandapowerNet,
    supplied_buses: set[int] | None = None,
    lines: list[GridLineResponse] | None = None,
) -> GridMetricsResponse:
    if supplied_buses is None:
        supplied_buses = find_supplied_buses(net)
    if lines is None:
        lines = _line_responses(net)

    total_demand = float(net.load["p_mw"].sum()) if not net.load.empty else 0.0
    served_load = _served_load_mw(net, supplied_buses)
    total_generation = _total_generation_mw(net, supplied_buses)
    finite_line_loadings = [
        line["loading_percent"]
        for line in lines
        if line["loading_percent"] is not None
    ]
    max_loading = max(finite_line_loadings, default=0.0)

    return {
        "total_demand_mw": round(total_demand, 2),
        "served_load_mw": round(served_load, 2),
        "unserved_load_mw": round(max(total_demand - served_load, 0.0), 2),
        "total_generation_mw": round(total_generation, 2),
        "max_line_loading_percent": round(max_loading, 2),
    }


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
                "id": _bus_id(bus_index_int),
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
                "connected_bus_id": _bus_id(bus_index),
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
                "connected_bus_id": _bus_id(bus_index),
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
                "connected_bus_id": _bus_id(bus_index),
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
                "source": _bus_id(int(line["from_bus"])),
                "target": _bus_id(int(line["to_bus"])),
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
