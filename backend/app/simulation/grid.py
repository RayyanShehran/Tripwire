from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
from typing import Any, Literal, TypedDict

import pandapower as pp
from pandapower.auxiliary import LoadflowNotConverged

GridStatus = Literal["healthy", "stressed", "overloaded", "failed"]
GridNodeType = Literal["generator", "bus", "load"]

HEALTHY_LOADING_LIMIT = 80.0
OVERLOADED_LOADING_LIMIT = 100.0


class GridNodeResponse(TypedDict, total=False):
    id: str
    name: str
    type: GridNodeType
    status: GridStatus
    voltage: float
    generation_mw: float
    load_mw: float
    connected_bus_id: str


class GridLineResponse(TypedDict):
    id: str
    name: str
    source: str
    target: str
    capacity_mw: float
    loading_percent: float
    status: GridStatus


class GridMetricsResponse(TypedDict):
    total_generation_mw: float
    total_load_mw: float
    max_line_loading_percent: float


class GridResponse(TypedDict):
    nodes: list[GridNodeResponse]
    lines: list[GridLineResponse]
    metrics: GridMetricsResponse


class GridConvergenceError(RuntimeError):
    pass


@dataclass(frozen=True)
class NamedIndex:
    key: str
    name: str
    index: int


def create_test_grid() -> pp.pandapowerNet:
    """Create a small transmission network for Tripwire's first real data layer."""
    net = pp.create_empty_network(name="Tripwire IEEE-style teaching grid")

    buses = {
        "bus-north": NamedIndex(
            "bus-north",
            "North 230 kV Bus",
            pp.create_bus(net, vn_kv=230.0, name="North 230 kV Bus"),
        ),
        "bus-central-a": NamedIndex(
            "bus-central-a",
            "Central A 230 kV Bus",
            pp.create_bus(net, vn_kv=230.0, name="Central A 230 kV Bus"),
        ),
        "bus-central-b": NamedIndex(
            "bus-central-b",
            "Central B 230 kV Bus",
            pp.create_bus(net, vn_kv=230.0, name="Central B 230 kV Bus"),
        ),
        "bus-east": NamedIndex(
            "bus-east",
            "East 138 kV Bus",
            pp.create_bus(net, vn_kv=138.0, name="East 138 kV Bus"),
        ),
        "bus-south": NamedIndex(
            "bus-south",
            "South 230 kV Bus",
            pp.create_bus(net, vn_kv=230.0, name="South 230 kV Bus"),
        ),
        "bus-metro": NamedIndex(
            "bus-metro",
            "Metro 138 kV Bus",
            pp.create_bus(net, vn_kv=138.0, name="Metro 138 kV Bus"),
        ),
        "bus-west": NamedIndex(
            "bus-west",
            "West 69 kV Bus",
            pp.create_bus(net, vn_kv=69.0, name="West 69 kV Bus"),
        ),
        "bus-harbor": NamedIndex(
            "bus-harbor",
            "Harbor 138 kV Bus",
            pp.create_bus(net, vn_kv=138.0, name="Harbor 138 kV Bus"),
        ),
    }

    ext_grid_id = pp.create_ext_grid(
        net,
        bus=buses["bus-north"].index,
        vm_pu=1.02,
        name="North Ridge Slack Generator",
    )
    net.ext_grid.loc[ext_grid_id, "tripwire_id"] = "gen-north"

    generators = {
        "gen-south": pp.create_gen(
            net,
            bus=buses["bus-south"].index,
            p_mw=260.0,
            vm_pu=1.01,
            name="South Thermal Generator",
        ),
        "gen-harbor": pp.create_gen(
            net,
            bus=buses["bus-harbor"].index,
            p_mw=145.0,
            vm_pu=1.0,
            name="Harbor Gas Generator",
        ),
    }
    for key, index in generators.items():
        net.gen.loc[index, "tripwire_id"] = key

    loads = {
        "load-east": pp.create_load(
            net,
            bus=buses["bus-east"].index,
            p_mw=185.0,
            q_mvar=38.0,
            name="East Industrial Load",
        ),
        "load-metro": pp.create_load(
            net,
            bus=buses["bus-metro"].index,
            p_mw=245.0,
            q_mvar=52.0,
            name="Metro Load",
        ),
        "load-west": pp.create_load(
            net,
            bus=buses["bus-west"].index,
            p_mw=125.0,
            q_mvar=24.0,
            name="West Residential Load",
        ),
        "load-harbor": pp.create_load(
            net,
            bus=buses["bus-harbor"].index,
            p_mw=95.0,
            q_mvar=19.0,
            name="Harbor Load",
        ),
    }
    for key, index in loads.items():
        net.load.loc[index, "tripwire_id"] = key

    line_specs = [
        ("line-101", "L-101 North-Central A", "bus-north", "bus-central-a", 27.0, 1.15),
        ("line-102", "L-102 Central A-Central B", "bus-central-a", "bus-central-b", 21.0, 1.0),
        ("line-103", "L-103 Central B-East", "bus-central-b", "bus-east", 19.0, 0.7),
        ("line-201", "L-201 South-Central A", "bus-south", "bus-central-a", 24.0, 0.9),
        ("line-202", "L-202 South-Metro", "bus-south", "bus-metro", 18.0, 0.72),
        ("line-203", "L-203 Metro-East", "bus-metro", "bus-east", 16.0, 0.62),
        ("line-301", "Tie-301 Central B-Harbor", "bus-central-b", "bus-harbor", 23.0, 0.66),
        ("line-302", "Tie-302 Harbor-Metro", "bus-harbor", "bus-metro", 14.0, 0.58),
        ("line-401", "L-401 Central A-West", "bus-central-a", "bus-west", 26.0, 0.5),
        ("line-402", "L-402 West-Metro", "bus-west", "bus-metro", 20.0, 0.48),
    ]

    for key, name, from_bus, to_bus, length_km, max_i_ka in line_specs:
        line_index = pp.create_line_from_parameters(
            net,
            from_bus=buses[from_bus].index,
            to_bus=buses[to_bus].index,
            length_km=length_km,
            r_ohm_per_km=0.045,
            x_ohm_per_km=0.32,
            c_nf_per_km=11.0,
            max_i_ka=max_i_ka,
            name=name,
        )
        net.line.loc[line_index, "tripwire_id"] = key

    return net


