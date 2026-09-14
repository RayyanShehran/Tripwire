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
  isMutating: boolean;
  onResetScenario: () => void;
  onSimulateFailure: () => void;
  selected: SelectedGridElement;
};

export function InfoPanel({
  isMutating,
  onResetScenario,
  onSimulateFailure,
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
          isMutating={isMutating}
          onResetScenario={onResetScenario}
          onSimulateFailure={onSimulateFailure}
        />
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
          isMutating={isMutating}
          onResetScenario={onResetScenario}
          onSimulateFailure={onSimulateFailure}
        />
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
        isMutating={isMutating}
        onResetScenario={onResetScenario}
        onSimulateFailure={onSimulateFailure}
      />
    </aside>
  );
}

function formatNullableValue(value: number | null, suffix: string) {
  return value === null ? "N/A" : `${value}${suffix}`;
}

function PanelActions({
  canSimulate,
  isMutating,
  onResetScenario,
  onSimulateFailure,
}: {
  canSimulate: boolean;
  isMutating: boolean;
  onResetScenario: () => void;
  onSimulateFailure: () => void;
}) {
  return (
    <div className="mt-6 grid gap-2">
      <button
        className="rounded bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
        disabled={!canSimulate || isMutating}
        onClick={onSimulateFailure}
        type="button"
      >
        Simulate Failure
      </button>
      <button
        className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-400"
        disabled={isMutating}
        onClick={onResetScenario}
        type="button"
      >
        Reset Scenario
      </button>
    </div>
  );
}
