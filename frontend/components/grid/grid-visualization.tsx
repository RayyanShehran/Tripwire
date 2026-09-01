"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { InfoPanel } from "./info-panel";
import { fetchGrid, toLineData, toNodeData, type ApiGridResponse } from "./api";
import { statusStyles } from "./status";
import { BusNode, GeneratorNode, LoadNode } from "./grid-node";
import { TransmissionLine } from "./transmission-line";
import type { GridLine, GridNode, SelectedGridElement } from "./types";

const nodeTypes = {
  generator: GeneratorNode,
  bus: BusNode,
  load: LoadNode,
};

const edgeTypes = {
  transmissionLine: TransmissionLine,
};

function isGridNode(node: Node): node is GridNode {
  return node.type === "generator" || node.type === "bus" || node.type === "load";
}

function isGridLine(edge: Edge): edge is GridLine {
  return edge.type === "transmissionLine";
}

export function GridVisualization() {
  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
  const [grid, setGrid] = useState<ApiGridResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const flowData = useMemo(() => (grid ? toFlowData(grid) : { nodes: [], edges: [] }), [grid]);
  const [nodes, setNodes, onNodesChange] = useNodesState(flowData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowData.edges);
  const [selected, setSelected] = useState<SelectedGridElement>(null);

  const metrics = useMemo(() => {
    if (grid) {
      return {
        failedLines: edges.filter((edge) => edge.data?.status === "Failed").length,
        failedNodes: nodes.filter((node) => node.data.status === "Failed").length,
        maxLineLoading: `${grid.metrics.max_line_loading_percent.toFixed(1)}%`,
        totalGeneration: `${grid.metrics.total_generation_mw.toFixed(1)} MW`,
        totalLoad: `${grid.metrics.total_load_mw.toFixed(1)} MW`,
      };
    }

    const failedNodes = nodes.filter((node) => node.data.status === "Failed").length;
    const failedLines = edges.filter((edge) => edge.data?.status === "Failed").length;

    return {
      failedLines,
      failedNodes,
      maxLineLoading: "0.0%",
      totalGeneration: "0.0 MW",
      totalLoad: "0.0 MW",
    };
  }, [edges, grid, nodes]);

  useEffect(() => {
    let isMounted = true;

    async function loadGrid() {
      try {
        setIsLoading(true);
        setErrorMessage(null);
        const response = await fetchGrid(apiBaseUrl);
        const nextFlowData = toFlowData(response);

        if (!isMounted) {
          return;
        }

        setGrid(response);
        setNodes(nextFlowData.nodes);
        setEdges(nextFlowData.edges);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setGrid(null);
        setNodes([]);
        setEdges([]);
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load grid data",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadGrid();

    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl, setEdges, setNodes]);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
      const firstNode = selectedNodes[0];
      const firstEdge = selectedEdges[0];

      if (firstNode && isGridNode(firstNode)) {
        setSelected({ kind: "node", item: firstNode });
        return;
      }

      if (firstEdge && isGridLine(firstEdge)) {
        setSelected({ kind: "line", item: firstEdge });
        return;
      }

      setSelected(null);
    },
    [],
  );

  return (
    <ReactFlowProvider>
      <section className="grid min-h-[calc(100vh-82px)] grid-cols-1 bg-neutral-100 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col">
          <div className="border-b border-neutral-200 bg-white px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label="Generation" value={metrics.totalGeneration} />
              <Metric label="Load" value={metrics.totalLoad} />
              <Metric label="Max line loading" value={metrics.maxLineLoading} />
              <Metric label="Failed components" value={(metrics.failedLines + metrics.failedNodes).toString()} />
            </div>
          </div>

          <div className="h-[720px] min-h-[560px] flex-1">
            {isLoading ? (
              <StateMessage title="Loading grid" message="Fetching solved grid state from the FastAPI backend." />
            ) : errorMessage ? (
              <StateMessage title="Backend unavailable" message={errorMessage} />
            ) : (
              <ReactFlow
                edges={edges}
                edgeTypes={edgeTypes}
                fitView
                fitViewOptions={{ padding: 0.16 }}
                minZoom={0.45}
                nodes={nodes}
                nodeTypes={nodeTypes}
                onEdgesChange={onEdgesChange}
                onNodesChange={onNodesChange}
                onPaneClick={() => setSelected(null)}
                onSelectionChange={onSelectionChange}
              >
                <Background color="#d4d4d4" gap={18} />
                <MiniMap
                  nodeColor={(node) => {
                    if (isGridNode(node)) {
                      return statusStyles[node.data.status].edge;
                    }

                    return "#737373";
                  }}
                  pannable
                  zoomable
                />
                <Controls />
              </ReactFlow>
            )}
          </div>
        </div>

        <InfoPanel selected={selected} />
      </section>
    </ReactFlowProvider>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-neutral-200 bg-neutral-50 px-4 py-3">
      <div className="text-xs font-medium text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-neutral-950">{value}</div>
    </div>
  );
}

