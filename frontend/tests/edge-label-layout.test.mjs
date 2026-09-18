import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

const source = readFileSync(new URL("../components/grid/edge-label-layout.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const exportsObject = {};
new Function("exports", compiled.outputText)(exportsObject);
const { chooseEdgeLabelPosition } = exportsObject;

test("edge label placement avoids a node card at the line midpoint", () => {
  const obstacle = { x: 120, y: -45, width: 90, height: 90 };
  const placement = chooseEdgeLabelPosition(
    { x: 0, y: 0 },
    { x: 330, y: 0 },
    [obstacle],
    [],
  );
  assert.equal(intersects(placement.rect, obstacle), false);
  assert.notDeepEqual(placement.point, { x: 165, y: 0 });
});

test("edge label placement separates labels sharing a corridor", () => {
  const first = chooseEdgeLabelPosition({ x: 0, y: 0 }, { x: 300, y: 0 }, [], []);
  const second = chooseEdgeLabelPosition({ x: 0, y: 0 }, { x: 300, y: 0 }, [], [first.rect]);
  assert.equal(intersects(first.rect, second.rect), false);
});

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