def run_power_flow(net: pp.pandapowerNet) -> pp.pandapowerNet:
    try:
        pp.runpp(net, algorithm="nr", init="auto", numba=False)
    except LoadflowNotConverged as exc:
        raise GridConvergenceError("Power flow did not converge") from exc

    if not bool(net.converged):
        raise GridConvergenceError("Power flow did not converge")

    return net


def get_grid_response() -> GridResponse:
    net = run_power_flow(create_test_grid())
    return serialize_grid(net)


def serialize_grid(net: pp.pandapowerNet) -> GridResponse:
    bus_statuses = _bus_statuses(net)
    nodes = _bus_nodes(net, bus_statuses)
    nodes.extend(_generator_nodes(net, bus_statuses))
    nodes.extend(_load_nodes(net, bus_statuses))

    lines = _line_responses(net)

    total_generation = float(net.res_ext_grid.p_mw.sum() + net.res_gen.p_mw.sum())
    total_load = float(net.load.loc[net.load.in_service, "p_mw"].sum())
    max_loading = max((line["loading_percent"] for line in lines), default=0.0)

    return {
        "nodes": nodes,
        "lines": lines,
        "metrics": {
            "total_generation_mw": round(total_generation, 2),
            "total_load_mw": round(total_load, 2),
            "max_line_loading_percent": round(max_loading, 2),
        },
    }


