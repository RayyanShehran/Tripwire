"use client";
import { Activity, BarChart3, Box, Shield, ScanLine, ZapOff, Play } from "lucide-react";
import type { SelectedGridElement } from "./types";
import type { ApiGridMetrics } from "./api";
import { ActionButton } from "../ui/action-button";
import { StatusBadge } from "../ui/status-badge";
import { MetricCard } from "../ui/metric-card";
import { ProgressMeter } from "../ui/progress-meter";
export type CascadeSummary = {
  cascadeDepth: number;
  failedComponents: number;
  failedLines: number;
  loadLostPercent: number;
  terminationReason: string;
};

export type MitigatedCascadeSummary = CascadeSummary & {
  controlledShedMw: number;
  involuntaryUnservedMw: number;
  totalUnservedMw: number;
};

export type OperatingProfileKey = "baseline" | "stressed" | "critical" | "severe";
export type ActiveAction =
  | null
  | "predict"
  | "failure"
  | "cascade"
  | "mitigation"
  | "reset"
  | "recommendation";

export type RiskPrediction = {
  scenarioId: string;
  cascadeProbability: number;
  predictedLoadLostPercent: number;
  loadLossUncertainty: "low" | "moderate" | "high";
  riskLevel: string;
  modelVersion: string;
  actualCascadeOccurred?: boolean;
  actualLoadLostPercent?: number;
};

export type MitigationOutcome = {
  originalDemandMw: number;
  servedLoadMw: number;
  controlledShedMw: number;
  involuntaryUnservedMw: number;
  totalUnservedMw: number;
  loadLostPercent: number;
  cascadeDepth: number;
  failedLines: number;
  failedComponents: number;
  unservedLoadMw: number;
  terminationReason: string;
};

export type MitigationRecommendation = {
  rank: number;
  actionType: string;
  description: string;
  outcome: MitigationOutcome;
  improvement: {
    loadLossReductionPercentPoints: number;
    failedLinesReduced: number;
    failedComponentsReduced: number;
    cascadeDepthReduced: number;
    unservedLoadReductionMw: number;
  };
  score: number;
};

export type MitigationResult = {
  scenarioId: string;
  baseline: MitigationOutcome;
  recommendations: MitigationRecommendation[];
  summary: string;
  candidateCount: number;
  executionTimeMs: number;
};


export type PanelTab = "overview" | "prediction" | "component" | "mitigation";
type InfoPanelProps = {
  tab: PanelTab; onTabChange: (tab: PanelTab) => void; metrics: ApiGridMetrics | null; currentDepth: number; busy: boolean;
  originalCascadeSummary: CascadeSummary | null; mitigatedCascadeSummary: MitigatedCascadeSummary | null;
  mitigation: MitigationResult | null; prediction: RiskPrediction | null; selected: SelectedGridElement;
  selectedMitigation: MitigationRecommendation | null;
  onPredict: () => void; onFailure: () => void;
  onSimulateRecommendation: (recommendation: MitigationRecommendation) => void;
  mlPredictionAvailable?: boolean;
};
const tabs = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "prediction", label: "Prediction", icon: Activity },
  { id: "component", label: "Component", icon: Box },
  { id: "mitigation", label: "Mitigation", icon: Shield },
] as const;