function StateMessage({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-50 px-6 text-center">
      <div>
        <h2 className="text-lg font-semibold text-neutral-950">{title}</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-neutral-600">{message}</p>
      </div>
    </div>
  );
}

function toFlowData(grid: ApiGridResponse): { nodes: GridNode[]; edges: GridLine[] } {
  const busNodes = grid.nodes.filter((node) => node.type === "bus");
  const generatorNodes = grid.nodes.filter((node) => node.type === "generator");
  const loadNodes = grid.nodes.filter((node) => node.type === "load");
  const busPositions = layoutBusPositions(busNodes.map((node) => node.id));
  const attachmentCounts = new Map<string, number>();

  const nodes: GridNode[] = [
    ...busNodes.map((node) => ({
      id: node.id,
      type: "bus" as const,
      position: busPositions.get(node.id) ?? { x: 0, y: 0 },
      data: toNodeData(node),
    })),
    ...generatorNodes.map((node) => ({
      id: node.id,
      type: "generator" as const,
      position: attachmentPosition(node.connected_bus_id, busPositions, attachmentCounts, -210),
      data: toNodeData(node),
    })),
    ...loadNodes.map((node) => ({
      id: node.id,
      type: "load" as const,
      position: attachmentPosition(node.connected_bus_id, busPositions, attachmentCounts, 210),
      data: toNodeData(node),
    })),
  ];

  const transmissionEdges: GridLine[] = grid.lines.map((line) => ({
    id: line.id,
    type: "transmissionLine" as const,
    source: line.source,
    target: line.target,
    data: toLineData(line),
  }));

  const attachmentEdges: GridLine[] = [...generatorNodes, ...loadNodes]
    .filter((node) => node.connected_bus_id)
    .map((node) => ({
      id: `connection-${node.id}`,
      type: "transmissionLine" as const,
      source: node.type === "generator" ? node.id : node.connected_bus_id!,
      target: node.type === "generator" ? node.connected_bus_id! : node.id,
      data: {
        name: "Connection",
        loadingPercent: 0,
        capacityMw: 0,
        status: toDisplayConnectionStatus(node.status),
      },
      selectable: false,
    }));

  return { nodes, edges: [...transmissionEdges, ...attachmentEdges] };
}

function layoutBusPositions(busIds: string[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const columns = 4;
  const xGap = 250;
  const yGap = 230;

  busIds.forEach((id, index) => {
    positions.set(id, {
      x: 260 + (index % columns) * xGap,
      y: 120 + Math.floor(index / columns) * yGap,
    });
  });

  return positions;
}

function attachmentPosition(
  connectedBusId: string | undefined,
  busPositions: Map<string, { x: number; y: number }>,
  attachmentCounts: Map<string, number>,
  xOffset: number,
): { x: number; y: number } {
  const busPosition = connectedBusId ? busPositions.get(connectedBusId) : undefined;

  if (!busPosition || !connectedBusId) {
    return { x: 0, y: 0 };
  }

  const count = attachmentCounts.get(connectedBusId) ?? 0;
  attachmentCounts.set(connectedBusId, count + 1);

  return {
    x: busPosition.x + xOffset,
    y: busPosition.y + count * 92 - 28,
  };
}

function toDisplayConnectionStatus(status: "healthy" | "stressed" | "overloaded" | "failed") {
  const displayStatuses = {
    healthy: "Healthy",
    stressed: "Stressed",
    overloaded: "Overloaded",
    failed: "Failed",
  } as const;

  return displayStatuses[status];
}
