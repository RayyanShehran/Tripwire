import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

const source = readFileSync(new URL("../components/grid/grid-editor-state.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const exportsObject = {};
new Function("exports", compiled.outputText)(exportsObject);
const { commitHistory, createHistory, createScenarioDocument, localValidation, parseScenarioDocument, readDraft, readPresets, redoHistory, removeComponent, undoHistory, upsertComponent, writeDraft, writePresets } = exportsObject;

function definition() {
  return {
    id: "test-grid", name: "Test Grid", version: 1,
    buses: [{ id: "bus-a", name: "A", voltage_kv: 230 }, { id: "bus-b", name: "B", voltage_kv: 230 }],
    generators: [{ id: "gen-a", name: "Source", bus_id: "bus-a", min_mw: 0, max_mw: 100, setpoint_mw: 60, is_slack: true }],
    loads: [{ id: "load-b", name: "Demand", bus_id: "bus-b", demand_mw: 50 }],
    lines: [{ id: "line-ab", name: "AB", source_bus_id: "bus-a", target_bus_id: "bus-b", length_km: 10, capacity_mw: 100 }],
  };
}

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test("component CRUD preserves electrical references and requires explicit bus cascade", () => {
  const added = upsertComponent(definition(), "load", { id: "load-a", name: "Second", bus_id: "bus-a", demand_mw: 10 });
  assert.equal(added.loads.length, 2);
  assert.throws(() => removeComponent(added, "bus", "bus-a"), /connected to 3 components/);
  const removed = removeComponent(added, "bus", "bus-a", true);
  assert.equal(removed.buses.some((item) => item.id === "bus-a"), false);
  assert.equal(removed.generators.length, 0);
  assert.equal(removed.lines.length, 0);
});

test("undo and redo cover definition edits and visual movement", () => {
  let history = createHistory(definition(), { "bus-a": { x: 0, y: 0 } });
  const changed = upsertComponent(history.present.definition, "bus", { id: "bus-c", name: "C", voltage_kv: 230 });
  history = commitHistory(history, { definition: changed, positions: { "bus-a": { x: 120, y: 80 } } });
  assert.equal(history.present.definition.buses.length, 3);
  history = undoHistory(history);
  assert.equal(history.present.definition.buses.length, 2);
  assert.deepEqual(history.present.positions["bus-a"], { x: 0, y: 0 });
  history = redoHistory(history);
  assert.equal(history.present.definition.buses.length, 3);
});

test("validation catches duplicate IDs, dangling buses, invalid lines, and generator limits", () => {
  const invalid = definition();
  invalid.loads[0].id = "bus-a";
  invalid.loads[0].bus_id = "missing";
  invalid.lines[0].target_bus_id = "bus-a";
  invalid.lines[0].capacity_mw = 0;
  invalid.generators[0].setpoint_mw = 200;
  const result = localValidation(invalid);
  assert.equal(result.valid, false);
  assert.deepEqual(new Set(result.errors.map((item) => item.code)), new Set(["duplicate_id", "missing_bus_reference", "self_loop", "invalid_line", "invalid_generator_limits"]));
});

test("versioned presets, imports, and autosave round trip", () => {
  const memory = storage();
  const document = createScenarioDocument("Custom Test Grid", definition(), { load_multiplier: 1, generation_multiplier: 1, line_rating_multiplier: 1, dispatch_profile: "balanced" }, { "bus-a": { x: 12, y: 34 } }, { showLineIds: true, showLineLoading: true, showElectricalValues: true, showStatusText: true, compactNodeMode: false });
  writeDraft(memory, document);
  writePresets(memory, [document]);
  assert.equal(readDraft(memory).name, "Custom Test Grid");
  assert.equal(readPresets(memory)[0].visual_layout.positions["bus-a"].x, 12);
  assert.equal(parseScenarioDocument(JSON.stringify(document)).schema_version, 1);
  assert.throws(() => parseScenarioDocument(JSON.stringify({ ...document, schema_version: 2 })), /Unsupported scenario schema version/);
});
