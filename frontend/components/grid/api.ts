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
  total_demand_mw: number;
  served_load_mw: number;
  unserved_load_mw: number;
  total_generation_mw: number;
  max_line_loading_percent: number;
};

export type ApiGridResponse = {
  nodes: ApiGridNode[];
  lines: ApiGridLine[];
  metrics: ApiGridMetrics;
};

const displayStatuses: Record<ApiStatus, GridStatus> = {
  healthy: "Healthy",
  stressed: "Stressed",
  overloaded: "Overloaded",
  failed: "Failed",
};

export async function fetchGrid(apiBaseUrl: string): Promise<ApiGridResponse> {
  const response = await fetch(`${apiBaseUrl}/api/grid`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Grid API returned ${response.status}`);
  }

  return (await response.json()) as ApiGridResponse;
}

export async function simulateFailure(
  apiBaseUrl: string,
  componentType: ApiComponentType,
  componentId: string,
): Promise<ApiGridResponse> {
  const response = await fetch(`${apiBaseUrl}/api/failure`, {
    body: JSON.stringify({
      component_type: componentType,
      component_id: componentId,
    }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failure API returned ${response.status}`);
  }

  return (await response.json()) as ApiGridResponse;
}

export async function resetScenario(apiBaseUrl: string): Promise<ApiGridResponse> {
  const response = await fetch(`${apiBaseUrl}/api/reset`, {
    cache: "no-store",
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Reset API returned ${response.status}`);
  }

  return (await response.json()) as ApiGridResponse;
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
