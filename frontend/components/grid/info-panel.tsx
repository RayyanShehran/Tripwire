"use client";

import type { SelectedGridElement } from "./types";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-800 py-2.5 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-100">{value}</dd>
    </div>
  );
}

type InfoPanelProps = {
  cascadeSummary: CascadeSummary | null;
  mitigation: MitigationResult | null;
  onSimulateRecommendation: (recommendation: MitigationRecommendation) => void;
  prediction: RiskPrediction | null;
  selected: SelectedGridElement;
};

export type CascadeSummary = {
  cascadeDepth: number;
  failedComponents: number;
  loadLostPercent: number;
  terminationReason: string;
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
  cascadeProbability: number;
  predictedLoadLostPercent: number;
  riskLevel: string;
  modelVersion: string;
  actualCascadeOccurred?: boolean;
  actualLoadLostPercent?: number;
};

export type MitigationOutcome = {
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
  baseline: MitigationOutcome;
  recommendations: MitigationRecommendation[];
  summary: string;
  candidateCount: number;
  executionTimeMs: number;
};

export function InfoPanel({
  cascadeSummary,
  mitigation,
  onSimulateRecommendation,
  prediction,
  selected,
}: InfoPanelProps) {
  if (!selected) {
    return (
      <aside className="h-full border-l border-slate-800 bg-slate-950 p-5">
        <h2 className="text-lg font-semibold text-slate-50">Selection</h2>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          Select a generator, bus, load, or transmission line to inspect its
          current solved operating state.
        </p>
        <PredictionPanel prediction={prediction} />
        <MitigationPanel
          mitigation={mitigation}
          onSimulateRecommendation={onSimulateRecommendation}
        />
        <CascadeSummaryPanel summary={cascadeSummary} />
        <HelpPanel />
        <MethodologyPanel />
      </aside>
    );
  }

  if (selected.kind === "node") {
    const node = selected.item;

    return (
      <aside className="h-full border-l border-slate-800 bg-slate-950 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">
          Node
        </p>
        <h2 className="mt-1 text-lg font-semibold text-slate-50">
        {node.data.name}
        </h2>
        <dl className="mt-5">
          <Row label="Type" value={node.data.type} />
          <Row label="Status" value={node.data.status} />
          <Row label="Voltage" value={formatNullableValue(node.data.voltagePu, " p.u.")} />
          {node.data.generationMw !== undefined ? (
            <Row label="Generation" value={`${node.data.generationMw} MW`} />
          ) : null}
          {node.data.loadMw !== undefined ? (
            <Row label="Load" value={`${node.data.loadMw} MW`} />
          ) : null}
        </dl>
        <PredictionPanel prediction={prediction} />
        <MitigationPanel
          mitigation={mitigation}
          onSimulateRecommendation={onSimulateRecommendation}
        />
        <CascadeSummaryPanel summary={cascadeSummary} />
        <HelpPanel />
        <MethodologyPanel />
      </aside>
    );
  }

  const line = selected.item;

  return (
    <aside className="h-full border-l border-slate-800 bg-slate-950 p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">
        Transmission Line
      </p>
      <h2 className="mt-1 text-lg font-semibold text-slate-50">
        {line.data?.name ?? line.id}
      </h2>
      <dl className="mt-5">
        <Row label="Status" value={line.data?.status ?? "Unknown"} />
        <Row
          label="Loading"
          value={formatNullableValue(line.data?.loadingPercent ?? null, "%")}
        />
        <Row label="Capacity" value={formatNullableValue(line.data?.capacityMw ?? null, " MW")} />
        <Row label="Source" value={line.source} />
        <Row label="Target" value={line.target} />
      </dl>
      <PredictionPanel prediction={prediction} />
      <MitigationPanel
        mitigation={mitigation}
        onSimulateRecommendation={onSimulateRecommendation}
      />
      <CascadeSummaryPanel summary={cascadeSummary} />
      <HelpPanel />
      <MethodologyPanel />
    </aside>
  );
}

function formatNullableValue(value: number | null, suffix: string) {
  return value === null ? "N/A" : `${value}${suffix}`;
}

