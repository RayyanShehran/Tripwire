"use client";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import Link from "next/link";
import { Background, Controls, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CircleCheck, CircleX, Network, RotateCcw, LoaderCircle } from "lucide-react";
import { CascadeTimeline } from "./cascade-timeline";
import { InfoPanel, type PanelTab, type ActiveAction, type MitigationRecommendation, type MitigationResult, type OperatingProfileKey, type RiskPrediction } from "./info-panel";
import { fetchGrid, fetchDemoPresets, findMitigations, predictRisk, runCascade, simulateFailure, type ApiComponentType, type ApiDemoPreset, type ApiMitigationRecommendation, type ApiMitigationResponse, type ApiOperatingCondition, type ApiPredictionResponse } from "./api";
import { initialScenario, scenarioReducer, operatingConditions, type ScenarioInput } from "./scenario-state";
import { BusNode, GeneratorNode, LoadNode } from "./grid-node";
import { TransmissionLine } from "./transmission-line";
import { toFlowData } from "./flow-layout";
import { systemState } from "./presentation";
import { ScenarioControls } from "./scenario-controls";
import { NetworkTools } from "./network-tools";
import { StatusBadge } from "../ui/status-badge";
import { ActionButton } from "../ui/action-button";
import type { SelectedGridElement } from "./types";
const nodeTypes = { generator: GeneratorNode, bus: BusNode, load: LoadNode };
const edgeTypes = { transmissionLine: TransmissionLine };