def _bus_nodes(
    net: pp.pandapowerNet,
    bus_statuses: dict[int, GridStatus],
) -> list[GridNodeResponse]:
    nodes: list[GridNodeResponse] = []
    for bus_index, bus in net.bus.iterrows():
        nodes.append(
            {
                "id": _bus_id(bus_index),
                "name": str(bus["name"]),
                "type": "bus",
                "status": bus_statuses[int(bus_index)],
                "voltage": round(float(net.res_bus.at[bus_index, "vm_pu"]), 4),
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
        generation_mw = float(net.res_ext_grid.at[ext_index, "p_mw"])
        nodes.append(
            {
                "id": str(ext_grid["tripwire_id"]),
                "name": str(ext_grid["name"]),
                "type": "generator",
                "status": _component_status(bool(ext_grid["in_service"]), bus_statuses[bus_index]),
                "voltage": round(float(net.res_bus.at[bus_index, "vm_pu"]), 4),
                "generation_mw": round(generation_mw, 2),
                "connected_bus_id": _bus_id(bus_index),
            }
        )

    for gen_index, generator in net.gen.iterrows():
        bus_index = int(generator["bus"])
        generation_mw = float(net.res_gen.at[gen_index, "p_mw"])
        nodes.append(
            {
                "id": str(generator["tripwire_id"]),
                "name": str(generator["name"]),
                "type": "generator",
                "status": _component_status(bool(generator["in_service"]), bus_statuses[bus_index]),
                "voltage": round(float(net.res_bus.at[bus_index, "vm_pu"]), 4),
                "generation_mw": round(generation_mw, 2),
                "connected_bus_id": _bus_id(bus_index),
            }
        )

    return nodes


def _load_nodes(
    net: pp.pandapowerNet,
    bus_statuses: dict[int, GridStatus],
) -> list[GridNodeResponse]:
    nodes: list[GridNodeResponse] = []
    for load_index, load in net.load.iterrows():
        bus_index = int(load["bus"])
        nodes.append(
            {
                "id": str(load["tripwire_id"]),
                "name": str(load["name"]),
                "type": "load",
                "status": _component_status(bool(load["in_service"]), bus_statuses[bus_index]),
                "voltage": round(float(net.res_bus.at[bus_index, "vm_pu"]), 4),
                "load_mw": round(float(load["p_mw"]), 2),
                "connected_bus_id": _bus_id(bus_index),
            }
        )

    return nodes


def _line_responses(net: pp.pandapowerNet) -> list[GridLineResponse]:
    lines: list[GridLineResponse] = []
    for line_index, line in net.line.iterrows():
        in_service = bool(line["in_service"])
        loading_percent = (
            float(net.res_line.at[line_index, "loading_percent"]) if in_service else 0.0
        )
        capacity_mw = _line_capacity_mw(net, line)
        lines.append(
            {
                "id": str(line["tripwire_id"]),
                "name": str(line["name"]),
                "source": _bus_id(int(line["from_bus"])),
                "target": _bus_id(int(line["to_bus"])),
                "capacity_mw": round(capacity_mw, 2),
                "loading_percent": round(loading_percent, 2),
                "status": _line_status(in_service, loading_percent),
            }
        )

    return lines


def _bus_statuses(net: pp.pandapowerNet) -> dict[int, GridStatus]:
    statuses: dict[int, GridStatus] = {}
    for bus_index, bus in net.bus.iterrows():
        if not bool(bus["in_service"]):
            statuses[int(bus_index)] = "failed"
            continue

        connected_loadings = []
        for line_index, line in net.line.iterrows():
            if not bool(line["in_service"]):
                continue
            if int(line["from_bus"]) == int(bus_index) or int(line["to_bus"]) == int(bus_index):
                connected_loadings.append(float(net.res_line.at[line_index, "loading_percent"]))

        max_connected_loading = max(connected_loadings, default=0.0)
        vm_pu = float(net.res_bus.at[bus_index, "vm_pu"])
        statuses[int(bus_index)] = _node_status(vm_pu, max_connected_loading)

    return statuses


def _node_status(voltage_pu: float, max_connected_loading: float) -> GridStatus:
    if max_connected_loading > OVERLOADED_LOADING_LIMIT:
        return "overloaded"
    if max_connected_loading >= HEALTHY_LOADING_LIMIT or voltage_pu < 0.95 or voltage_pu > 1.05:
        return "stressed"
    return "healthy"


def _line_status(in_service: bool, loading_percent: float) -> GridStatus:
    if not in_service:
        return "failed"
    if loading_percent > OVERLOADED_LOADING_LIMIT:
        return "overloaded"
    if loading_percent >= HEALTHY_LOADING_LIMIT:
        return "stressed"
    return "healthy"


def _component_status(in_service: bool, connected_bus_status: GridStatus) -> GridStatus:
    if not in_service:
        return "failed"
    return connected_bus_status


def _line_capacity_mw(net: pp.pandapowerNet, line: Any) -> float:
    from_bus = int(line["from_bus"])
    vn_kv = float(net.bus.at[from_bus, "vn_kv"])
    return sqrt(3) * vn_kv * float(line["max_i_ka"])


def _bus_id(bus_index: int) -> str:
    return f"bus-{bus_index}"
