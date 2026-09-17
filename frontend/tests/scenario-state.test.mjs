import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

const source = readFileSync(new URL("../components/grid/scenario-state.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const exportsObject = {};
new Function("exports", compiled.outputText)(exportsObject);
const { initialScenario, scenarioReducer, operatingConditions } = exportsObject;

const original = { scenario_id: "scenario-a", final_metrics: { load_lost_percent: 100 } };
const mitigated = { scenario_id: "scenario-a", final_metrics: { load_lost_percent: 5 } };
function completedScenario() {
  let state = initialScenario();
  state = scenarioReducer(state, { type: "cascade", result: original, revision: 0 });
  return scenarioReducer(state, {
    type: "recommendations", revision: 0,
    result: { scenario_id: "scenario-a", baseline_cascade_result: original, recommendations: [{ rank: 1, cascade_result: mitigated }] },
  });
}

test("replaying mitigation preserves the original cascade and prediction", () => {
  let state = completedScenario();
  state = scenarioReducer(state, { type: "prediction", result: { scenario_id: "scenario-a" }, revision: 0 });
  const replayed = scenarioReducer(state, { type: "replay", rank: 1 });
  assert.equal(replayed.originalCascadeResult, original);
  assert.equal(replayed.mitigatedCascadeResult, mitigated);
  assert.equal(replayed.prediction, state.prediction);
  assert.equal(state.mitigatedCascadeResult, null);
});

test("each operating input change clears all results", () => {
  const state = scenarioReducer(completedScenario(), { type: "replay", rank: 1 });
  for (const patch of [
    { presetId: "another-preset" },
    { profile: "stressed", condition: operatingConditions.stressed },
    { condition: { ...state.input.condition, generation_multiplier: 0.8 } },
    { condition: { ...state.input.condition, line_rating_multiplier: 0.4 } },
    { component: { component_type: "line", component_id: "line-402" } },
  ]) {
    const updated = scenarioReducer(state, { type: "configure", input: { ...state.input, ...patch } });
    for (const key of ["baseline", "prediction", "failure", "originalCascadeResult", "recommendations", "selectedMitigationRank", "mitigatedCascadeResult"]) {
      assert.equal(updated[key], null, key);
    }
    assert.equal(updated.revision, state.revision + 1);
  }
});

test("reset clears hidden results and returns the baseline profile", () => {
  const state = scenarioReducer(completedScenario(), { type: "replay", rank: 1 });
  assert.deepEqual(scenarioReducer(state, { type: "reset" }), initialScenario(1));
});

test("late responses cannot restore results after reset or profile change", () => {
  const reset = scenarioReducer(completedScenario(), { type: "reset" });
  for (const type of ["cascade", "prediction", "failure", "recommendations", "baseline"]) {
    assert.equal(scenarioReducer(reset, { type, result: original, revision: 0 }), reset);
  }
});

test("single failure preserves the scenario component and prediction", () => {
  let state = initialScenario();
  state = scenarioReducer(state, { type: "prediction", result: { scenario_id: "scenario-a" }, revision: 0 });
  const failed = scenarioReducer(state, { type: "failure", result: original, revision: 0 });
  assert.equal(failed.prediction, state.prediction);
  assert.equal(failed.input, state.input);
  assert.equal(failed.view, "failure");
});

test("mismatched fingerprints cannot mix comparison results", () => {
  const state = completedScenario();
  assert.equal(scenarioReducer(state, { type: "prediction", result: { scenario_id: "other" }, revision: 0 }), state);
});
