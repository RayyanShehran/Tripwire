import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

const source = readFileSync(new URL("../components/grid/layout-state.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const exportsObject = {};
new Function("exports", compiled.outputText)(exportsObject);
const {
  GRID_LAYOUT_STORAGE_KEY,
  applyLayoutPositions,
  clearSavedLayout,
  createDefaultLayout,
  mergeLayoutPositions,
  parseSavedLayout,
  readSavedLayout,
  writeSavedLayout,
} = exportsObject;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("default layout gives the teaching grid label-aware spacing", () => {
  const positions = createDefaultLayout([
    { id: "bus-0", type: "bus" },
    { id: "bus-1", type: "bus" },
    { id: "bus-6", type: "bus" },
    { id: "future-bus", type: "bus" },
  ]);
  assert.equal(positions["bus-1"].x - positions["bus-0"].x, 270);
  assert.equal(positions["bus-6"].y - positions["bus-0"].y, 240);
  assert.ok(positions["future-bus"].x > positions["bus-1"].x);
});

test("saved layout accepts finite known positions and ignores stale data", () => {
  const saved = JSON.stringify({
    version: 1,
    positions: {
      "bus-0": { x: 45, y: 90 },
      stale: { x: 1, y: 2 },
      "bus-1": { x: "bad", y: 3 },
    },
  });
  assert.deepEqual(parseSavedLayout(saved, ["bus-0", "bus-1"]), {
    "bus-0": { x: 45, y: 90 },
  });
  assert.deepEqual(parseSavedLayout("not-json", ["bus-0"]), {});
  assert.deepEqual(parseSavedLayout(JSON.stringify({ version: 2, positions: {} }), ["bus-0"]), {});
});

test("custom positions serialize, restore, and clear", () => {
  const storage = memoryStorage();
  writeSavedLayout(storage, [{ id: "bus-0", type: "bus", position: { x: 75, y: 105 } }]);
  assert.deepEqual(readSavedLayout(storage, ["bus-0"]), { "bus-0": { x: 75, y: 105 } });
  clearSavedLayout(storage);
  assert.equal(storage.getItem(GRID_LAYOUT_STORAGE_KEY), null);
});

test("fresh electrical data keeps current visual positions", () => {
  const incoming = [{ id: "bus-0", type: "bus", position: { x: 0, y: 180 }, data: { status: "Failed" } }];
  const current = [{ id: "bus-0", type: "bus", position: { x: 345, y: 510 }, data: { status: "Healthy" } }];
  const merged = mergeLayoutPositions(incoming, current, {});
  assert.deepEqual(merged[0].position, { x: 345, y: 510 });
  assert.equal(merged[0].data.status, "Failed");
});

test("applying defaults restores known nodes without moving unknown nodes", () => {
  const nodes = [
    { id: "bus-0", type: "bus", position: { x: 999, y: 999 } },
    { id: "future-bus", type: "bus", position: { x: 100, y: 100 } },
  ];
  const reset = applyLayoutPositions(nodes, { "bus-0": { x: 0, y: 180 } });
  assert.deepEqual(reset[0].position, { x: 0, y: 180 });
  assert.deepEqual(reset[1].position, { x: 100, y: 100 });
});
