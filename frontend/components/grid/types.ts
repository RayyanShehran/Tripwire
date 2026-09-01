import type { Edge, Node } from "@xyflow/react";

export type GridStatus = "Healthy" | "Stressed" | "Overloaded" | "Failed";
export type GridNodeType = "Generator" | "Substation / Bus" | "Load";

export type GridNodeData = {
  name: string;
  type: GridNodeType;
  status: GridStatus;
  generationMw?: number;
  loadMw?: number;
  voltageKv: number;
};

export type GridLineData = {
  name: string;
  loadingPercent: number;
  capacityMw: number;
  status: GridStatus;
};

export type GridNode = Node<GridNodeData, "generator" | "bus" | "load">;
export type GridLine = Edge<GridLineData, "transmissionLine">;

export type SelectedGridElement =
  | { kind: "node"; item: GridNode }
  | { kind: "line"; item: GridLine }
  | null;
