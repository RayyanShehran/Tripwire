import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

const source = readFileSync(
  new URL("../components/grid/presentation.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
});
const exportsObject = {};
new Function("exports", compiled.outputText)(exportsObject);
const { playbackState, systemState } = exportsObject;

function grid({ loss = 0, failed = 0, unserved = 0, nodeStatus = "healthy" } = {}) {
  return {
    metrics: {
      load_lost_percent: loss,
      failed_components: failed,
      total_unserved_mw: unserved,
    },
    nodes: [{ status: nodeStatus }],
    lines: [{ status: "healthy" }],
  };
}

test("system state follows the currently displayed network", () => {
  assert.equal(systemState(grid(), null, 0, false), "Healthy");
  assert.equal(systemState(grid({ nodeStatus: "stressed" }), null, 0, false), "Stressed");
  assert.equal(systemState(grid(), { steps: [{}, { event: "cascade_step" }] }, 1, false), "Cascade");
  assert.equal(
    systemState(
      grid({ loss: 100, failed: 12, unserved: 500 }),
      { steps: [{}, {}], termination_reason: "total_blackout" },
      1,
      false,
    ),
    "Blackout",
  );
});

test("playback becomes replay at the final step", () => {
  assert.deepEqual(playbackState(3, 0, false), {
    atEnd: false,
    canPlay: true,
    label: "Play",
  });
  assert.deepEqual(playbackState(3, 2, false), {
    atEnd: true,
    canPlay: true,
    label: "Replay",
  });
  assert.equal(playbackState(3, 1, true).label, "Pause");
  assert.equal(playbackState(1, 0, false).canPlay, false);
});
