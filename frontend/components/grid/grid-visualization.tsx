"use client";

import { useCallback, useMemo, useState } from "react";
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
import { initialEdges, initialNodes } from "./mock-grid";
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
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [selected, setSelected] = useState<SelectedGridElement>(null);

  const metrics = useMemo(() => {
    const failedNodes = nodes.filter((node) => node.data.status === "Failed").length;
    const failedLines = edges.filter((edge) => edge.data?.status === "Failed").length;
    const overloadedLines = edges.filter(
      (edge) => edge.data?.status === "Overloaded",
    ).length;
    const stressedElements =
      nodes.filter((node) => node.data.status === "Stressed").length +
      edges.filter((edge) => edge.data?.status === "Stressed").length;

    return { failedLines, failedNodes, overloadedLines, stressedElements };
  }, [edges, nodes]);

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
              <Metric label="Failed nodes" value={metrics.failedNodes.toString()} />
              <Metric label="Failed lines" value={metrics.failedLines.toString()} />
              <Metric
                label="Overloaded lines"
                value={metrics.overloadedLines.toString()}
              />
              <Metric
                label="Stressed elements"
                value={metrics.stressedElements.toString()}
              />
            </div>
          </div>

          <div className="h-[720px] min-h-[560px] flex-1">
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
