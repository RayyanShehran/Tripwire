import { toLineData, toNodeData, type ApiGridResponse, type ApiCascadeStep } from "./api";
import type { GridLine, GridNode } from "./types";
import { createDefaultLayout } from "./layout-state";

export function toFlowData(grid: ApiGridResponse, step?: ApiCascadeStep, failedIds: string[] = []): { nodes: GridNode[]; edges: GridLine[] } {
  const failures = new Set(failedIds);
  const newlyFailed = new Set(step?.newly_failed_components.map((item) => item.component_id));
  const overloaded = new Set(step?.overloaded_lines.map((item) => item.component_id));
  const defaultPositions = createDefaultLayout(grid.nodes);
  const nodes: GridNode[] = grid.nodes.map((node) => ({
    id: node.id, type: node.type, position: defaultPositions[node.id],
    data: { ...toNodeData(node), isNewlyFailed: newlyFailed.has(node.id),
      isUnsupplied: node.status === "failed" && node.voltage === null && !failures.has(node.id) && !failures.has(node.connected_bus_id ?? "") },
  }));
  const edges: GridLine[] = grid.lines.map((line) => ({
    id: line.id, type: "transmissionLine", source: line.source, target: line.target,
    data: { ...toLineData(line), isCurrentlyOverloaded: overloaded.has(line.id), isNewlyFailed: newlyFailed.has(line.id),
      isUnsupplied: line.status === "failed" && line.capacity_mw !== null && line.loading_percent === null },
  }));
  grid.nodes.filter((node) => node.connected_bus_id).forEach((node) => {
    const nodeData = nodes.find((item) => item.id === node.id)!.data;
    edges.push({
      id: `connection-${node.id}`, type: "transmissionLine",
      source: node.type === "generator" ? node.id : node.connected_bus_id!,
      target: node.type === "generator" ? node.connected_bus_id! : node.id,
      selectable: false, focusable: false,
      data: { name: "Connection", capacityMw: 0, loadingPercent: 0, status: nodeData.status, isUnsupplied: nodeData.isUnsupplied },
    });
  });
  return { nodes, edges: routeFlowEdges(nodes, edges) };
}

export function routeFlowEdges(nodes: GridNode[], edges: GridLine[]): GridLine[] {
  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  const parallelCounts = new Map<string, number>();
  const parallelIndexes = new Map<string, number>();
  for (const edge of edges.filter((item) => !item.id.startsWith("connection-"))) {
    const key = [edge.source, edge.target].sort().join("::");
    parallelCounts.set(key, (parallelCounts.get(key) ?? 0) + 1);
  }
  return edges.map((original) => {
    const edge: GridLine = { ...original, data: original.data ? { ...original.data, routeSide: undefined } : original.data };
    const a = positions.get(edge.source);
    const b = positions.get(edge.target);
    if (!a || !b) return edge;
    if (edge.data && !edge.id.startsWith("connection-")) {
      const key = [edge.source, edge.target].sort().join("::");
      const count = parallelCounts.get(key) ?? 1;
      const index = parallelIndexes.get(key) ?? 0;
      parallelIndexes.set(key, index + 1);
      edge.data.labelOffset = (index - (count - 1) / 2) * 24;
    }
    const dx = b.x - a.x, dy = b.y - a.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    // Long vertical ties bypass intermediate bus symbols rather than crossing them.
    if (Math.abs(dx) < 10 && Math.abs(dy) > 300 && !edge.id.startsWith("connection-")) {
      const side = edge.source === "bus-2" ? "left" : "right";
      edge.sourceHandle = `source-${side}`;
      edge.targetHandle = `target-${side}`;
      if (edge.data) edge.data.routeSide = side;
      return edge;
    }
    edge.sourceHandle = `source-${horizontal ? dx >= 0 ? "right" : "left" : dy >= 0 ? "bottom" : "top"}`;
    edge.targetHandle = `target-${horizontal ? dx >= 0 ? "left" : "right" : dy >= 0 ? "top" : "bottom"}`;
    return edge;
  });
}
