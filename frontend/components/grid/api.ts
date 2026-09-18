import type { GridLineData, GridNodeData, GridStatus } from "./types";

export type ApiStatus = "healthy" | "stressed" | "overloaded" | "failed";
export type ApiNodeType = "generator" | "bus" | "load";
export type ApiComponentType = "generator" | "bus" | "load" | "line";

export type ApiGridNode = {
  id: string;
  name: string;
  type: ApiNodeType;
  status: ApiStatus;
  voltage: number | null;
  generation_mw: number | null;
  load_mw: number | null;
  connected_bus_id: string | null;
};

export type ApiGridLine = {
  id: string;
  name?: string;
  source: string;
  target: string;
  capacity_mw: number | null;
  loading_percent: number | null;
  status: ApiStatus;
};

export type ApiGridMetrics = {
  original_demand_mw: number;
  total_demand_mw: number;
  served_load_mw: number;
  controlled_shed_mw: number;
  involuntary_unserved_mw: number;
  total_unserved_mw: number;
  unserved_load_mw: number;
  load_lost_percent: number;
  total_generation_mw: number;
  failed_components: number;
  failed_lines: number;
  max_line_loading_percent: number;
};

export type ApiGridResponse = {
  nodes: ApiGridNode[];
  lines: ApiGridLine[];
  metrics: ApiGridMetrics;
};

export type ApiCascadeFinalMetrics = {
  original_demand_mw: number;
  total_demand_mw: number;
  served_load_mw: number;
  controlled_shed_mw: number;
  involuntary_unserved_mw: number;
  total_unserved_mw: number;
  unserved_load_mw: number;
  load_lost_percent: number;
  total_generation_mw: number;
  failed_components: number;
  failed_lines: number;
  cascade_depth: number;
  peak_line_loading_percent: number;
  overload_events: number;
};

export type ApiFailureResponse = {
  scenario_id: string;
  scenario_config: ApiScenarioConfig;
  status: "solved" | "blackout";
  termination_reason: "solved" | "no_slack_source" | "total_blackout";
  initial_failure: {
    component_type: ApiComponentType;
    component_id: string;
  };
  grid: ApiGridResponse;
  metrics: ApiGridMetrics;
};

export type ApiCascadeStep = {
  step: number;
  event: "initial_failure" | "cascade_step" | "power_flow_failed";
  newly_failed_components: Array<{
    component_type: ApiComponentType;
    component_id: string;
  }>;
  overloaded_lines: Array<{
    component_id: string;
    loading_percent: number;
  }>;
  grid: ApiGridResponse;
  metrics: ApiGridMetrics & {
    failed_components: number;
    failed_lines: number;
    overloaded_lines: number;
  };
};

export type ApiCascadeResponse = {
  scenario_id: string;
  scenario_config: ApiScenarioConfig;
  initial_failure: {
    component_type: ApiComponentType;
    component_id: string;
  };
  termination_reason:
    | "stable"
    | "max_steps_reached"
    | "power_flow_failed"
    | "total_blackout"
    | "no_additional_failures";
  cascade_depth: number;
  steps: ApiCascadeStep[];
  final_metrics: ApiCascadeFinalMetrics;
};

export type ApiOperatingCondition = {
  load_multiplier: number;
  generation_multiplier: number;
  line_rating_multiplier: number;
  dispatch_profile: string;
};

export type ApiScenarioConfig = ApiOperatingCondition & {
  preset_id: string | null;
  initial_component_type: ApiComponentType;
  initial_component_id: string;
  seed: number;
};

export type ApiPredictionResponse = {
  scenario_id: string;
  scenario_config: ApiScenarioConfig;
  cascade_probability: number;
  predicted_load_lost_percent: number;
  risk_level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  model_version: string;
};

export type ApiMitigationOutcome = {
  original_demand_mw: number;
  served_load_mw: number;
  controlled_shed_mw: number;
  involuntary_unserved_mw: number;
  total_unserved_mw: number;
  load_lost_percent: number;
  cascade_depth: number;
  failed_lines: number;
  failed_components: number;
  unserved_load_mw: number;
  termination_reason: string;
};

export type ApiMitigationRecommendation = {
  rank: number;
  action_type: "generator_redispatch" | "load_shedding";
  description: string;
  parameters: Record<string, string | number>;
  predicted_or_simulated_outcome: ApiMitigationOutcome;
  improvement: {
    load_loss_reduction_percent_points: number;
    failed_lines_reduced: number;
    failed_components_reduced: number;
    cascade_depth_reduced: number;
    unserved_load_reduction_mw: number;
  };
  score: number;
  cascade_result: ApiCascadeResponse;
};

export type ApiMitigationResponse = {
  scenario_id: string;
  scenario_config: ApiScenarioConfig;
  baseline: ApiMitigationOutcome;
  baseline_cascade_result: ApiCascadeResponse;
  recommendations: ApiMitigationRecommendation[];
  summary: string;
  candidate_count: number;
  feasible_candidate_count: number;
  evaluated_candidate_count: number;
  execution_time_ms: number;
  scoring_weights: Record<string, number>;
};

export type ApiDemoPreset = {
  id: string;
  name: string;
  summary: string;
  initial_failure: {
    component_type: ApiComponentType;
    component_id: string;
  };
  operating_condition: ApiOperatingCondition;
  expected_outcome: {
    cascade_depth: number;
    load_lost_percent: number;
    failed_lines: number;
    mitigation_expected: boolean;
  };
  suggested_steps: string[];
};

const displayStatuses: Record<ApiStatus, GridStatus> = {
  healthy: "Healthy",
  stressed: "Stressed",
  overloaded: "Overloaded",
  failed: "Failed",
};

