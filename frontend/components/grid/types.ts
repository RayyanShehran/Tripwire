import type { Edge, Node } from "@xyflow/react";

export type GridStatus = "Healthy" | "Stressed" | "Overloaded" | "Failed";
export type GridNodeType = "Generator" | "Substation / Bus" | "Load";

export type GridNodeData = {
  name: string;
  type: GridNodeType;
  status: GridStatus;
  generationMw?: number;
  loadMw?: number;
  voltagePu: number | null;
  connectedBusId?: string;
  isNewlyFailed?: boolean;
  isUnsupplied?: boolean;
};

export type GridLineData = {
  name: string;
  loadingPercent: number | null;
  capacityMw: number | null;
  status: GridStatus;
  isCurrentlyOverloaded?: boolean;
  isUnsupplied?: boolean;
  isNewlyFailed?: boolean;
};

export type GridNode = Node<GridNodeData, "generator" | "bus" | "load">;
export type GridLine = Edge<GridLineData, "transmissionLine">;

export type SelectedGridElement =
  | { kind: "node"; item: GridNode }
  | { kind: "line"; item: GridLine }
  | null;
