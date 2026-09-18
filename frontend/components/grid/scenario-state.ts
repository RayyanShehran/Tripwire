import type {
  ApiCascadeResponse, ApiComponentType, ApiFailureResponse, ApiGridResponse,
  ApiDemoPreset, ApiMitigationResponse, ApiOperatingCondition, ApiPredictionResponse,
} from "./api";

export const operatingConditions = {
  baseline: { load_multiplier: 1, generation_multiplier: 1, line_rating_multiplier: 1, dispatch_profile: "balanced" },
  stressed: { load_multiplier: 1.25, generation_multiplier: 0.9, line_rating_multiplier: 0.45, dispatch_profile: "south_reduced" },
  critical: { load_multiplier: 1.25, generation_multiplier: 1, line_rating_multiplier: 0.35, dispatch_profile: "balanced" },
  severe: { load_multiplier: 1.5, generation_multiplier: 0.8, line_rating_multiplier: 0.32, dispatch_profile: "south_heavy" },
} satisfies Record<string, ApiOperatingCondition>;

export type ScenarioInput = {
  presetId: string | null;
  profile: keyof typeof operatingConditions;
  condition: ApiOperatingCondition;
  component: { component_type: ApiComponentType; component_id: string } | null;
};

export type ScenarioState = {
  input: ScenarioInput;
  revision: number;
  baseline: ApiGridResponse | null;
  prediction: ApiPredictionResponse | null;
  failure: ApiFailureResponse | null;
  originalCascadeResult: ApiCascadeResponse | null;
  recommendations: ApiMitigationResponse | null;
  selectedMitigationRank: number | null;
  mitigatedCascadeResult: ApiCascadeResponse | null;
  view: "baseline" | "failure" | "original" | "mitigated";
};

export function initialScenario(revision = 0): ScenarioState {
  return {
    input: { presetId: null, profile: "baseline", condition: operatingConditions.baseline, component: null },
    revision, baseline: null, prediction: null, failure: null,
    originalCascadeResult: null, recommendations: null, selectedMitigationRank: null,
    mitigatedCascadeResult: null, view: "baseline",
  };
}

export function matchingScenarioPreset(input: ScenarioInput, presets: ApiDemoPreset[]) {
  return presets.find((preset) =>
    preset.initial_failure.component_type === input.component?.component_type &&
    preset.initial_failure.component_id === input.component?.component_id &&
    sameOperatingCondition(preset.operating_condition, input.condition),
  ) ?? null;
}

export function scenarioDisplayName(input: ScenarioInput, presets: ApiDemoPreset[]) {
  const preset = matchingScenarioPreset(input, presets);
  if (preset) return preset.name;
  if (!input.component && sameOperatingCondition(input.condition, operatingConditions.baseline)) {
    return "Baseline network";
  }
  return "Custom Scenario";
}

function sameOperatingCondition(left: ApiOperatingCondition, right: ApiOperatingCondition) {
  return left.load_multiplier === right.load_multiplier &&
    left.generation_multiplier === right.generation_multiplier &&
    left.line_rating_multiplier === right.line_rating_multiplier &&
    left.dispatch_profile === right.dispatch_profile;
}

type ResultAction =
  | { type: "baseline"; result: ApiGridResponse }
  | { type: "prediction"; result: ApiPredictionResponse }
  | { type: "failure"; result: ApiFailureResponse }
  | { type: "cascade"; result: ApiCascadeResponse }
  | { type: "recommendations"; result: ApiMitigationResponse };

export type ScenarioAction =
  | { type: "configure"; input: ScenarioInput }
  | { type: "reset" }
  | { type: "replay"; rank: number }
  | (ResultAction & { revision: number });

export function scenarioReducer(state: ScenarioState, action: ScenarioAction): ScenarioState {
  if (action.type === "reset") return initialScenario(state.revision + 1);
  if (action.type === "configure") {
    return { ...initialScenario(state.revision + 1), input: action.input };
  }
  if (action.type === "replay") {
    const candidate = state.recommendations?.recommendations.find((item) => item.rank === action.rank);
    if (!candidate || candidate.cascade_result.scenario_id !== state.originalCascadeResult?.scenario_id) return state;
    return { ...state, selectedMitigationRank: action.rank, mitigatedCascadeResult: candidate.cascade_result, view: "mitigated" };
  }
  // Responses from a previous profile/selection cannot restore invalidated results.
  if (action.revision !== state.revision) return state;
  if (action.type === "baseline") return { ...state, baseline: action.result };
  const knownId = state.prediction?.scenario_id ?? state.originalCascadeResult?.scenario_id ?? state.failure?.scenario_id;
  if (knownId && knownId !== action.result.scenario_id) return state;
  if (action.type === "prediction") return { ...state, prediction: action.result };
  if (action.type === "failure") return { ...state, failure: action.result, view: "failure" };
  if (action.type === "cascade") {
    return { ...state, originalCascadeResult: action.result, view: "original" };
  }
  return {
    ...state, recommendations: action.result,
    originalCascadeResult: state.originalCascadeResult ?? action.result.baseline_cascade_result,
  };
}
