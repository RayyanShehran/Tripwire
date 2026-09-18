import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

const source = readFileSync(new URL("../components/grid/scenario-state.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const exportsObject = {};
new Function("exports", compiled.outputText)(exportsObject);
const { initialScenario, matchingScenarioPreset, scenarioDisplayName, scenarioReducer, operatingConditions } = exportsObject;

const sharedDemoConfiguration = {
  initial_failure: { component_type: "line", component_id: "line-101" },
  operating_condition: operatingConditions.critical,
};
const presets = [
  { id: "severe-cascade", name: "Severe Cascade", ...sharedDemoConfiguration },
  { id: "mitigation-example", name: "Mitigation Example", ...sharedDemoConfiguration },
];

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

test("scenario input changes clear derived results and only operating changes clear the baseline", () => {
  const state = scenarioReducer(completedScenario(), { type: "replay", rank: 1 });
  for (const patch of [
    { presetId: "another-preset" },
    { profile: "stressed", condition: operatingConditions.stressed },
    { condition: { ...state.input.condition, generation_multiplier: 0.8 } },
    { condition: { ...state.input.condition, line_rating_multiplier: 0.4 } },
    { component: { component_type: "line", component_id: "line-402" } },
  ]) {
    const updated = scenarioReducer(state, { type: "configure", input: { ...state.input, ...patch } });
    for (const key of ["prediction", "failure", "originalCascadeResult", "recommendations", "selectedMitigationRank", "mitigatedCascadeResult"]) {
      assert.equal(updated[key], null, key);
    }
    assert.equal(updated.baseline, patch.condition && patch.condition !== state.input.condition ? null : state.baseline);
    assert.equal(updated.revision, state.revision + 1);
  }
});

test("reset clears hidden results and returns the baseline profile", () => {
  const state = scenarioReducer(completedScenario(), { type: "replay", rank: 1 });
  assert.deepEqual(scenarioReducer(state, { type: "reset" }), initialScenario(1));
});

test("late responses cannot restore results after reset or profile change", () => {
  const reset = scenarioReducer(completedScenario(), { type: "reset" });
  for (const type of ["cascade", "prediction", "failure", "recommendations"]) {
    assert.equal(scenarioReducer(reset, { type, result: original, revision: 0 }), reset);
  }
  assert.equal(scenarioReducer(reset, {
    type: "baseline", result: original, condition: operatingConditions.stressed,
  }), reset);
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

test("explicit preset identity wins when configurations are identical", () => {
  const presetInput = {
    presetId: "severe-cascade",
    profile: "critical",
    condition: operatingConditions.critical,
    component: { component_type: "line", component_id: "line-101" },
  };
  assert.equal(matchingScenarioPreset(presetInput, presets)?.id, "severe-cascade");
  assert.equal(scenarioDisplayName(presetInput, presets), "Severe Cascade");
  assert.equal(scenarioDisplayName({ ...presetInput, presetId: "mitigation-example" }, presets), "Mitigation Example");
});

test("manual edits make a named preset custom", () => {
  const input = {
    presetId: null,
    profile: "critical",
    condition: { ...operatingConditions.critical, load_multiplier: 1.5 },
    component: { component_type: "line", component_id: "line-101" },
  };
  assert.equal(matchingScenarioPreset(input, presets), null);
  assert.equal(scenarioDisplayName(input, presets), "Custom Scenario");
});

test("clearing results preserves explicit preset identity", () => {
  const input = {
    presetId: "mitigation-example",
    profile: "critical",
    condition: operatingConditions.critical,
    component: { component_type: "line", component_id: "line-101" },
  };
  let state = scenarioReducer(initialScenario(), { type: "configure", input });
  state = scenarioReducer(state, { type: "baseline", result: { nodes: [], lines: [], metrics: {} }, condition: input.condition });
  const cleared = scenarioReducer(state, { type: "clear-results" });
  assert.equal(cleared.input.presetId, "mitigation-example");
  assert.equal(scenarioDisplayName(cleared.input, presets), "Mitigation Example");
  assert.equal(cleared.baseline, state.baseline);
});

test("loading another preset replaces the old identity", () => {
  const mitigation = {
    presetId: "mitigation-example", profile: "critical",
    condition: operatingConditions.critical,
    component: { component_type: "line", component_id: "line-101" },
  };
  const severe = { ...mitigation, presetId: "severe-cascade" };
  const state = scenarioReducer(
    scenarioReducer(initialScenario(), { type: "configure", input: mitigation }),
    { type: "configure", input: severe },
  );
  assert.equal(scenarioDisplayName(state.input, presets), "Severe Cascade");
});

test("preparing a newly inspected component preserves the grid but invalidates results", () => {
  const baseline = { nodes: [], lines: [], metrics: {} };
  let state = completedScenario();
  state = { ...state, baseline, input: { ...state.input, presetId: "mitigation-example" } };
  const prepared = scenarioReducer(state, {
    type: "prepare",
    component: { component_type: "line", component_id: "line-402" },
  });
  assert.equal(prepared.baseline, baseline);
  assert.equal(prepared.input.presetId, null);
  assert.equal(prepared.input.component.component_id, "line-402");
  assert.equal(prepared.originalCascadeResult, null);
  assert.equal(prepared.recommendations, null);
  assert.equal(prepared.revision, state.revision + 1);
});

test("configuration changes with the same operating condition preserve the baseline", () => {
  const baseline = { nodes: [], lines: [], metrics: {} };
  const state = { ...initialScenario(), baseline };
  const configured = scenarioReducer(state, {
    type: "configure",
    input: {
      ...state.input,
      presetId: "mitigation-example",
      component: { component_type: "line", component_id: "line-101" },
      condition: { ...state.input.condition },
    },
  });
  assert.equal(configured.baseline, baseline);
  assert.equal(scenarioReducer(state, { type: "reset" }).baseline, baseline);
});

test("baseline responses are matched by operating condition rather than scenario revision", () => {
  const result = { nodes: [], lines: [], metrics: {} };
  const prepared = scenarioReducer(initialScenario(), {
    type: "prepare", component: { component_type: "line", component_id: "line-101" },
  });
  assert.equal(scenarioReducer(prepared, {
    type: "baseline", result, condition: operatingConditions.baseline,
  }).baseline, result);
  assert.equal(scenarioReducer(prepared, {
    type: "baseline", result, condition: operatingConditions.stressed,
  }).baseline, null);
});

test("baseline network retains its special label", () => {
  assert.equal(scenarioDisplayName(initialScenario().input, presets), "Baseline network");
});
