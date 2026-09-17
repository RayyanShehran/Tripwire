"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type ApiFailureResponse,
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
import { ActionButton } from "../ui/action-button";
import { MetricCard } from "../ui/metric-card";
import { SectionPanel } from "../ui/section-panel";
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
  const apiBaseUrl = normalizeApiUrl(process.env.NEXT_PUBLIC_API_URL);
  const [grid, setGrid] = useState<ApiGridResponse | null>(null);
  const [originalCascadeResult, setOriginalCascadeResult] = useState<ApiCascadeResponse | null>(null);
  const [mitigatedCascadeResult, setMitigatedCascadeResult] = useState<ApiCascadeResponse | null>(null);
  const cascadeResult = mitigatedCascadeResult ?? originalCascadeResult;
  const [, setFailureResult] = useState<ApiFailureResponse | null>(null);
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
  const selectedRef = useRef<SelectedGridElement>(null);
  const [operatingProfile, setOperatingProfile] = useState<OperatingProfileKey>("baseline");
  const [prediction, setPrediction] = useState<RiskPrediction | null>(null);
  const [mitigation, setMitigation] = useState<MitigationResult | null>(null);
  const [selectedMitigation, setSelectedMitigation] = useState<MitigationRecommendation | null>(null);
  const [recommendationCascades, setRecommendationCascades] = useState(
    new Map<number, ApiCascadeResponse>(),
  );
  const currentCascadeStep = cascadeResult?.steps[currentStepIndex] ?? null;

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

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
    (
      response: ApiGridResponse,
      step?: ApiCascadeStep,
      preserveSelection?: SelectedGridElement,
    ) => {
      const nextFlowData = toFlowData(response, step);

      setGrid(response);
      setNodes(nextFlowData.nodes);
      setEdges(nextFlowData.edges);
      setSelected(
        preserveSelection
          ? findMatchingSelection(preserveSelection, nextFlowData)
          : null,
      );
    },
    [setEdges, setNodes],
  );

  const clearScenarioResults = useCallback(() => {
    setFailureResult(null);
    setPrediction(null);
    setOriginalCascadeResult(null);
    setMitigatedCascadeResult(null);
    setMitigation(null);
    setSelectedMitigation(null);
    setRecommendationCascades(new Map());
    setSelectedPresetId(null);
    setCurrentStepIndex(0);
    setIsPlaying(false);
  }, []);

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
      applyGridResponse(step.grid, step, selectedRef.current);
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
        clearScenarioResults();
        return;
      }

      if (firstEdge && isGridLine(firstEdge)) {
        setSelected({ kind: "line", item: firstEdge });
        clearScenarioResults();
        return;
      }

      setSelected(null);
      clearScenarioResults();
    },
    [clearScenarioResults],
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
        clearScenarioResults();
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
    [apiBaseUrl, clearScenarioResults, setEdges, setNodes],
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
        operatingConditions[operatingProfile],
      );
      clearScenarioResults();
      setFailureResult(response);
      applyGridResponse(response.grid);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to simulate failure",
      );
    } finally {
      setActiveAction(null);
    }
  }, [apiBaseUrl, applyGridResponse, clearScenarioResults, operatingProfile, selected]);

  const handleResetScenario = useCallback(async () => {
    try {
      setActiveAction("reset");
      setErrorMessage(null);
      const response = await resetScenario(apiBaseUrl);
      clearScenarioResults();
      setOperatingProfile("baseline");
      setSelected(null);
      applyGridResponse(response);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to reset scenario",
      );
    } finally {
      setActiveAction(null);
    }
  }, [apiBaseUrl, applyGridResponse, clearScenarioResults]);

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

      setFailureResult(null);
      setOriginalCascadeResult(response);
      setMitigatedCascadeResult(null);
      setMitigation(null);
      setSelectedMitigation(null);
      setRecommendationCascades(new Map());
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
      setOriginalCascadeResult((current) => current ?? response.baseline_cascade_result);
      setMitigatedCascadeResult(null);
      setSelectedMitigation(null);
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
      setSelectedMitigation(recommendation);
      setMitigatedCascadeResult(recommendedCascade);
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

  const handleOperatingProfileChange = useCallback(
    (profile: OperatingProfileKey) => {
      setOperatingProfile(profile);
      clearScenarioResults();
      void resetScenario(apiBaseUrl)
        .then((response) => applyGridResponse(response, undefined, selectedRef.current))
        .catch((error: unknown) => {
          setErrorMessage(
            error instanceof Error ? error.message : "Unable to reset scenario state",
          );
        });
    },
    [apiBaseUrl, applyGridResponse, clearScenarioResults],
  );

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
      <section className="grid min-h-[calc(100vh-82px)] grid-cols-1 bg-slate-950 lg:grid-cols-[288px_minmax(0,1fr)_360px]">
        <ControlRail
          activeAction={activeAction}
          onFindMitigation={handleFindMitigation}
          onLoadPreset={handleLoadPreset}
          onOperatingProfileChange={handleOperatingProfileChange}
          onPredictRisk={handlePredictRisk}
          onRunCascade={handleRunCascade}
          onResetScenario={handleResetScenario}
          onSimulateFailure={handleSimulateFailure}
          operatingProfile={operatingProfile}
          presets={demoPresets}
          selected={selected}
          selectedPresetId={selectedPresetId}
        />

        <div className="flex min-w-0 flex-col border-x border-slate-800">
          <div className="border-b border-slate-800 bg-slate-900/80 px-5 py-4">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-8">
              {dashboardMetrics.map((metric) => (
                <Metric key={metric.label} label={metric.label} value={metric.value} />
              ))}
            </div>
          </div>

          {errorMessage && nodes.length > 0 ? (
            <div className="border-b border-red-500/30 bg-red-950/70 px-5 py-3 text-sm font-medium text-red-100">
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
            mitigatedCascade={mitigatedCascadeResult}
            mitigation={mitigation}
            originalCascade={originalCascadeResult}
            prediction={prediction}
            preset={demoPresets.find((preset) => preset.id === selectedPresetId) ?? null}
          />

          <div className="relative h-[720px] min-h-[560px] flex-1 bg-slate-950">
            <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-md border border-slate-800 bg-slate-950/85 px-3 py-2 text-xs text-slate-400 shadow-xl shadow-black/40">
              Power Network
            </div>
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
                <Background color="#1e293b" gap={18} />
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
          originalCascadeSummary={
            originalCascadeResult
              ? {
                  cascadeDepth: originalCascadeResult.final_metrics.cascade_depth,
                  failedComponents: originalCascadeResult.final_metrics.failed_components,
                  failedLines: originalCascadeResult.final_metrics.failed_lines,
                  loadLostPercent: originalCascadeResult.final_metrics.load_lost_percent,
                  terminationReason: originalCascadeResult.termination_reason,
                }
              : null
          }
          mitigatedCascadeSummary={
            mitigatedCascadeResult
              ? {
                  cascadeDepth: mitigatedCascadeResult.final_metrics.cascade_depth,
                  controlledShedMw: mitigatedCascadeResult.final_metrics.controlled_shed_mw,
                  failedComponents: mitigatedCascadeResult.final_metrics.failed_components,
                  failedLines: mitigatedCascadeResult.final_metrics.failed_lines,
                  involuntaryUnservedMw:
                    mitigatedCascadeResult.final_metrics.involuntary_unserved_mw,
                  loadLostPercent: mitigatedCascadeResult.final_metrics.load_lost_percent,
                  terminationReason: mitigatedCascadeResult.termination_reason,
                  totalUnservedMw: mitigatedCascadeResult.final_metrics.total_unserved_mw,
                }
              : null
          }
          mitigation={mitigation}
          onSimulateRecommendation={handleSimulateRecommendation}
          prediction={prediction}
          selected={selected}
          selectedMitigation={selectedMitigation}
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

function normalizeApiUrl(value: string | undefined) {
  return value?.replace(/\/$/, "") ?? "";
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

function findMatchingSelection(
  selection: SelectedGridElement,
  flowData: { nodes: GridNode[]; edges: GridLine[] },
): SelectedGridElement {
  if (!selection) {
    return null;
  }

  if (selection.kind === "line") {
    const edge = flowData.edges.find((item) => item.id === selection.item.id);
    return edge ? { kind: "line", item: edge } : null;
  }

  const node = flowData.nodes.find((item) => item.id === selection.item.id);
  return node ? { kind: "node", item: node } : null;
}

function toRiskPrediction(response: ApiPredictionResponse): RiskPrediction {
  return {
    scenarioId: response.scenario_id,
    cascadeProbability: response.cascade_probability,
    predictedLoadLostPercent: response.predicted_load_lost_percent,
    riskLevel: response.risk_level,
    modelVersion: response.model_version,
  };
}

function toMitigationResult(response: ApiMitigationResponse): MitigationResult {
  return {
    scenarioId: response.scenario_id,
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
    originalDemandMw: outcome.original_demand_mw,
    servedLoadMw: outcome.served_load_mw,
    controlledShedMw: outcome.controlled_shed_mw,
    involuntaryUnservedMw: outcome.involuntary_unserved_mw,
    totalUnservedMw: outcome.total_unserved_mw,
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
  const tone =
    label.toLowerCase().includes("lost") ||
    label.toLowerCase().includes("failed") ||
    value === "Impacted"
      ? "danger"
      : label.toLowerCase().includes("loading") || value === "Stable"
        ? "warning"
        : "default";

  return <MetricCard label={label} tone={tone} value={value} />;
}

function ControlRail({
  activeAction,
  onFindMitigation,
  onLoadPreset,
  onOperatingProfileChange,
  onPredictRisk,
  onRunCascade,
  onResetScenario,
  onSimulateFailure,
  operatingProfile,
  presets,
  selected,
  selectedPresetId,
}: {
  activeAction: ActiveAction;
  onFindMitigation: () => void;
  onLoadPreset: (preset: ApiDemoPreset) => void;
  onOperatingProfileChange: (profile: OperatingProfileKey) => void;
  onPredictRisk: () => void;
  onRunCascade: () => void;
  onResetScenario: () => void;
  onSimulateFailure: () => void;
  operatingProfile: OperatingProfileKey;
  presets: ApiDemoPreset[];
  selected: SelectedGridElement;
  selectedPresetId: string | null;
}) {
  const busy = activeAction !== null;
  const hasSelection = selected !== null;

  return (
    <aside className="grid content-start gap-4 bg-slate-950 p-4">
      <SectionPanel eyebrow="Scenario" title="Demo Controls">
        <DemoScenarioBar
          activeAction={activeAction}
          onLoadPreset={onLoadPreset}
          presets={presets}
          selectedPresetId={selectedPresetId}
        />
        <label className="mt-4 grid gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Operating Profile
          <select
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/70"
            onChange={(event) => onOperatingProfileChange(event.target.value as OperatingProfileKey)}
            value={operatingProfile}
          >
            <option value="baseline">Baseline</option>
            <option value="stressed">Stressed</option>
            <option value="critical">Critical Demo</option>
            <option value="severe">Severe</option>
          </select>
        </label>
      </SectionPanel>

      <SectionPanel eyebrow="Analysis" title="Actions">
        <div className="grid gap-2">
          <ActionButton
            disabled={!hasSelection || busy}
            onClick={onPredictRisk}
            title="Estimate cascade risk using the saved ML model"
            variant="primary"
          >
            {activeAction === "predict" ? "Predicting Risk..." : "Predict Risk"}
          </ActionButton>
          <ActionButton
            disabled={!hasSelection || busy}
            onClick={onRunCascade}
            title="Run the deterministic cascade simulation"
            variant="danger"
          >
            {activeAction === "cascade" ? "Running Cascade..." : "Run Cascade"}
          </ActionButton>
          <div className="grid grid-cols-2 gap-2">
            <ActionButton
              disabled={!hasSelection || busy}
              onClick={onSimulateFailure}
              title="Apply only the selected initial outage"
              variant="secondary"
            >
              {activeAction === "failure" ? "Simulating..." : "Failure"}
            </ActionButton>
            <ActionButton
              disabled={!hasSelection || busy}
              onClick={onFindMitigation}
              title="Evaluate mitigation candidates"
              variant="secondary"
            >
              {activeAction === "mitigation" ? "Finding..." : "Mitigate"}
            </ActionButton>
          </div>
          <ActionButton
            disabled={busy}
            onClick={onResetScenario}
            title="Return to the healthy baseline"
            variant="ghost"
          >
            {activeAction === "reset" ? "Resetting..." : "Reset Scenario"}
          </ActionButton>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          Select a grid element or load a preset before running analysis.
        </p>
      </SectionPanel>

      <SectionPanel eyebrow="Legend" title="Component Status">
        <div className="grid gap-2 text-sm text-slate-300">
          <StatusLegend label="Healthy" color="bg-emerald-400" />
          <StatusLegend label="Stressed" color="bg-amber-300" />
          <StatusLegend label="Overloaded" color="bg-red-400" />
          <StatusLegend label="Failed" color="bg-slate-500" />
          <StatusLegend label="Unsupplied" color="bg-slate-300" />
        </div>
      </SectionPanel>
    </aside>
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
    <div>
      <div className="grid gap-3">
        <div>
          <p className="text-xs leading-5 text-slate-500">
            Load a deterministic simulator-backed case for the presentation path.
          </p>
        </div>
        <div className="grid gap-2">
          {presets.map((preset) => (
            <button
              className={`rounded-md border px-3 py-2 text-left text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-60 ${
                preset.id === selectedPresetId
                  ? "border-cyan-400 bg-cyan-400 text-slate-950"
                  : "border-slate-700 bg-slate-900 text-slate-200 hover:border-cyan-400"
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
        <p className="mt-3 text-xs leading-5 text-slate-500">
          {presets.find((preset) => preset.id === selectedPresetId)?.summary}
        </p>
      ) : null}
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
  mitigatedCascade,
  mitigation,
  originalCascade,
  prediction,
  preset,
}: {
  mitigatedCascade: ApiCascadeResponse | null;
  mitigation: MitigationResult | null;
  originalCascade: ApiCascadeResponse | null;
  prediction: RiskPrediction | null;
  preset: ApiDemoPreset | null;
}) {
  if (!preset && !prediction && !originalCascade && !mitigation) {
    return null;
  }

  const bestRecommendation = mitigation?.recommendations[0] ?? null;

  return (
    <section className="border-b border-slate-800 bg-slate-900/80 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-50">Demo Result Summary</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {preset ? preset.name : "Current scenario"} comparison for prediction, actual cascade, and mitigation.
          </p>
        </div>
        {preset ? (
          <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-400">
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
            ["Cascade occurred", originalCascade ? (originalCascade.cascade_depth > 0 ? "Yes" : "No") : "Run cascade"],
            ["Actual load loss", originalCascade ? `${originalCascade.final_metrics.load_lost_percent.toFixed(1)}%` : "Run cascade"],
            ["Cascade depth", originalCascade ? originalCascade.cascade_depth.toString() : "Run cascade"],
            ["Failed lines", originalCascade ? originalCascade.final_metrics.failed_lines.toString() : "Run cascade"],
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
              "Controlled shed",
              mitigatedCascade
                ? `${mitigatedCascade.final_metrics.controlled_shed_mw.toFixed(1)} MW`
                : bestRecommendation
                  ? `${bestRecommendation.outcome.controlledShedMw.toFixed(1)} MW`
                  : "Find mitigation",
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
    <div className="rounded-md border border-slate-800 bg-slate-950/80 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {title}
      </h3>
      <dl className="mt-2 grid gap-2">
        {rows.map(([label, value]) => (
          <div className="grid gap-1 text-sm" key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="font-semibold text-slate-100">{value}</dd>
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