export function InfoPanel(props: InfoPanelProps) {
  const { tab, onTabChange, metrics, currentDepth, prediction, selected, mitigation, busy } = props;
  return <aside className="inspector" aria-label="Scenario details">
    <div className="inspector-tabs" role="tablist" aria-label="Scenario details">
      {tabs.map(({ id, label, icon: Icon }, index) => <button key={id} role="tab" id={`tab-${id}`} aria-controls={`panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
        onClick={() => onTabChange(id)} onKeyDown={(event) => {
          const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
          if (next !== null) { event.preventDefault(); onTabChange(tabs[next].id); document.getElementById(`tab-${tabs[next].id}`)?.focus(); }
        }}><Icon size={15} aria-hidden="true" /><span>{label}</span></button>)}
    </div>
    <div className="inspector-content" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
      {tab === "overview" && <><PanelHeading title="System overview" subtitle="Current network state" />
        {metrics ? <><div className="overview-stats">
          <MetricCard label="Demand" value={mw(metrics.original_demand_mw)} />
          <MetricCard label="Served" value={mw(metrics.served_load_mw)} />
          <MetricCard label="Unserved" value={mw(metrics.total_unserved_mw)} />
          <MetricCard label="Load lost" value={percent(metrics.load_lost_percent)} />
          <MetricCard label="Max line load" value={percent(metrics.max_line_loading_percent)} />
          <MetricCard label="Cascade depth" value={String(currentDepth)} />
        </div><dl className="detail-rows"><Row label="Generation" value={mw(metrics.total_generation_mw)} /><Row label="Failed lines" value={String(metrics.failed_lines)} /><Row label="Failed components" value={String(metrics.failed_components)} /><Row label="Controlled shed" value={mw(metrics.controlled_shed_mw)} /><Row label="Involuntary unserved" value={mw(metrics.involuntary_unserved_mw)} /></dl></> : <EmptyState text="No grid data available" />}
      </>}
      {tab === "prediction" && <><PanelHeading title="Risk prediction" subtitle="Model estimate / pre-failure" />
        {!props.mlPredictionAvailable ? <EmptyState text="Unavailable for modified topology. The current model was trained on the built-in Tripwire network." /> : prediction ? <><div className="risk-value"><span className="eyebrow">Cascade risk</span><strong>{(prediction.cascadeProbability * 100).toFixed(0)}<small>%</small></strong><span className="badge">{prediction.riskLevel}</span></div>
          <ProgressMeter label="Cascade probability" value={prediction.cascadeProbability * 100} />
          <dl className="detail-rows"><Row label="Estimated load loss" value={`~${percent(prediction.predictedLoadLostPercent)}`} />
          <Row label="Model uncertainty" value={capitalize(prediction.loadLossUncertainty)} />
          {prediction.actualLoadLostPercent !== undefined && <Row label="Original actual loss" value={percent(prediction.actualLoadLostPercent)} />}</dl>
          <p className="model-note">Model {prediction.modelVersion}</p></> : <EmptyState text={busy ? "Estimating risk..." : "No prediction for this scenario"} />}
      </>}
      {tab === "component" && <><PanelHeading title={selected ? selected.item.data?.name ?? selected.item.id : "No component selected"} subtitle={selected ? selected.kind === "line" ? "Transmission line" : selected.item.data.type : "Component inspection"} />
        {selected && <><StatusBadge status={selected.item.data?.isUnsupplied ? "Unsupplied" : selected.item.data?.status ?? "Unknown"} />
          <dl className="detail-rows">{selected.kind === "line" ? <>
            <Row label="Loading" value={nullable(selected.item.data?.loadingPercent, "%")} />
            <Row label="Capacity" value={nullable(selected.item.data?.capacityMw, " MW")} />
            <Row label="Source" value={selected.item.source} /><Row label="Target" value={selected.item.target} />
          </> : <>
            <Row label="Voltage" value={nullable(selected.item.data.voltagePu, " p.u.")} />
            {selected.item.data.generationMw !== undefined && <Row label="Generation" value={mw(selected.item.data.generationMw)} />}
            {selected.item.data.loadMw !== undefined && <Row label="Load" value={mw(selected.item.data.loadMw)} />}
            <Row label="ID" value={selected.item.id} />
          </>}</dl>
          <div className="panel-actions"><ActionButton icon={<ScanLine />} disabled={busy || props.mlPredictionAvailable === false} title={props.mlPredictionAvailable === false ? "Prediction model supports only the built-in Tripwire network" : undefined} onClick={props.onPredict}>Predict Risk</ActionButton><ActionButton icon={<ZapOff />} variant="danger" disabled={busy} onClick={props.onFailure}>Simulate Failure</ActionButton></div>
        </>}
      </>}
      {tab === "mitigation" && <><PanelHeading title="Mitigation" subtitle="Simulation-based recommendations" />
        {mitigation ? <>
          <Comparison original={props.originalCascadeSummary} mitigated={props.mitigatedCascadeSummary} prediction={null} />
          <div className="recommendation-list">{mitigation.recommendations.length ? mitigation.recommendations.map((item) => <section className="recommendation" key={item.rank}>
            <div className="recommendation-heading"><span className="eyebrow">Recommendation {String(item.rank).padStart(2, "0")}</span>{props.selectedMitigation?.rank === item.rank && <span className="badge">Replayed</span>}</div>
            <h3>{item.description}</h3>
            <dl className="detail-rows"><Row label="Resulting load loss" value={percent(item.outcome.loadLostPercent)} /><Row label="Controlled shed" value={mw(item.outcome.controlledShedMw)} /><Row label="Involuntary unserved" value={mw(item.outcome.involuntaryUnservedMw)} /><Row label="Total unserved" value={mw(item.outcome.totalUnservedMw)} /><Row label="Failed lines" value={String(item.outcome.failedLines)} /><Row label="Cascade depth" value={String(item.outcome.cascadeDepth)} /><Row label="Load-loss reduction" value={`${item.improvement.loadLossReductionPercentPoints.toFixed(1)} pp`} /></dl>
            <ActionButton icon={<Play />} variant={item.rank === 1 ? "primary" : "ghost"} disabled={busy} onClick={() => props.onSimulateRecommendation(item)}>Simulate Recommendation</ActionButton>
          </section>) : <EmptyState text="No candidate reduced severity" />}</div>
          <p className="model-note">{mitigation.candidateCount} candidates / {mitigation.executionTimeMs.toFixed(0)} ms</p>
        </> : <EmptyState text={busy ? "Evaluating candidates..." : "No mitigation results"} />}
      </>}
      {tab !== "mitigation" && (prediction || props.originalCascadeSummary) && <details className="comparison-disclosure"><summary>Scenario comparison</summary><Comparison original={props.originalCascadeSummary} mitigated={props.mitigatedCascadeSummary} prediction={prediction} /></details>}
    </div>
    <footer className="inspector-footer">Research model / Not for operational use</footer>
  </aside>;
}
function PanelHeading({ title, subtitle }: { title: string; subtitle: string }) { return <header className="panel-heading"><p className="eyebrow">{subtitle}</p><h2>{title}</h2></header>; }
function EmptyState({ text }: { text: string }) { return <p className="empty-state" role="status">{text}</p>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="detail-row"><dt>{label}</dt><dd>{value}</dd></div>; }
function percent(value: number) { return `${value.toFixed(1)}%`; }
function mw(value: number) { return `${value.toFixed(1)} MW`; }
function nullable(value: number | null | undefined, unit: string) { return value == null ? "N/A" : `${value.toFixed(unit === " p.u." ? 3 : 1)}${unit}`; }
function capitalize(value: string) { return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
function Comparison({ original, mitigated, prediction }: { original: CascadeSummary | null; mitigated: MitigatedCascadeSummary | null; prediction: RiskPrediction | null }) {
  return <div className="comparison">
    {prediction && <section><h3 className="eyebrow">Prediction</h3><dl><Row label="Cascade risk" value={percent(prediction.cascadeProbability * 100)} /><Row label="Model loss estimate" value={`~${percent(prediction.predictedLoadLostPercent)}`} /></dl></section>}
    {original && <section><h3 className="eyebrow">Original cascade</h3><dl><Row label="Load lost" value={percent(original.loadLostPercent)} /><Row label="Failed lines" value={String(original.failedLines)} /><Row label="Cascade depth" value={String(original.cascadeDepth)} /></dl></section>}
    {mitigated && <section><h3 className="eyebrow">Mitigated</h3><dl><Row label="Total load lost" value={percent(mitigated.loadLostPercent)} /><Row label="Controlled shed" value={mw(mitigated.controlledShedMw)} /><Row label="Involuntary unserved" value={mw(mitigated.involuntaryUnservedMw)} /><Row label="Total unserved" value={mw(mitigated.totalUnservedMw)} /><Row label="Failed lines" value={String(mitigated.failedLines)} /><Row label="Cascade depth" value={String(mitigated.cascadeDepth)} /></dl></section>}
    {original && mitigated && <section className="improvement"><h3 className="eyebrow">Improvement</h3><strong>{(original.loadLostPercent - mitigated.loadLostPercent).toFixed(1)}<small> percentage points</small></strong><p className="muted">Load-loss reduction</p><dl><Row label="Failed lines prevented" value={String(original.failedLines - mitigated.failedLines)} /></dl></section>}
  </div>;
}
