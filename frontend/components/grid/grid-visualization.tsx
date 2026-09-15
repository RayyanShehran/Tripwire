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

import { CascadeTimeline } from "./cascade-timeline";
import { InfoPanel } from "./info-panel";
import {
  fetchGrid,
  predictRisk,
  resetScenario,
  runCascade,
  simulateFailure,
  toLineData,
  toNodeData,
  type ApiCascadeResponse,
  type ApiCascadeStep,
  type ApiComponentType,
  type ApiGridResponse,
  type ApiOperatingCondition,
  type ApiPredictionResponse,
} from "./api";
import { statusStyles } from "./status";
import { BusNode, GeneratorNode, LoadNode } from "./grid-node";
import { TransmissionLine } from "./transmission-line";
import type { GridLine, GridNode, SelectedGridElement } from "./types";
import type { OperatingProfileKey, RiskPrediction } from "./info-panel";

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
  const [cascadeResult, setCascadeResult] = useState<ApiCascadeResponse | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [isPredicting, setIsPredicting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const flowData = useMemo(() => (grid ? toFlowData(grid) : { nodes: [], edges: [] }), [grid]);
  const [nodes, setNodes, onNodesChange] = useNodesState(flowData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowData.edges);
  const [selected, setSelected] = useState<SelectedGridElement>(null);
  const [operatingProfile, setOperatingProfile] = useState<OperatingProfileKey>("baseline");
  const [prediction, setPrediction] = useState<RiskPrediction | null>(null);
  const currentCascadeStep = cascadeResult?.steps[currentStepIndex] ?? null;

  const metrics = useMemo(() => {
    if (currentCascadeStep) {
      const loadLostPercent =
        currentCascadeStep.metrics.total_demand_mw === 0
          ? 0
          : (currentCascadeStep.metrics.unserved_load_mw /
              currentCascadeStep.metrics.total_demand_mw) *
            100;

      return [
        {
          label: "Served load",
          value: `${currentCascadeStep.metrics.served_load_mw.toFixed(1)} MW`,
        },
        {
          label: "Unserved load",
          value: `${currentCascadeStep.metrics.unserved_load_mw.toFixed(1)} MW`,
        },
        {
          label: "Load lost",
          value: `${loadLostPercent.toFixed(1)}%`,
        },
        {
          label: "Failed lines",
          value: currentCascadeStep.metrics.failed_lines.toString(),
        },
        {
          label: "Failed components",
          value: currentCascadeStep.metrics.failed_components.toString(),
        },
        {
          label: "Max line loading",
          value: `${currentCascadeStep.metrics.max_line_loading_percent.toFixed(1)}%`,
        },
      ];
    }

    if (grid) {
      return {
        failedLines: edges.filter((edge) => edge.data?.status === "Failed").length,
        failedNodes: nodes.filter((node) => node.data.status === "Failed").length,
        maxLineLoading: `${grid.metrics.max_line_loading_percent.toFixed(1)}%`,
        totalDemand: `${grid.metrics.total_demand_mw.toFixed(1)} MW`,
        totalGeneration: `${grid.metrics.total_generation_mw.toFixed(1)} MW`,
        servedLoad: `${grid.metrics.served_load_mw.toFixed(1)} MW`,
        unservedLoad: `${grid.metrics.unserved_load_mw.toFixed(1)} MW`,
      };
    }

    const failedNodes = nodes.filter((node) => node.data.status === "Failed").length;
    const failedLines = edges.filter((edge) => edge.data?.status === "Failed").length;

    return {
      failedLines,
      failedNodes,
      maxLineLoading: "0.0%",
      totalDemand: "0.0 MW",
      totalGeneration: "0.0 MW",
      servedLoad: "0.0 MW",
      unservedLoad: "0.0 MW",
    };
  }, [currentCascadeStep, edges, grid, nodes]);

  const applyGridResponse = useCallback(
    (response: ApiGridResponse, step?: ApiCascadeStep) => {
      const nextFlowData = toFlowData(response, step);

      setGrid(response);
      setNodes(nextFlowData.nodes);
      setEdges(nextFlowData.edges);
      setSelected(null);
    },
    [setEdges, setNodes],
  );

  useEffect(() => {
    let isMounted = true;
    async function loadGrid() {
      try {
        setIsLoading(true);
        setErrorMessage(null);
        const response = await fetchGrid(apiBaseUrl);

        if (!isMounted) {
          return;
        }

        applyGridResponse(response);
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
  }, [apiBaseUrl, applyGridResponse, setEdges, setNodes]);

  useEffect(() => {
    if (!cascadeResult) {
      return;
    }

    const step = cascadeResult.steps[currentStepIndex];
    if (step) {
      applyGridResponse(step.grid, step);
    }
  }, [applyGridResponse, cascadeResult, currentStepIndex]);

  useEffect(() => {
    if (!isPlaying || !cascadeResult) {
      return;
    }

    const finalStepIndex = cascadeResult.steps.length - 1;
    if (currentStepIndex >= finalStepIndex) {
      setIsPlaying(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setCurrentStepIndex((stepIndex) => Math.min(stepIndex + 1, finalStepIndex));
    }, 1000 / playbackSpeed);

    return () => window.clearTimeout(timeout);
  }, [cascadeResult, currentStepIndex, isPlaying, playbackSpeed]);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
      const firstNode = selectedNodes[0];
      const firstEdge = selectedEdges[0];

      if (firstNode && isGridNode(firstNode)) {
        setSelected({ kind: "node", item: firstNode });
        setPrediction(null);
        return;
      }

      if (firstEdge && isGridLine(firstEdge)) {
        setSelected({ kind: "line", item: firstEdge });
        setPrediction(null);
        return;
      }

      setSelected(null);
      setPrediction(null);
    },
    [],
  );

  const handleSimulateFailure = useCallback(async () => {
    if (!selected) {
      return;
    }

    const componentType = selected.kind === "line" ? "line" : selected.item.type;
    const componentId = selected.item.id;

    try {
      setIsMutating(true);
      setErrorMessage(null);
      const response = await simulateFailure(
        apiBaseUrl,
        componentType as ApiComponentType,
        componentId,
      );
      setCascadeResult(null);
      setPrediction(null);
      setCurrentStepIndex(0);
      setIsPlaying(false);
      applyGridResponse(response);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to simulate failure",
      );
    } finally {
      setIsMutating(false);
    }
  }, [apiBaseUrl, applyGridResponse, selected]);

  const handleResetScenario = useCallback(async () => {
    try {
      setIsMutating(true);
      setErrorMessage(null);
      const response = await resetScenario(apiBaseUrl);
      setCascadeResult(null);
      setPrediction(null);
      setCurrentStepIndex(0);
      setIsPlaying(false);
      applyGridResponse(response);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to reset scenario",
      );
    } finally {
      setIsMutating(false);
    }
  }, [apiBaseUrl, applyGridResponse]);

  const handleRunCascade = useCallback(async () => {
    if (!selected) {
      return;
    }

    const componentType = selected.kind === "line" ? "line" : selected.item.type;
    const componentId = selected.item.id;

    try {
      setIsMutating(true);
      setErrorMessage(null);
      const response = await runCascade(
        apiBaseUrl,
        componentType as ApiComponentType,
        componentId,
        operatingConditions[operatingProfile],
      );

      setCascadeResult(response);
      setPrediction((currentPrediction) =>
        currentPrediction
          ? {
              ...currentPrediction,
              actualCascadeOccurred: response.cascade_depth > 0,
              actualLoadLostPercent: response.final_metrics.load_lost_percent,
            }
          : null,
      );
      setCurrentStepIndex(0);
      setIsPlaying(response.steps.length > 1);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to run cascade",
      );
    } finally {
      setIsMutating(false);
    }
  }, [apiBaseUrl, operatingProfile, selected]);

  const handlePredictRisk = useCallback(async () => {
    if (!selected) {
      return;
    }

    const componentType = selected.kind === "line" ? "line" : selected.item.type;
    const componentId = selected.item.id;

    try {
      setIsPredicting(true);
      setErrorMessage(null);
      const response = await predictRisk(
        apiBaseUrl,
        componentType as ApiComponentType,
        componentId,
        operatingConditions[operatingProfile],
      );
      setPrediction(toRiskPrediction(response));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to predict risk",
      );
    } finally {
      setIsPredicting(false);
    }
  }, [apiBaseUrl, operatingProfile, selected]);

  const handleSelectStep = useCallback((stepIndex: number) => {
    setCurrentStepIndex(stepIndex);
    setIsPlaying(false);
  }, []);

  const handlePreviousStep = useCallback(() => {
    setIsPlaying(false);
    setCurrentStepIndex((stepIndex) => Math.max(stepIndex - 1, 0));
  }, []);

  const handleNextStep = useCallback(() => {
    setIsPlaying(false);
    setCurrentStepIndex((stepIndex) => {
      const finalStepIndex = cascadeResult ? cascadeResult.steps.length - 1 : 0;
      return Math.min(stepIndex + 1, finalStepIndex);
    });
  }, [cascadeResult]);

  const handleTogglePlayback = useCallback(() => {
    if (!cascadeResult || cascadeResult.steps.length <= 1) {
      return;
    }

    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    if (currentStepIndex >= cascadeResult.steps.length - 1) {
      setCurrentStepIndex(0);
    }

    setIsPlaying(true);
  }, [cascadeResult, currentStepIndex, isPlaying]);

  return (
    <ReactFlowProvider>
      <section className="grid min-h-[calc(100vh-82px)] grid-cols-1 bg-neutral-100 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col">
          <div className="border-b border-neutral-200 bg-white px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              {Array.isArray(metrics) ? (
                metrics.map((metric) => (
                  <Metric key={metric.label} label={metric.label} value={metric.value} />
                ))
              ) : (
                <>
                  <Metric label="Generation" value={metrics.totalGeneration} />
                  <Metric label="Demand" value={metrics.totalDemand} />
                  <Metric label="Served load" value={metrics.servedLoad} />
                  <Metric label="Unserved load" value={metrics.unservedLoad} />
                  <Metric label="Max line loading" value={metrics.maxLineLoading} />
                  <Metric label="Failed components" value={(metrics.failedLines + metrics.failedNodes).toString()} />
                </>
              )}
            </div>
          </div>

          {errorMessage && nodes.length > 0 ? (
            <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-medium text-red-800">
              {errorMessage}
            </div>
          ) : null}

          <CascadeTimeline
            cascade={cascadeResult}
            currentStepIndex={currentStepIndex}
            isPlaying={isPlaying}
            onNextStep={handleNextStep}
            onPlaybackSpeedChange={setPlaybackSpeed}
            onPreviousStep={handlePreviousStep}
            onSelectStep={handleSelectStep}
            onTogglePlayback={handleTogglePlayback}
            playbackSpeed={playbackSpeed}
          />

          <div className="h-[720px] min-h-[560px] flex-1">
            {isLoading ? (
              <StateMessage title="Loading grid" message="Fetching solved grid state from the FastAPI backend." />
            ) : errorMessage && nodes.length === 0 ? (
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

        <InfoPanel
          cascadeSummary={
            cascadeResult
              ? {
                  cascadeDepth: cascadeResult.final_metrics.cascade_depth,
                  failedComponents: cascadeResult.final_metrics.failed_components,
                  loadLostPercent: cascadeResult.final_metrics.load_lost_percent,
                  terminationReason: cascadeResult.termination_reason,
                }
              : null
          }
          isMutating={isMutating}
          isPredicting={isPredicting}
          onOperatingProfileChange={(profile) => {
            setOperatingProfile(profile);
            setPrediction(null);
          }}
          onPredictRisk={handlePredictRisk}
          onRunCascade={handleRunCascade}
          onResetScenario={handleResetScenario}
          onSimulateFailure={handleSimulateFailure}
          operatingProfile={operatingProfile}
          prediction={prediction}
          selected={selected}
        />
      </section>
    </ReactFlowProvider>
  );
}

