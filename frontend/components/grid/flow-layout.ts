import { toLineData, toNodeData, type ApiGridResponse, type ApiCascadeStep } from "./api";
import type { GridLine, GridNode } from "./types";

type Point = { x: number; y: number };
// Stable schematic coordinates for the teaching network, independent of scenario values.
const schematic: Record<string, Point> = {
  "bus-0": { x: 0, y: 140 }, "bus-1": { x: 240, y: 140 },
  "bus-2": { x: 480, y: 140 }, "bus-3": { x: 480, y: 360 },
  "bus-4": { x: 0, y: 580 }, "bus-5": { x: 240, y: 580 },
  "bus-6": { x: 0, y: 360 }, "bus-7": { x: 480, y: 580 },
  "gen-north": { x: 0, y: 0 }, "gen-south": { x: 0, y: 730 },
  "gen-harbor": { x: 480, y: 730 }, "load-west": { x: -200, y: 360 },
  "load-east": { x: 680, y: 360 }, "load-metro": { x: 240, y: 730 },
  "load-harbor": { x: 680, y: 580 },
};

export function toFlowData(grid: ApiGridResponse, step?: ApiCascadeStep, failedIds: string[] = []): { nodes: GridNode[]; edges: GridLine[] } {
  const failures = new Set(failedIds);
  const newlyFailed = new Set(step?.newly_failed_components.map((item) => item.component_id));
  const overloaded = new Set(step?.overloaded_lines.map((item) => item.component_id));
  const nodes: GridNode[] = grid.nodes.map((node, index) => ({
    id: node.id, type: node.type, position: schematic[node.id] ?? { x: (index % 3) * 240, y: Math.floor(index / 3) * 180 },
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
  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  for (const edge of edges) {
    const a = positions.get(edge.source)!;
    const b = positions.get(edge.target)!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    edge.sourceHandle = `source-${horizontal ? dx >= 0 ? "right" : "left" : dy >= 0 ? "bottom" : "top"}`;
    edge.targetHandle = `target-${horizontal ? dx >= 0 ? "left" : "right" : dy >= 0 ? "top" : "bottom"}`;
  }
  return { nodes, edges };
}
