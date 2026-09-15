"use client";

import type { SelectedGridElement } from "./types";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-neutral-100 py-3 text-sm last:border-0">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right font-semibold text-neutral-900">{value}</dd>
    </div>
  );
}

type InfoPanelProps = {
  cascadeSummary: CascadeSummary | null;
  isMutating: boolean;
  isPredicting: boolean;
  onOperatingProfileChange: (profile: OperatingProfileKey) => void;
  onPredictRisk: () => void;
  onRunCascade: () => void;
  onResetScenario: () => void;
  onSimulateFailure: () => void;
  operatingProfile: OperatingProfileKey;
  prediction: RiskPrediction | null;
  selected: SelectedGridElement;
};

export type CascadeSummary = {
  cascadeDepth: number;
  failedComponents: number;
  loadLostPercent: number;
  terminationReason: string;
};

export type OperatingProfileKey = "baseline" | "stressed" | "severe";

export type RiskPrediction = {
  cascadeProbability: number;
  predictedLoadLostPercent: number;
  riskLevel: string;
  modelVersion: string;
  actualCascadeOccurred?: boolean;
  actualLoadLostPercent?: number;
};

export function InfoPanel({
  cascadeSummary,
  isMutating,
  isPredicting,
  onOperatingProfileChange,
  onPredictRisk,
  onRunCascade,
  onResetScenario,
  onSimulateFailure,
  operatingProfile,
  prediction,
  selected,
}: InfoPanelProps) {
  if (!selected) {
    return (
      <aside className="h-full border-l border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-neutral-950">Selection</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          Select a generator, bus, load, or transmission line to inspect its
          current solved operating state.
        </p>
        <PanelActions
          canSimulate={false}
          canRunCascade={false}
          canPredict={false}
          isMutating={isMutating}
          isPredicting={isPredicting}
          onOperatingProfileChange={onOperatingProfileChange}
          onPredictRisk={onPredictRisk}
          onRunCascade={onRunCascade}
          onResetScenario={onResetScenario}
          onSimulateFailure={onSimulateFailure}
          operatingProfile={operatingProfile}
        />
        <PredictionPanel prediction={prediction} />
        <CascadeSummaryPanel summary={cascadeSummary} />
      </aside>
    );
  }

  if (selected.kind === "node") {
    const node = selected.item;

    return (
      <aside className="h-full border-l border-neutral-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
          Node
        </p>
        <h2 className="mt-1 text-lg font-semibold text-neutral-950">
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
        <PanelActions
          canSimulate
          canRunCascade
          canPredict
          isMutating={isMutating}
          isPredicting={isPredicting}
          onOperatingProfileChange={onOperatingProfileChange}
          onPredictRisk={onPredictRisk}
          onRunCascade={onRunCascade}
          onResetScenario={onResetScenario}
          onSimulateFailure={onSimulateFailure}
          operatingProfile={operatingProfile}
        />
        <PredictionPanel prediction={prediction} />
        <CascadeSummaryPanel summary={cascadeSummary} />
      </aside>
    );
  }

  const line = selected.item;

  return (
    <aside className="h-full border-l border-neutral-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
        Transmission Line
      </p>
      <h2 className="mt-1 text-lg font-semibold text-neutral-950">
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
      <PanelActions
        canSimulate
        canRunCascade
        canPredict
        isMutating={isMutating}
        isPredicting={isPredicting}
        onOperatingProfileChange={onOperatingProfileChange}
        onPredictRisk={onPredictRisk}
        onRunCascade={onRunCascade}
        onResetScenario={onResetScenario}
        onSimulateFailure={onSimulateFailure}
        operatingProfile={operatingProfile}
      />
      <PredictionPanel prediction={prediction} />
      <CascadeSummaryPanel summary={cascadeSummary} />
    </aside>
  );
}

function formatNullableValue(value: number | null, suffix: string) {
  return value === null ? "N/A" : `${value}${suffix}`;
}

function PanelActions({
  canRunCascade,
  canSimulate,
  canPredict,
  isMutating,
  isPredicting,
  onOperatingProfileChange,
  onPredictRisk,
  onRunCascade,
  onResetScenario,
  onSimulateFailure,
  operatingProfile,
}: {
  canRunCascade: boolean;
  canSimulate: boolean;
  canPredict: boolean;
  isMutating: boolean;
  isPredicting: boolean;
  onOperatingProfileChange: (profile: OperatingProfileKey) => void;
  onPredictRisk: () => void;
  onRunCascade: () => void;
  onResetScenario: () => void;
  onSimulateFailure: () => void;
  operatingProfile: OperatingProfileKey;
}) {
  return (
    <div className="mt-6 grid gap-2">
      <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Prediction profile
        <select
          className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-neutral-900"
          onChange={(event) => onOperatingProfileChange(event.target.value as OperatingProfileKey)}
          value={operatingProfile}
        >
          <option value="baseline">Baseline</option>
          <option value="stressed">Stressed</option>
          <option value="severe">Severe</option>
        </select>
      </label>
      <button
        className="rounded border border-red-700 bg-white px-3 py-2 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:text-neutral-400"
        disabled={!canPredict || isMutating || isPredicting}
        onClick={onPredictRisk}
        type="button"
      >
        {isPredicting ? "Predicting..." : "Predict Risk"}
      </button>
      <button
        className="rounded bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
        disabled={!canSimulate || isMutating}
        onClick={onSimulateFailure}
        type="button"
      >
        Simulate Failure
      </button>
      <button
        className="rounded bg-neutral-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
        disabled={!canRunCascade || isMutating}
        onClick={onRunCascade}
        type="button"
      >
        Run Cascade
      </button>
      <button
        className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-400"
        disabled={isMutating}
        onClick={onResetScenario}
        type="button"
      >
        Return to Baseline
      </button>
    </div>
  );
}

function PredictionPanel({ prediction }: { prediction: RiskPrediction | null }) {
  if (!prediction) {
    return null;
  }

  return (
    <div className="mt-6 rounded border border-neutral-200 bg-neutral-50 p-4">
      <h3 className="text-sm font-semibold text-neutral-950">Cascade Risk</h3>
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
        <div className="mt-4 border-t border-neutral-200 pt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
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
    <div className="mt-6 rounded border border-neutral-200 bg-neutral-50 p-4">
      <h3 className="text-sm font-semibold text-neutral-950">Cascade Result</h3>
      <dl className="mt-3">
        <Row label="Termination" value={formatReason(summary.terminationReason)} />
        <Row label="Depth" value={summary.cascadeDepth.toString()} />
        <Row label="Load lost" value={`${summary.loadLostPercent.toFixed(1)}%`} />
        <Row label="Failed components" value={summary.failedComponents.toString()} />
      </dl>
    </div>
  );
}

function formatReason(reason: string) {
  return reason.replaceAll("_", " ");
}