function MitigationPanel({
  mitigation,
  onSimulateRecommendation,
}: {
  mitigation: MitigationResult | null;
  onSimulateRecommendation: (recommendation: MitigationRecommendation) => void;
}) {
  if (!mitigation) {
    return null;
  }

  return (
    <div className="mt-6 rounded-md border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="text-sm font-semibold text-slate-50">
        Recommended Based on Tripwire Simulation
      </h3>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        {mitigation.summary}
      </p>
      <dl className="mt-3">
        <Row label="Baseline load lost" value={`${mitigation.baseline.loadLostPercent.toFixed(1)}%`} />
        <Row label="Baseline failed lines" value={mitigation.baseline.failedLines.toString()} />
        <Row label="Candidates tested" value={mitigation.candidateCount.toString()} />
        <Row label="Runtime" value={`${mitigation.executionTimeMs.toFixed(0)} ms`} />
      </dl>
      <div className="mt-4 grid gap-3">
        {mitigation.recommendations.length === 0 ? (
          <p className="text-sm text-slate-500">
            No bounded candidate reduced the simulated severity.
          </p>
        ) : (
          mitigation.recommendations.map((recommendation) => (
            <div
              className="rounded-md border border-slate-800 bg-slate-950 p-3"
              key={`${recommendation.rank}-${recommendation.description}`}
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-cyan-300">
                Action #{recommendation.rank}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-50">
                {formatActionType(recommendation.actionType)}
              </div>
              <p className="mt-1 text-sm leading-5 text-slate-500">
                {recommendation.description}
              </p>
              <dl className="mt-2">
                <Row
                  label="Load lost"
                  value={`${mitigation.baseline.loadLostPercent.toFixed(1)}% -> ${recommendation.outcome.loadLostPercent.toFixed(1)}%`}
                />
                <Row
                  label="Cascade depth"
                  value={`${mitigation.baseline.cascadeDepth} -> ${recommendation.outcome.cascadeDepth}`}
                />
                <Row
                  label="Failed lines"
                  value={`${mitigation.baseline.failedLines} -> ${recommendation.outcome.failedLines}`}
                />
                <Row
                  label="Improvement"
                  value={`${recommendation.improvement.loadLossReductionPercentPoints.toFixed(1)} pts`}
                />
              </dl>
              <button
                className="mt-3 w-full rounded-md bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950"
                onClick={() => onSimulateRecommendation(recommendation)}
                type="button"
              >
                Simulate Recommendation
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PredictionPanel({ prediction }: { prediction: RiskPrediction | null }) {
  if (!prediction) {
    return null;
  }

  return (
    <div className="mt-6 rounded-md border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="text-sm font-semibold text-slate-50">Cascade Risk</h3>
      <dl className="mt-3">
        <Row
          label="Probability"
          value={`${(prediction.cascadeProbability * 100).toFixed(0)}%`}
        />
        <Row
          label="Predicted load loss"
          value={`${prediction.predictedLoadLostPercent.toFixed(1)}%`}
        />
        <Row label="Risk" value={prediction.riskLevel} />
      </dl>
      {prediction.actualCascadeOccurred !== undefined ? (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Prediction vs Actual
          </h4>
          <dl className="mt-2">
            <Row
              label="Actual cascade"
              value={prediction.actualCascadeOccurred ? "Yes" : "No"}
            />
            <Row
              label="Actual load loss"
              value={`${(prediction.actualLoadLostPercent ?? 0).toFixed(1)}%`}
            />
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function CascadeSummaryPanel({ summary }: { summary: CascadeSummary | null }) {
  if (!summary) {
    return null;
  }

  return (
    <div className="mt-6 rounded-md border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="text-sm font-semibold text-slate-50">Cascade Result</h3>
      <dl className="mt-3">
        <Row label="Termination" value={formatReason(summary.terminationReason)} />
        <Row label="Depth" value={summary.cascadeDepth.toString()} />
        <Row label="Load lost" value={`${summary.loadLostPercent.toFixed(1)}%`} />
        <Row label="Failed components" value={summary.failedComponents.toString()} />
      </dl>
    </div>
  );
}

function HelpPanel() {
  return (
    <div className="mt-6 rounded-md border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="text-sm font-semibold text-slate-50">Terms</h3>
      <dl className="mt-3 grid gap-3 text-sm">
        <HelpTerm
          term="Line loading"
          definition="Percent of a transmission line capacity currently used."
        />
        <HelpTerm
          term="Unserved load"
          definition="Customer demand disconnected by outages or islanding."
        />
        <HelpTerm
          term="Cascade depth"
          definition="Number of secondary failure rounds after the initial outage."
        />
        <HelpTerm
          term="Cascade probability"
          definition="ML estimate that an initial failure will trigger secondary failures."
        />
        <HelpTerm
          term="Reserve margin"
          definition="Available generation capacity above current demand."
        />
        <HelpTerm
          term="Mitigation"
          definition="A simulated action that reduces load loss or failed components."
        />
      </dl>
    </div>
  );
}

function HelpTerm({ definition, term }: { definition: string; term: string }) {
  return (
    <div>
      <dt className="font-semibold text-slate-200">{term}</dt>
      <dd className="mt-1 leading-5 text-slate-500">{definition}</dd>
    </div>
  );
}

function MethodologyPanel() {
  return (
    <div className="mt-6 rounded-md border border-slate-800 bg-slate-950 p-4">
      <h3 className="text-sm font-semibold text-slate-50">About Tripwire</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        Tripwire combines pandapower power-flow simulation, deterministic
        cascading-failure modeling, synthetic scenario generation, ML risk
        prediction, and simulation-based mitigation evaluation.
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-600">
        Limitations: synthetic grid, synthetic training data, not utility
        validated, and not intended for operational deployment.
      </p>
    </div>
  );
}

function formatReason(reason: string) {
  return reason.replaceAll("_", " ");
}

function formatActionType(actionType: string) {
  return actionType.replaceAll("_", " ");
}