export async function fetchGrid(apiBaseUrl: string, condition?: ApiOperatingCondition): Promise<ApiGridResponse> {
  requireApiBaseUrl(apiBaseUrl);
  const query = condition ? `?${new URLSearchParams(Object.entries(condition).map(([key, value]) => [key, String(value)]))}` : "";
  const response = await fetch(`${apiBaseUrl}/api/grid${query}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "Unable to load grid data"));
  }

  return (await response.json()) as ApiGridResponse;
}

export async function fetchDemoPresets(apiBaseUrl: string): Promise<ApiDemoPreset[]> {
  requireApiBaseUrl(apiBaseUrl);
  const response = await fetch(`${apiBaseUrl}/api/demo-presets`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "Unable to load demo presets"));
  }

  const payload = (await response.json()) as { presets: ApiDemoPreset[] };
  return payload.presets;
}

export async function simulateFailure(
  apiBaseUrl: string,
  componentType: ApiComponentType,
  componentId: string,
  operatingCondition: ApiOperatingCondition,
  presetId: string | null = null,
): Promise<ApiFailureResponse> {
  requireApiBaseUrl(apiBaseUrl);
  const response = await fetch(`${apiBaseUrl}/api/failure`, {
    body: JSON.stringify({
      component_type: componentType,
      component_id: componentId,
      operating_condition: operatingCondition,
      preset_id: presetId,
    }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "Unable to simulate failure"));
  }

  return (await response.json()) as ApiFailureResponse;
}

export async function resetScenario(apiBaseUrl: string): Promise<ApiGridResponse> {
  requireApiBaseUrl(apiBaseUrl);
  const response = await fetch(`${apiBaseUrl}/api/reset`, {
    cache: "no-store",
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "Unable to reset scenario"));
  }

  return (await response.json()) as ApiGridResponse;
}

export async function runCascade(
  apiBaseUrl: string,
  componentType: ApiComponentType,
  componentId: string,
  operatingCondition: ApiOperatingCondition,
  presetId: string | null = null,
): Promise<ApiCascadeResponse> {
  requireApiBaseUrl(apiBaseUrl);
  const response = await fetch(`${apiBaseUrl}/api/cascade`, {
    body: JSON.stringify({
      component_type: componentType,
      component_id: componentId,
      operating_condition: operatingCondition,
      preset_id: presetId,
    }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "Unable to run cascade"));
  }

  return (await response.json()) as ApiCascadeResponse;
}

export async function predictRisk(
  apiBaseUrl: string,
  componentType: ApiComponentType,
  componentId: string,
  operatingCondition: ApiOperatingCondition,
  presetId: string | null = null,
): Promise<ApiPredictionResponse> {
  requireApiBaseUrl(apiBaseUrl);
  const response = await fetch(`${apiBaseUrl}/api/predict`, {
    body: JSON.stringify({
      component_type: componentType,
      component_id: componentId,
      operating_condition: operatingCondition,
      preset_id: presetId,
    }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "Unable to predict risk"));
  }

  return (await response.json()) as ApiPredictionResponse;
}

export async function findMitigations(
  apiBaseUrl: string,
  componentType: ApiComponentType,
  componentId: string,
  operatingCondition: ApiOperatingCondition,
  presetId: string | null = null,
): Promise<ApiMitigationResponse> {
  requireApiBaseUrl(apiBaseUrl);
  const response = await fetch(`${apiBaseUrl}/api/recommend`, {
    body: JSON.stringify({
      component_type: componentType,
      component_id: componentId,
      operating_condition: operatingCondition,
      preset_id: presetId,
      max_candidates: 10,
      top_n: 3,
    }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "Unable to find mitigation"));
  }

  return (await response.json()) as ApiMitigationResponse;
}

function requireApiBaseUrl(apiBaseUrl: string) {
  if (!apiBaseUrl) {
    throw new Error(
      "Frontend API URL is not configured. Set NEXT_PUBLIC_API_URL to the deployed backend URL.",
    );
  }
}

async function apiErrorMessage(response: Response, fallback: string) {
  if (response.status === 0) {
    return "Backend unavailable. Check that the FastAPI server is running.";
  }

  let detail: unknown = null;
  try {
    const payload = (await response.json()) as { detail?: unknown };
    detail = payload.detail;
  } catch {
    detail = null;
  }

  if (response.status === 404) {
    return "Selected component was not found in the backend grid model.";
  }

  if (response.status === 503) {
    return "Tripwire backend is not ready. Check simulator and model artifacts.";
  }

  if (response.status === 422) {
    return "The selected scenario settings are invalid.";
  }

  if (typeof detail === "string" && detail.length > 0 && !detail.includes("Traceback")) {
    return detail;
  }

  return `${fallback}. Backend returned ${response.status}.`;
}

export function toDisplayStatus(status: ApiStatus): GridStatus {
  return displayStatuses[status];
}

export function toNodeData(node: ApiGridNode): GridNodeData {
  return {
    name: node.name,
    type:
      node.type === "generator"
        ? "Generator"
        : node.type === "load"
          ? "Load"
          : "Substation / Bus",
    status: toDisplayStatus(node.status),
    generationMw: node.generation_mw ?? undefined,
    loadMw: node.load_mw ?? undefined,
    voltagePu: node.voltage,
    connectedBusId: node.connected_bus_id ?? undefined,
  };
}

export function toLineData(line: ApiGridLine): GridLineData {
  return {
    name: line.name ?? line.id,
    loadingPercent: line.loading_percent,
    capacityMw: line.capacity_mw,
    status: toDisplayStatus(line.status),
  };
}