const operatingConditions: Record<OperatingProfileKey, ApiOperatingCondition> = {
  baseline: {
    load_multiplier: 1.0,
    generation_multiplier: 1.0,
    line_rating_multiplier: 1.0,
    dispatch_profile: "balanced",
  },
  stressed: {
    load_multiplier: 1.25,
    generation_multiplier: 0.9,
    line_rating_multiplier: 0.45,
    dispatch_profile: "south_reduced",
  },
  severe: {
    load_multiplier: 1.5,
    generation_multiplier: 0.8,
    line_rating_multiplier: 0.32,
    dispatch_profile: "south_heavy",
  },
};

function toRiskPrediction(response: ApiPredictionResponse): RiskPrediction {
  return {
    cascadeProbability: response.cascade_probability,
    predictedLoadLostPercent: response.predicted_load_lost_percent,
    riskLevel: response.risk_level,
    modelVersion: response.model_version,
  };
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

function toFlowData(
  grid: ApiGridResponse,
  step?: ApiCascadeStep,
): { nodes: GridNode[]; edges: GridLine[] } {
  const busNodes = grid.nodes.filter((node) => node.type === "bus");
  const generatorNodes = grid.nodes.filter((node) => node.type === "generator");
  const loadNodes = grid.nodes.filter((node) => node.type === "load");
  const busPositions = layoutBusPositions(busNodes.map((node) => node.id));
  const attachmentCounts = new Map<string, number>();
  const newlyFailedComponentIds = new Set(
    step?.newly_failed_components.map((component) => component.component_id) ?? [],
  );
  const overloadedLineIds = new Set(
    step?.overloaded_lines.map((line) => line.component_id) ?? [],
  );

  const nodes: GridNode[] = [
    ...busNodes.map((node) => ({
      id: node.id,
      type: "bus" as const,
      position: busPositions.get(node.id) ?? { x: 0, y: 0 },
      data: {
        ...toNodeData(node),
        isNewlyFailed: newlyFailedComponentIds.has(node.id),
      },
    })),
    ...generatorNodes.map((node) => ({
      id: node.id,
      type: "generator" as const,
      position: attachmentPosition(node.connected_bus_id ?? undefined, busPositions, attachmentCounts, -210),
      data: {
        ...toNodeData(node),
        isNewlyFailed: newlyFailedComponentIds.has(node.id),
      },
    })),
    ...loadNodes.map((node) => ({
      id: node.id,
      type: "load" as const,
      position: attachmentPosition(node.connected_bus_id ?? undefined, busPositions, attachmentCounts, 210),
      data: {
        ...toNodeData(node),
        isNewlyFailed: newlyFailedComponentIds.has(node.id),
      },
    })),
  ];

  const transmissionEdges: GridLine[] = grid.lines.map((line) => ({
    id: line.id,
    type: "transmissionLine" as const,
    source: line.source,
    target: line.target,
    data: {
      ...toLineData(line),
      isCurrentlyOverloaded: overloadedLineIds.has(line.id),
      isNewlyFailed: newlyFailedComponentIds.has(line.id),
    },
  }));

  const attachmentEdges: GridLine[] = [...generatorNodes, ...loadNodes]
    .filter((node) => node.connected_bus_id !== null)
    .map((node) => ({
      id: `connection-${node.id}`,
      type: "transmissionLine" as const,
      source: node.type === "generator" ? node.id : node.connected_bus_id!,
      target: node.type === "generator" ? node.connected_bus_id! : node.id,
      data: {
        name: "Connection",
        loadingPercent: 0,
        capacityMw: 0,
        isNewlyFailed: newlyFailedComponentIds.has(node.id),
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
