from __future__ import annotations

from collections import defaultdict, deque
from math import isfinite, sqrt
from typing import Any, Literal

import pandapower as pp
from pydantic import BaseModel, ConfigDict, Field


class DefinitionModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BusDefinition(DefinitionModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    voltage_kv: float
    notes: str = Field(default="", max_length=1000)


class GeneratorDefinition(DefinitionModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    bus_id: str
    min_mw: float = 0.0
    max_mw: float
    setpoint_mw: float
    is_slack: bool = False
    voltage_pu: float = 1.0
    notes: str = Field(default="", max_length=1000)


class LoadDefinition(DefinitionModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    bus_id: str
    demand_mw: float
    reactive_mvar: float = 0.0
    notes: str = Field(default="", max_length=1000)


class LineElectricalParameters(DefinitionModel):
    resistance_ohm_per_km: float = 0.04
    reactance_ohm_per_km: float = 0.28
    capacitance_nf_per_km: float = 11.0


class LineDefinition(DefinitionModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    source_bus_id: str
    target_bus_id: str
    length_km: float
    capacity_mw: float
    electrical_parameters: LineElectricalParameters = Field(
        default_factory=LineElectricalParameters
    )
    notes: str = Field(default="", max_length=1000)


class GridMetadata(DefinitionModel):
    description: str = Field(default="", max_length=2000)
    source_preset: str | None = None
    tags: list[str] = Field(default_factory=list)


class GridDefinition(DefinitionModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    version: Literal[1] = 1
    buses: list[BusDefinition]
    generators: list[GeneratorDefinition]
    loads: list[LoadDefinition]
    lines: list[LineDefinition]
    metadata: GridMetadata = Field(default_factory=GridMetadata)


class ValidationIssue(DefinitionModel):
    component_id: str | None = None
    field: str | None = None
    message: str
    code: str


class GridValidationResult(DefinitionModel):
    valid: bool
    errors: list[ValidationIssue]
    warnings: list[ValidationIssue]
    island_count: int


def validate_grid_definition(definition: GridDefinition) -> GridValidationResult:
    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []

    collections = (
        ("bus", definition.buses),
        ("generator", definition.generators),
        ("load", definition.loads),
        ("line", definition.lines),
    )
    seen: dict[str, str] = {}
    for kind, components in collections:
        for component in components:
            if component.id in seen:
                errors.append(_issue(component.id, "id", f"ID is already used by {seen[component.id]}", "duplicate_id"))
            else:
                seen[component.id] = kind

    if not definition.buses:
        errors.append(_issue(None, "buses", "At least one bus is required", "missing_bus"))

    bus_by_id = {bus.id: bus for bus in definition.buses}
    for bus in definition.buses:
        _positive(errors, bus.id, "voltage_kv", bus.voltage_kv)

    for generator in definition.generators:
        _reference(errors, generator.id, "bus_id", generator.bus_id, bus_by_id)
        _finite(errors, generator.id, "min_mw", generator.min_mw)
        _finite(errors, generator.id, "max_mw", generator.max_mw)
        _finite(errors, generator.id, "setpoint_mw", generator.setpoint_mw)
        _positive(errors, generator.id, "max_mw", generator.max_mw)
        if all(isfinite(value) for value in (generator.min_mw, generator.setpoint_mw, generator.max_mw)):
            if generator.min_mw < 0 or not generator.min_mw <= generator.setpoint_mw <= generator.max_mw:
                errors.append(_issue(generator.id, "setpoint_mw", "Generator must satisfy 0 <= min MW <= setpoint MW <= max MW", "invalid_generator_limits"))
        _positive(errors, generator.id, "voltage_pu", generator.voltage_pu)

    for load in definition.loads:
        _reference(errors, load.id, "bus_id", load.bus_id, bus_by_id)
        _finite(errors, load.id, "demand_mw", load.demand_mw)
        _finite(errors, load.id, "reactive_mvar", load.reactive_mvar)
        if isfinite(load.demand_mw) and load.demand_mw < 0:
            errors.append(_issue(load.id, "demand_mw", "Load demand cannot be negative", "negative_load"))

    adjacency: dict[str, set[str]] = defaultdict(set)
    for line in definition.lines:
        _reference(errors, line.id, "source_bus_id", line.source_bus_id, bus_by_id)
        _reference(errors, line.id, "target_bus_id", line.target_bus_id, bus_by_id)
        if line.source_bus_id == line.target_bus_id:
            errors.append(_issue(line.id, "target_bus_id", "A line cannot connect a bus to itself", "self_loop"))
        _positive(errors, line.id, "length_km", line.length_km)
        _positive(errors, line.id, "capacity_mw", line.capacity_mw)
        params = line.electrical_parameters
        _nonnegative(errors, line.id, "electrical_parameters.resistance_ohm_per_km", params.resistance_ohm_per_km)
        _positive(errors, line.id, "electrical_parameters.reactance_ohm_per_km", params.reactance_ohm_per_km)
        _nonnegative(errors, line.id, "electrical_parameters.capacitance_nf_per_km", params.capacitance_nf_per_km)
        source = bus_by_id.get(line.source_bus_id)
        target = bus_by_id.get(line.target_bus_id)
        if source and target and abs(source.voltage_kv - target.voltage_kv) > 1e-6:
            errors.append(_issue(line.id, "target_bus_id", "Connected buses must have compatible voltage levels", "voltage_mismatch"))
        if source and target and source.id != target.id:
            adjacency[source.id].add(target.id)
            adjacency[target.id].add(source.id)

    slack = [generator for generator in definition.generators if generator.is_slack]
    if not definition.generators:
        errors.append(_issue(None, "generators", "At least one power source is required", "missing_source"))
    elif len(slack) != 1:
        errors.append(_issue(None, "generators", "Exactly one slack/source generator is required", "invalid_slack_count"))

    islands = _islands([bus.id for bus in definition.buses], adjacency)
    generators_by_bus = {generator.bus_id for generator in definition.generators}
    slack_buses = {generator.bus_id for generator in slack}
    loads_by_bus = {load.bus_id for load in definition.loads if load.demand_mw > 0}
    for index, island in enumerate(islands, start=1):
        if not island & slack_buses:
            affected_loads = sorted(island & loads_by_bus)
            message = "Island has no slack/source and will be unsupplied"
            if affected_loads:
                message += f"; affected load buses: {', '.join(affected_loads)}"
            warnings.append(_issue(next(iter(sorted(island)), None), None, message, "unsupplied_island"))
        if not island & generators_by_bus and not island & loads_by_bus:
            warnings.append(_issue(next(iter(sorted(island)), None), None, f"Island {index} contains no generation or load", "isolated_bus"))

    return GridValidationResult(valid=not errors, errors=errors, warnings=warnings, island_count=len(islands))


def build_network_from_definition(definition: GridDefinition) -> pp.pandapowerNet:
    validation = validate_grid_definition(definition)
    if not validation.valid:
        raise ValueError("Invalid grid definition: " + "; ".join(issue.message for issue in validation.errors))

    net = pp.create_empty_network(name=definition.name)
    bus_indexes: dict[str, int] = {}
    for bus in definition.buses:
        index = pp.create_bus(net, vn_kv=bus.voltage_kv, name=bus.name)
        net.bus.loc[index, "tripwire_id"] = bus.id
        net.bus.loc[index, "tripwire_notes"] = bus.notes
        bus_indexes[bus.id] = index

    for generator in definition.generators:
        if generator.is_slack:
            index = pp.create_ext_grid(net, bus=bus_indexes[generator.bus_id], vm_pu=generator.voltage_pu, name=generator.name)
            net.ext_grid.loc[index, "tripwire_id"] = generator.id
            net.ext_grid.loc[index, "min_p_mw"] = generator.min_mw
            net.ext_grid.loc[index, "max_p_mw"] = generator.max_mw
            net.ext_grid.loc[index, "tripwire_setpoint_mw"] = generator.setpoint_mw
            net.ext_grid.loc[index, "tripwire_notes"] = generator.notes
        else:
            index = pp.create_gen(net, bus=bus_indexes[generator.bus_id], p_mw=generator.setpoint_mw, vm_pu=generator.voltage_pu, min_p_mw=generator.min_mw, max_p_mw=generator.max_mw, name=generator.name)
            net.gen.loc[index, "tripwire_id"] = generator.id
            net.gen.loc[index, "tripwire_notes"] = generator.notes

    for load in definition.loads:
        index = pp.create_load(net, bus=bus_indexes[load.bus_id], p_mw=load.demand_mw, q_mvar=load.reactive_mvar, name=load.name)
        net.load.loc[index, "tripwire_id"] = load.id
        net.load.loc[index, "tripwire_notes"] = load.notes

    for line in definition.lines:
        source = next(bus for bus in definition.buses if bus.id == line.source_bus_id)
        max_i_ka = line.capacity_mw / (sqrt(3) * source.voltage_kv)
        params = line.electrical_parameters
        index = pp.create_line_from_parameters(
            net, from_bus=bus_indexes[line.source_bus_id], to_bus=bus_indexes[line.target_bus_id],
            length_km=line.length_km, r_ohm_per_km=params.resistance_ohm_per_km,
            x_ohm_per_km=params.reactance_ohm_per_km, c_nf_per_km=params.capacitance_nf_per_km,
            max_i_ka=max_i_ka, name=line.name,
        )
        net.line.loc[index, "tripwire_id"] = line.id
        net.line.loc[index, "tripwire_capacity_mw"] = line.capacity_mw
        net.line.loc[index, "tripwire_notes"] = line.notes

    net["tripwire_definition_id"] = definition.id
    net["tripwire_definition"] = definition.model_dump(mode="json")
    return net


def _issue(component_id: str | None, field: str | None, message: str, code: str) -> ValidationIssue:
    return ValidationIssue(component_id=component_id, field=field, message=message, code=code)


def _finite(errors: list[ValidationIssue], component_id: str, field: str, value: float) -> None:
    if not isfinite(value):
        errors.append(_issue(component_id, field, "Value must be finite", "non_finite"))


def _positive(errors: list[ValidationIssue], component_id: str | None, field: str, value: float) -> None:
    _finite(errors, component_id or "grid", field, value)
    if isfinite(value) and value <= 0:
        errors.append(_issue(component_id, field, "Value must be greater than zero", "not_positive"))


def _nonnegative(errors: list[ValidationIssue], component_id: str, field: str, value: float) -> None:
    _finite(errors, component_id, field, value)
    if isfinite(value) and value < 0:
        errors.append(_issue(component_id, field, "Value cannot be negative", "negative_value"))


def _reference(errors: list[ValidationIssue], component_id: str, field: str, value: str, known: dict[str, Any]) -> None:
    if value not in known:
        errors.append(_issue(component_id, field, f"Referenced bus '{value}' does not exist", "missing_bus_reference"))


def _islands(bus_ids: list[str], adjacency: dict[str, set[str]]) -> list[set[str]]:
    remaining = set(bus_ids)
    islands: list[set[str]] = []
    while remaining:
        start = min(remaining)
        island: set[str] = set()
        queue = deque([start])
        while queue:
            bus_id = queue.popleft()
            if bus_id in island:
                continue
            island.add(bus_id)
            queue.extend(adjacency[bus_id] - island)
        remaining -= island
        islands.append(island)
    return islands


BUILTIN_GRID_DEFINITION = GridDefinition(
    id="tripwire-grid-v1", name="Tripwire Teaching Grid", version=1,
    buses=[BusDefinition(id=f"bus-{i}", name=name, voltage_kv=230.0) for i, name in enumerate([
        "North 230 kV Bus", "Central A 230 kV Bus", "Central B 230 kV Bus", "East 230 kV Bus",
        "South 230 kV Bus", "Metro 230 kV Bus", "West 230 kV Bus", "Harbor 230 kV Bus",
    ])],
    generators=[
        GeneratorDefinition(id="gen-north", name="North Ridge Slack Generator", bus_id="bus-0", min_mw=0, max_mw=500, setpoint_mw=255, is_slack=True, voltage_pu=1.01),
        GeneratorDefinition(id="gen-south", name="South Thermal Generator", bus_id="bus-4", min_mw=0, max_mw=180, setpoint_mw=150, voltage_pu=1.01),
        GeneratorDefinition(id="gen-harbor", name="Harbor Gas Generator", bus_id="bus-7", min_mw=0, max_mw=120, setpoint_mw=95, voltage_pu=1.0),
    ],
    loads=[
        LoadDefinition(id="load-east", name="East Industrial Load", bus_id="bus-3", demand_mw=110, reactive_mvar=22),
        LoadDefinition(id="load-metro", name="Metro Load", bus_id="bus-5", demand_mw=145, reactive_mvar=31),
        LoadDefinition(id="load-west", name="West Residential Load", bus_id="bus-6", demand_mw=80, reactive_mvar=16),
        LoadDefinition(id="load-harbor", name="Harbor Load", bus_id="bus-7", demand_mw=65, reactive_mvar=13),
    ],
    lines=[
        LineDefinition(id=id_, name=name, source_bus_id=f"bus-{source}", target_bus_id=f"bus-{target}", length_km=length, capacity_mw=sqrt(3)*230*current)
        for id_, name, source, target, length, current in [
            ("line-101", "L-101 North-Central A", 0, 1, 34, 1.8), ("line-102", "L-102 Central A-Central B", 1, 2, 28, 1.65),
            ("line-103", "L-103 Central B-East", 2, 3, 24, 1.45), ("line-104", "L-104 North-South", 0, 4, 42, 1.6),
            ("line-201", "L-201 South-Central A", 4, 1, 26, 1.5), ("line-202", "L-202 South-Metro", 4, 5, 22, 1.45),
            ("line-203", "L-203 Metro-East", 5, 3, 18, 1.25), ("line-301", "Tie-301 Central B-Harbor", 2, 7, 30, 1.35),
            ("line-302", "Tie-302 Harbor-Metro", 7, 5, 20, 1.25), ("line-401", "L-401 Central A-West", 1, 6, 31, 1.2),
            ("line-402", "L-402 West-Metro", 6, 5, 24, 1.15), ("line-403", "L-403 West-North", 6, 0, 36, 1.1),
        ]
    ],
    metadata=GridMetadata(description="Built-in eight-bus Tripwire teaching network", tags=["built-in", "demo"]),
)
