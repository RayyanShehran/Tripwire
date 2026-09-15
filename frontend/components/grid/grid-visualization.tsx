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
  fetchDemoPresets,
  findMitigations,
  predictRisk,
  resetScenario,
  runCascade,
  simulateFailure,
  toLineData,
  toNodeData,
  type ApiCascadeResponse,
  type ApiCascadeStep,
  type ApiComponentType,
  type ApiDemoPreset,
  type ApiGridResponse,
  type ApiMitigationRecommendation,
  type ApiMitigationResponse,
  type ApiOperatingCondition,
  type ApiPredictionResponse,
} from "./api";
import { statusStyles } from "./status";
import { BusNode, GeneratorNode, LoadNode } from "./grid-node";
import { TransmissionLine } from "./transmission-line";
import type { GridLine, GridNode, SelectedGridElement } from "./types";
import type {
  ActiveAction,
  MitigationRecommendation,
  MitigationResult,
  OperatingProfileKey,
  RiskPrediction,
} from "./info-panel";

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
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [demoPresets, setDemoPresets] = useState<ApiDemoPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const flowData = useMemo(() => (grid ? toFlowData(grid) : { nodes: [], edges: [] }), [grid]);
  const [nodes, setNodes, onNodesChange] = useNodesState(flowData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowData.edges);
  const [selected, setSelected] = useState<SelectedGridElement>(null);
  const [operatingProfile, setOperatingProfile] = useState<OperatingProfileKey>("baseline");
  const [prediction, setPrediction] = useState<RiskPrediction | null>(null);
  const [mitigation, setMitigation] = useState<MitigationResult | null>(null);
  const [recommendationCascades, setRecommendationCascades] = useState(
    new Map<number, ApiCascadeResponse>(),
  );
  const currentCascadeStep = cascadeResult?.steps[currentStepIndex] ?? null;

  const dashboardMetrics = useMemo(() => {
    if (currentCascadeStep) {
      return [
        {
          label: "System Status",
          value: currentCascadeStep.metrics.load_lost_percent > 0 ? "Impacted" : "Stable",
        },
        {
          label: "Total Demand",
          value: `${currentCascadeStep.metrics.total_demand_mw.toFixed(1)} MW`,
        },
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
          value: `${currentCascadeStep.metrics.load_lost_percent.toFixed(1)}%`,
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
          label: "Cascade Depth",
          value: cascadeResult?.cascade_depth.toString() ?? "0",
        },
        {
          label: "Max line loading",
          value: `${currentCascadeStep.metrics.max_line_loading_percent.toFixed(1)}%`,
        },
        ...predictionMetrics(prediction),
      ];
    }

    if (grid) {
      return [
        {
          label: "System Status",
          value:
            grid.metrics.load_lost_percent > 0 || grid.metrics.failed_components > 0
              ? "Impacted"
              : "Healthy",
        },
        { label: "Total Demand", value: `${grid.metrics.total_demand_mw.toFixed(1)} MW` },
        { label: "Served Load", value: `${grid.metrics.served_load_mw.toFixed(1)} MW` },
        { label: "Unserved Load", value: `${grid.metrics.unserved_load_mw.toFixed(1)} MW` },
        { label: "Load Lost", value: `${grid.metrics.load_lost_percent.toFixed(1)}%` },
        { label: "Max Line Loading", value: `${grid.metrics.max_line_loading_percent.toFixed(1)}%` },
        { label: "Failed Lines", value: grid.metrics.failed_lines.toString() },
        { label: "Failed Components", value: grid.metrics.failed_components.toString() },
        ...predictionMetrics(prediction),
      ];
    }

    return [{ label: "System Status", value: "Loading" }];
  }, [cascadeResult?.cascade_depth, currentCascadeStep, grid, prediction]);

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
        const [response, presets] = await Promise.all([
          fetchGrid(apiBaseUrl),
          fetchDemoPresets(apiBaseUrl),
        ]);

        if (!isMounted) {
          return;
        }

        applyGridResponse(response);
        setDemoPresets(presets);
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
        setMitigation(null);
        setSelectedPresetId(null);
        return;
      }

      if (firstEdge && isGridLine(firstEdge)) {
        setSelected({ kind: "line", item: firstEdge });
        setPrediction(null);
        setMitigation(null);
        setSelectedPresetId(null);
        return;
      }

      setSelected(null);
      setPrediction(null);
      setMitigation(null);
      setSelectedPresetId(null);
    },
    [],
  );

  const handleLoadPreset = useCallback(
    async (preset: ApiDemoPreset) => {
      try {
        setActiveAction("reset");
        setErrorMessage(null);
        const response = await resetScenario(apiBaseUrl);
        const nextFlowData = toFlowData(response);

        setGrid(response);
        setNodes(nextFlowData.nodes);
        setEdges(nextFlowData.edges);
        setCascadeResult(null);
        setPrediction(null);
        setMitigation(null);
        setRecommendationCascades(new Map());
        setCurrentStepIndex(0);
        setIsPlaying(false);
        setOperatingProfile(profileForCondition(preset.operating_condition));
        setSelectedPresetId(preset.id);
        setSelected(findPresetSelection(preset, nextFlowData));
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load demo preset",
        );
      } finally {
        setActiveAction(null);
      }
    },
    [apiBaseUrl, setEdges, setNodes],
  );

  const handleSimulateFailure = useCallback(async () => {
    if (!selected) {
      return;
    }

    const componentType = selected.kind === "line" ? "line" : selected.item.type;
    const componentId = selected.item.id;

    try {
      setActiveAction("failure");
      setErrorMessage(null);
      const response = await simulateFailure(
        apiBaseUrl,
        componentType as ApiComponentType,
        componentId,
      );
      setCascadeResult(null);
      setPrediction(null);
      setMitigation(null);
      setRecommendationCascades(new Map());
      setSelectedPresetId(null);
      setCurrentStepIndex(0);
      setIsPlaying(false);
      applyGridResponse(response);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to simulate failure",
      );
    } finally {
      setActiveAction(null);
    }
  }, [apiBaseUrl, applyGridResponse, selected]);

  const handleResetScenario = useCallback(async () => {
    try {
      setActiveAction("reset");
      setErrorMessage(null);
      const response = await resetScenario(apiBaseUrl);
      setCascadeResult(null);
      setPrediction(null);
      setMitigation(null);
      setRecommendationCascades(new Map());
      setSelectedPresetId(null);
      setCurrentStepIndex(0);
      setIsPlaying(false);
      applyGridResponse(response);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to reset scenario",
      );
    } finally {
      setActiveAction(null);
    }
  }, [apiBaseUrl, applyGridResponse]);

  const handleRunCascade = useCallback(async () => {
    if (!selected) {
      return;
    }

    const componentType = selected.kind === "line" ? "line" : selected.item.type;
    const componentId = selected.item.id;

    try {
      setActiveAction("cascade");
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
      setActiveAction(null);
    }
  }, [apiBaseUrl, operatingProfile, selected]);

  const handleFindMitigation = useCallback(async () => {
    if (!selected) {
      return;
    }

    const componentType = selected.kind === "line" ? "line" : selected.item.type;
    const componentId = selected.item.id;

    try {
      setActiveAction("mitigation");
      setErrorMessage(null);
      const response = await findMitigations(
        apiBaseUrl,
        componentType as ApiComponentType,
        componentId,
        operatingConditions[operatingProfile],
      );
      setMitigation(toMitigationResult(response));
      setRecommendationCascades(toRecommendationCascadeMap(response.recommendations));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to find mitigations",
      );
    } finally {
      setActiveAction(null);
    }
  }, [apiBaseUrl, operatingProfile, selected]);

  const handleSimulateRecommendation = useCallback(
    (recommendation: MitigationRecommendation) => {
      const recommendedCascade = recommendationCascades.get(recommendation.rank);
      if (!recommendedCascade) {
        return;
      }
      setActiveAction("recommendation");
      setCascadeResult(recommendedCascade);
      setCurrentStepIndex(0);
      setIsPlaying(recommendedCascade.steps.length > 1);
      window.setTimeout(() => setActiveAction(null), 0);
    },
    [recommendationCascades],
  );

  const handlePredictRisk = useCallback(async () => {
    if (!selected) {
      return;
    }

    const componentType = selected.kind === "line" ? "line" : selected.item.type;
    const componentId = selected.item.id;

    try {
      setActiveAction("predict");
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
      setActiveAction(null);
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
            <DemoScenarioBar
              activeAction={activeAction}
              onLoadPreset={handleLoadPreset}
              presets={demoPresets}
              selectedPresetId={selectedPresetId}
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              {dashboardMetrics.map((metric) => (
                <Metric key={metric.label} label={metric.label} value={metric.value} />
              ))}
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

          <DemoSummaryPanel
            cascade={cascadeResult}
            mitigation={mitigation}
            prediction={prediction}
            preset={demoPresets.find((preset) => preset.id === selectedPresetId) ?? null}
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
          activeAction={activeAction}
          mitigation={mitigation}
          onFindMitigation={handleFindMitigation}
          onOperatingProfileChange={(profile) => {
            setOperatingProfile(profile);
            setPrediction(null);
            setMitigation(null);
            setRecommendationCascades(new Map());
            setSelectedPresetId(null);
          }}
          onPredictRisk={handlePredictRisk}
          onRunCascade={handleRunCascade}
          onResetScenario={handleResetScenario}
          onSimulateRecommendation={handleSimulateRecommendation}
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
  critical: {
    load_multiplier: 1.25,
    generation_multiplier: 1.0,
    line_rating_multiplier: 0.35,
    dispatch_profile: "balanced",
  },
  severe: {
    load_multiplier: 1.5,
    generation_multiplier: 0.8,
    line_rating_multiplier: 0.32,
    dispatch_profile: "south_heavy",
  },
};

function profileForCondition(condition: ApiOperatingCondition): OperatingProfileKey {
  const match = Object.entries(operatingConditions).find(
    ([, profile]) =>
      profile.load_multiplier === condition.load_multiplier &&
      profile.generation_multiplier === condition.generation_multiplier &&
      profile.line_rating_multiplier === condition.line_rating_multiplier &&
      profile.dispatch_profile === condition.dispatch_profile,
  );

  return (match?.[0] as OperatingProfileKey | undefined) ?? "baseline";
}

function findPresetSelection(
  preset: ApiDemoPreset,
  flowData: { nodes: GridNode[]; edges: GridLine[] },
): SelectedGridElement {
  const failure = preset.initial_failure;

  if (failure.component_type === "line") {
    const edge = flowData.edges.find((item) => item.id === failure.component_id);
    return edge ? { kind: "line", item: edge } : null;
  }

  const node = flowData.nodes.find((item) => item.id === failure.component_id);
  return node ? { kind: "node", item: node } : null;
}

function toRiskPrediction(response: ApiPredictionResponse): RiskPrediction {
  return {
    cascadeProbability: response.cascade_probability,
    predictedLoadLostPercent: response.predicted_load_lost_percent,
    riskLevel: response.risk_level,
    modelVersion: response.model_version,
  };
}

function toMitigationResult(response: ApiMitigationResponse): MitigationResult {
  return {
    baseline: toMitigationOutcome(response.baseline),
    recommendations: response.recommendations.map(toMitigationRecommendation),
    summary: response.summary,
    candidateCount: response.candidate_count,
    executionTimeMs: response.execution_time_ms,
  };
}

function toMitigationRecommendation(
  recommendation: ApiMitigationRecommendation,
): MitigationRecommendation {
  return {
    rank: recommendation.rank,
    actionType: recommendation.action_type,
    description: recommendation.description,
    outcome: toMitigationOutcome(recommendation.predicted_or_simulated_outcome),
    improvement: {
      loadLossReductionPercentPoints:
        recommendation.improvement.load_loss_reduction_percent_points,
      failedLinesReduced: recommendation.improvement.failed_lines_reduced,
      failedComponentsReduced: recommendation.improvement.failed_components_reduced,
      cascadeDepthReduced: recommendation.improvement.cascade_depth_reduced,
      unservedLoadReductionMw: recommendation.improvement.unserved_load_reduction_mw,
    },
    score: recommendation.score,
  };
}

function toMitigationOutcome(outcome: ApiMitigationResponse["baseline"]) {
  return {
    loadLostPercent: outcome.load_lost_percent,
    cascadeDepth: outcome.cascade_depth,
    failedLines: outcome.failed_lines,
    failedComponents: outcome.failed_components,
    unservedLoadMw: outcome.unserved_load_mw,
    terminationReason: outcome.termination_reason,
  };
}

function toRecommendationCascadeMap(recommendations: ApiMitigationRecommendation[]) {
  return new Map(
    recommendations.map((recommendation) => [
      recommendation.rank,
      recommendation.cascade_result,
    ]),
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

function DemoScenarioBar({
  activeAction,
  onLoadPreset,
  presets,
  selectedPresetId,
}: {
  activeAction: ActiveAction;
  onLoadPreset: (preset: ApiDemoPreset) => void;
  presets: ApiDemoPreset[];
  selectedPresetId: string | null;
}) {
  if (presets.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 rounded border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-950">Demo Scenarios</h2>
          <p className="mt-1 text-xs leading-5 text-neutral-600">
            Load a deterministic simulator-backed scenario for the presentation path.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              className={`rounded border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                preset.id === selectedPresetId
                  ? "border-red-700 bg-red-700 text-white"
                  : "border-neutral-300 bg-white text-neutral-800 hover:border-red-700"
              }`}
              disabled={activeAction !== null}
              key={preset.id}
              onClick={() => onLoadPreset(preset)}
              title={preset.summary}
              type="button"
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>
      {selectedPresetId ? (
        <p className="mt-3 text-xs leading-5 text-neutral-600">
          {presets.find((preset) => preset.id === selectedPresetId)?.summary}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3 border-t border-neutral-200 pt-3 text-xs text-neutral-600">
        <StatusLegend label="Healthy" color="bg-emerald-500" />
        <StatusLegend label="Stressed" color="bg-amber-400" />
        <StatusLegend label="Overloaded" color="bg-orange-500" />
        <StatusLegend label="Failed" color="bg-red-700" />
      </div>
    </div>
  );
}

function StatusLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function DemoSummaryPanel({
  cascade,
  mitigation,
  prediction,
  preset,
}: {
  cascade: ApiCascadeResponse | null;
  mitigation: MitigationResult | null;
  prediction: RiskPrediction | null;
  preset: ApiDemoPreset | null;
}) {
  if (!preset && !prediction && !cascade && !mitigation) {
    return null;
  }

  const bestRecommendation = mitigation?.recommendations[0] ?? null;

  return (
    <section className="border-b border-neutral-200 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-950">Demo Result Summary</h2>
          <p className="mt-1 text-xs leading-5 text-neutral-600">
            {preset ? preset.name : "Current scenario"} comparison for prediction, actual cascade, and mitigation.
          </p>
        </div>
        {preset ? (
          <div className="text-xs font-medium text-neutral-600">
            Expected: {preset.expected_outcome.cascade_depth} depth,{" "}
            {preset.expected_outcome.load_lost_percent.toFixed(1)}% load lost
          </div>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <SummaryCard
          rows={[
            ["Cascade probability", prediction ? `${(prediction.cascadeProbability * 100).toFixed(0)}%` : "Run prediction"],
            ["Predicted load loss", prediction ? `${prediction.predictedLoadLostPercent.toFixed(1)}%` : "Run prediction"],
          ]}
          title="Prediction"
        />
        <SummaryCard
          rows={[
            ["Cascade occurred", cascade ? (cascade.cascade_depth > 0 ? "Yes" : "No") : "Run cascade"],
            ["Actual load loss", cascade ? `${cascade.final_metrics.load_lost_percent.toFixed(1)}%` : "Run cascade"],
            ["Cascade depth", cascade ? cascade.cascade_depth.toString() : "Run cascade"],
            ["Failed lines", cascade ? cascade.final_metrics.failed_lines.toString() : "Run cascade"],
          ]}
          title="Actual"
        />
        <SummaryCard
          rows={[
            ["Recommended action", bestRecommendation?.description ?? "Find mitigation"],
            [
              "Mitigated load loss",
              bestRecommendation ? `${bestRecommendation.outcome.loadLostPercent.toFixed(1)}%` : "Find mitigation",
            ],
            [
              "Improvement",
              bestRecommendation
                ? `${bestRecommendation.improvement.loadLossReductionPercentPoints.toFixed(1)} pts`
                : "Find mitigation",
            ],
          ]}
          title="Mitigation"
        />
      </div>
    </section>
  );
}

function SummaryCard({
  rows,
  title,
}: {
  rows: Array<[string, string]>;
  title: string;
}) {
  return (
    <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h3>
      <dl className="mt-2 grid gap-2">
        {rows.map(([label, value]) => (
          <div className="grid gap-1 text-sm" key={label}>
            <dt className="text-xs text-neutral-500">{label}</dt>
            <dd className="font-semibold text-neutral-950">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function predictionMetrics(prediction: RiskPrediction | null) {
  if (!prediction) {
    return [];
  }

  return [
    {
      label: "Cascade Probability",
      value: `${(prediction.cascadeProbability * 100).toFixed(0)}%`,
    },
    {
      label: "Predicted Load Loss",
      value: `${prediction.predictedLoadLostPercent.toFixed(1)}%`,
    },
    {
      label: "Risk Level",
      value: prediction.riskLevel,
    },
  ];
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
