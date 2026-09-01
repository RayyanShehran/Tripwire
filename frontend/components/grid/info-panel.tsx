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

export function InfoPanel({ selected }: { selected: SelectedGridElement }) {
  if (!selected) {
    return (
      <aside className="h-full border-l border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-neutral-950">Selection</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          Select a generator, bus, load, or transmission line to inspect its
          current solved operating state.
        </p>
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
          <Row label="Voltage" value={`${node.data.voltageKv} p.u.`} />
          {node.data.generationMw !== undefined ? (
            <Row label="Generation" value={`${node.data.generationMw} MW`} />
          ) : null}
          {node.data.loadMw !== undefined ? (
            <Row label="Load" value={`${node.data.loadMw} MW`} />
          ) : null}
        </dl>
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
          value={`${line.data?.loadingPercent ?? 0}%`}
        />
        <Row label="Capacity" value={`${line.data?.capacityMw ?? 0} MW`} />
        <Row label="Source" value={line.source} />
        <Row label="Target" value={line.target} />
      </dl>
    </aside>
  );
}