export function GridVisualization() {
  const apiBaseUrl = normalizeApiUrl(process.env.NEXT_PUBLIC_API_URL);
  const [scenario, dispatch] = useReducer(scenarioReducer, undefined, initialScenario);
  const { originalCascadeResult, mitigatedCascadeResult } = scenario;
  const operatingProfile = scenario.input.profile;
  const selectedPresetId = scenario.input.presetId;
  const cascadeResult = scenario.view === "mitigated"
    ? mitigatedCascadeResult : scenario.view === "original" ? originalCascadeResult : null;
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [panelTab, setPanelTab] = useState<PanelTab>("overview");
  const [apiStatus, setApiStatus] = useState<"checking" | "connected" | "unavailable">("checking");
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [demoPresets, setDemoPresets] = useState<ApiDemoPreset[]>([]);
  const currentCascadeStep = cascadeResult?.steps[currentStepIndex] ?? null;
  const grid = currentCascadeStep?.grid
    ?? (scenario.view === "failure" ? scenario.failure?.grid : null)
    ?? scenario.baseline;
  const isLoading = !grid && !errorMessage;
  const failedIds = useMemo(() => cascadeResult
    ? cascadeResult.steps.slice(0, currentStepIndex + 1).flatMap((step) => step.newly_failed_components.map((item) => item.component_id))
    : scenario.view === "failure" && scenario.failure ? [scenario.failure.initial_failure.component_id] : [], [cascadeResult, currentStepIndex, scenario.view, scenario.failure]);
  const flowData = useMemo(() => grid ? toFlowData(grid, currentCascadeStep ?? undefined, failedIds) : { nodes: [], edges: [] }, [grid, currentCascadeStep, failedIds]);
  const [nodes, setNodes, onNodesChange] = useNodesState(flowData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowData.edges);
  const selected = useMemo<SelectedGridElement>(() => {
    const component = scenario.input.component;
    if (!component) return null;
    if (component.component_type === "line") {
      const item = flowData.edges.find((edge) => edge.id === component.component_id);
      return item ? { kind: "line", item } : null;
    }
    const item = flowData.nodes.find((node) => node.id === component.component_id);
    return item ? { kind: "node", item } : null;
  }, [scenario.input.component, flowData]);
  const prediction = useMemo(() => scenario.prediction ? {
    ...toRiskPrediction(scenario.prediction),
    ...(originalCascadeResult ? {
      actualCascadeOccurred: originalCascadeResult.cascade_depth > 0,
      actualLoadLostPercent: originalCascadeResult.final_metrics.load_lost_percent,
    } : {}),
  } : null, [scenario.prediction, originalCascadeResult]);
  const mitigation = scenario.recommendations ? toMitigationResult(scenario.recommendations) : null;
  const selectedMitigation = mitigation?.recommendations.find((item) => item.rank === scenario.selectedMitigationRank) ?? null;

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/health`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
        const payload = await response.json() as { status?: string };
        if (active) setApiStatus(response.ok && payload.status === "ok" ? "connected" : "unavailable");
      } catch { if (active) setApiStatus("unavailable"); }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [apiBaseUrl]);

  useEffect(() => {
    setNodes(flowData.nodes.map((node) => ({ ...node, selected: node.id === scenario.input.component?.component_id })));
    setEdges(flowData.edges.map((edge) => ({ ...edge, selected: edge.id === scenario.input.component?.component_id })));
  }, [flowData, scenario.input.component, setNodes, setEdges]);

  useEffect(() => {
    let active = true;
    fetchDemoPresets(apiBaseUrl).then((presets) => {
      if (active) setDemoPresets(presets);
    }).catch((error: unknown) => {
      if (active) setErrorMessage(error instanceof Error ? error.message : "Unable to load presets");
    });
    return () => { active = false; };
  }, [apiBaseUrl]);

  useEffect(() => {
    let active = true;
    fetchGrid(apiBaseUrl, scenario.input.condition).then((result) => {
      if (active) dispatch({ type: "baseline", result, revision: scenario.revision });
    }).catch((error: unknown) => {
      if (active) setErrorMessage(error instanceof Error ? error.message : "Unable to load scenario");
    });
    return () => { active = false; };
  }, [apiBaseUrl, scenario.input.condition, scenario.revision]);

  useEffect(() => {
    if (!isPlaying || !cascadeResult) return;
    const finalStepIndex = cascadeResult.steps.length - 1;
    if (currentStepIndex >= finalStepIndex) {
      setIsPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setCurrentStepIndex((index) => Math.min(index + 1, finalStepIndex)), 1000 / playbackSpeed);
    return () => window.clearTimeout(timer);
  }, [cascadeResult, currentStepIndex, isPlaying, playbackSpeed]);

  const configureScenario = useCallback((input: ScenarioInput) => {
    dispatch({ type: "configure", input });
    setCurrentStepIndex(0);
    setIsPlaying(false);
    setErrorMessage(null);
  }, []);

  const selectComponent = useCallback((component: ScenarioInput["component"]) => {
    if (activeAction || component?.component_id === scenario.input.component?.component_id) return;
    configureScenario({ ...scenario.input, component, presetId: null });
    setPanelTab(component ? "component" : "overview");
  }, [activeAction, scenario.input, configureScenario]);

  const handleLoadPreset = useCallback((preset: ApiDemoPreset) => {
    configureScenario({
      presetId: preset.id, profile: profileForCondition(preset.operating_condition),
      condition: preset.operating_condition, component: preset.initial_failure,
    });
  }, [configureScenario]);

  const handleOperatingProfileChange = useCallback((profile: OperatingProfileKey) => {
    configureScenario({ ...scenario.input, profile, condition: operatingConditions[profile], presetId: null });
  }, [configureScenario, scenario.input]);

  const handleResetScenario = useCallback(() => {
    dispatch({ type: "reset" });
    setPanelTab("overview");
    setCurrentStepIndex(0);
    setIsPlaying(false);
    setErrorMessage(null);
  }, []);

  const runScenarioAction = useCallback(async (action: "predict" | "failure" | "cascade" | "mitigation") => {
    const { component, condition, presetId } = scenario.input;
    if (!component || activeAction || !scenario.baseline) return;
    const revision = scenario.revision;
    setActiveAction(action);
    setPanelTab(action === "predict" ? "prediction" : action === "mitigation" ? "mitigation" : "overview");
    setIsPlaying(false);
    setErrorMessage(null);
    try {
      const args = [apiBaseUrl, component.component_type, component.component_id, condition, presetId] as const;
      if (action === "predict") {
        dispatch({ type: "prediction", result: await predictRisk(...args), revision });
      } else if (action === "failure") {
        dispatch({ type: "failure", result: await simulateFailure(...args), revision });
      } else if (action === "cascade") {
        const result = await runCascade(...args);
        dispatch({ type: "cascade", result, revision });
        setCurrentStepIndex(0);
      } else {
        dispatch({ type: "recommendations", result: await findMitigations(...args), revision });
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to run scenario");
    } finally {
      setActiveAction(null);
    }
  }, [activeAction, apiBaseUrl, scenario]);

  const handlePredictRisk = () => { void runScenarioAction("predict"); };
  const handleSimulateFailure = () => { void runScenarioAction("failure"); };
  const handleRunCascade = () => { void runScenarioAction("cascade"); };
  const handleFindMitigation = () => { void runScenarioAction("mitigation"); };
  const handleSimulateRecommendation = (recommendation: MitigationRecommendation) => {
    if (activeAction) return;
    dispatch({ type: "replay", rank: recommendation.rank });
    setCurrentStepIndex(0);
    setIsPlaying(false);
  };

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

  const system = systemState(grid, cascadeResult, currentStepIndex, activeAction === "cascade");
  const scenarioName = demoPresets.find((preset) => preset.id === selectedPresetId)?.name ?? (operatingProfile === "baseline" ? "Baseline network" : `${operatingProfile[0].toUpperCase()}${operatingProfile.slice(1)} scenario`);
  return <ReactFlowProvider>
    <header className="topbar">
      <Link className="brand" href="/" aria-label="Tripwire home"><Network aria-hidden="true" /><div><h1>TRIPWIRE</h1><p>Grid Cascade Intelligence</p></div></Link>
      <div className="header-scenario"><span className="eyebrow">Scenario</span><span>{scenarioName}</span></div>
      <div className="header-status" aria-live="polite"><span className="eyebrow">System</span><StatusBadge status={system} /></div>
      <div className="api-status" role="status">{apiStatus === "connected" ? <CircleCheck size={14} aria-hidden="true" /> : apiStatus === "checking" ? <LoaderCircle size={14} aria-hidden="true" /> : <CircleX size={14} aria-hidden="true" />}<span>API {apiStatus}</span></div>
      <ActionButton icon={<RotateCcw />} disabled={activeAction !== null} onClick={handleResetScenario} variant="ghost" title="Reset profile, selection, and results">Reset</ActionButton>
    </header>
    <main className="workspace">
      <ScenarioControls activeAction={activeAction} input={scenario.input} selected={selected} presets={demoPresets}
        onLoadPreset={handleLoadPreset} onProfileChange={handleOperatingProfileChange}
        onConditionChange={(condition) => configureScenario({ ...scenario.input, condition, presetId: null })}
        onClear={() => selectComponent(null)} onPredict={handlePredictRisk} onFailure={handleSimulateFailure} onCascade={handleRunCascade} onMitigation={handleFindMitigation} />
      <div className="workspace-center">
        <section className="network-frame" aria-label="Power network">
          <header className="network-header"><div><h2>Power Network</h2><p className="muted">{grid ? `${grid.nodes.filter((node) => node.type === "bus").length} buses / ${grid.lines.length} transmission lines` : "Transmission network"}<span className="view-label">{scenario.view === "mitigated" ? "Mitigated replay" : scenario.view === "original" ? "Original cascade" : scenario.view === "failure" ? "Single failure" : "Pre-failure"}</span></p></div><NetworkTools disabled={!grid} /></header>
          {errorMessage && <div className="error-banner" role="alert">{errorMessage}<button className="button button-ghost icon-button" onClick={() => configureScenario({ ...scenario.input })} title="Retry loading the scenario" aria-label="Retry loading the scenario"><RotateCcw /></button></div>}
          <div className="network-canvas">
            {!grid ? <div className="state-message" role="status">{isLoading ? <LoaderCircle size={24} className="loading-icon" aria-hidden="true" /> : <CircleX size={24} aria-hidden="true" />}<h3>{isLoading ? "Loading network" : "Network unavailable"}</h3></div> :
              <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: .08 }} minZoom={.2} maxZoom={1.8}
                nodesConnectable={false} nodesDraggable={false} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
                onNodeClick={(_, node) => selectComponent({ component_type: node.type as ApiComponentType, component_id: node.id })}
                onEdgeClick={(_, edge) => { if (!edge.id.startsWith("connection-")) selectComponent({ component_type: "line", component_id: edge.id }); }}>
                <Background color="var(--color-hairline)" gap={20} size={1} />
                <Controls showInteractive={false} />
              </ReactFlow>}
          </div>
          <footer className="network-legend" aria-label="Network status legend">{["Healthy", "Stressed", "Overloaded", "Failed", "Unsupplied"].map((status) => <span key={status}><i className={`legend-line legend-${status.toLowerCase()}`} />{status}</span>)}</footer>
        </section>
        <CascadeTimeline cascade={cascadeResult} currentStepIndex={currentStepIndex} isPlaying={isPlaying} onNextStep={handleNextStep} onPlaybackSpeedChange={setPlaybackSpeed} onPreviousStep={handlePreviousStep} onSelectStep={handleSelectStep} onTogglePlayback={handleTogglePlayback} playbackSpeed={playbackSpeed} />
      </div>
      <InfoPanel tab={panelTab} onTabChange={setPanelTab} metrics={grid?.metrics ?? null} currentDepth={currentCascadeStep?.step ?? 0} busy={activeAction !== null}
        originalCascadeSummary={originalCascadeResult ? { cascadeDepth: originalCascadeResult.cascade_depth, failedComponents: originalCascadeResult.final_metrics.failed_components, failedLines: originalCascadeResult.final_metrics.failed_lines, loadLostPercent: originalCascadeResult.final_metrics.load_lost_percent, terminationReason: originalCascadeResult.termination_reason } : null}
        mitigatedCascadeSummary={mitigatedCascadeResult ? { cascadeDepth: mitigatedCascadeResult.cascade_depth, failedComponents: mitigatedCascadeResult.final_metrics.failed_components, failedLines: mitigatedCascadeResult.final_metrics.failed_lines, loadLostPercent: mitigatedCascadeResult.final_metrics.load_lost_percent, terminationReason: mitigatedCascadeResult.termination_reason, controlledShedMw: mitigatedCascadeResult.final_metrics.controlled_shed_mw, involuntaryUnservedMw: mitigatedCascadeResult.final_metrics.involuntary_unserved_mw, totalUnservedMw: mitigatedCascadeResult.final_metrics.total_unserved_mw } : null}
        mitigation={mitigation} prediction={prediction} selected={selected} selectedMitigation={selectedMitigation}
        onPredict={handlePredictRisk} onFailure={handleSimulateFailure} onSimulateRecommendation={handleSimulateRecommendation} />
    </main>
  </ReactFlowProvider>;
}

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
