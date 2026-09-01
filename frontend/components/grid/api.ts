import type { GridLineData, GridNodeData, GridStatus } from "./types";

export type ApiStatus = "healthy" | "stressed" | "overloaded" | "failed";
export type ApiNodeType = "generator" | "bus" | "load";

export type ApiGridNode = {
  id: string;
  name: string;
  type: ApiNodeType;
  status: ApiStatus;
  voltage: number;
  generation_mw?: number;
  load_mw?: number;
  connected_bus_id?: string;
};

export type ApiGridLine = {
  id: string;
  name?: string;
  source: string;
  target: string;
  capacity_mw: number;
  loading_percent: number;
  status: ApiStatus;
};

export type ApiGridMetrics = {
  total_generation_mw: number;
  total_load_mw: number;
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
    generationMw: node.generation_mw,
    loadMw: node.load_mw,
    voltageKv: node.voltage,
    connectedBusId: node.connected_bus_id,
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
