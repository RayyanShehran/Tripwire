"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { statusStyles } from "./status";
import type { GridNodeData } from "./types";
import { StatusBadge } from "../ui/status-badge";

type GridNodeProps = NodeProps & {
  data: GridNodeData;
};

function NodeShell({
  data,
  accent,
  code,
}: {
  data: GridNodeData;
  accent: string;
  code: string;
}) {
  const styles = statusStyles[data.status];

  return (
    <div
      className={`min-w-44 rounded-md border ${styles.border} bg-slate-950/95 px-3 py-2.5 shadow-xl shadow-black/30 ${
        data.isNewlyFailed ? "ring-2 ring-red-400 ring-offset-2 ring-offset-slate-950" : ""
      }`}
    >
      <Handle className="!h-2.5 !w-2.5 !border !border-slate-950 !bg-cyan-300" position={Position.Left} type="target" />
      <Handle className="!h-2.5 !w-2.5 !border !border-slate-950 !bg-cyan-300" position={Position.Right} type="source" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border text-[10px] font-bold tracking-wide ${accent}`}>
            {code}
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-50">{data.name}</div>
            <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{data.type}</div>
          </div>
        </div>
        <StatusBadge status={data.status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <NodeValue label="Voltage" value={formatValue(data.voltagePu, " p.u.")} />
        {data.generationMw !== undefined ? (
          <NodeValue label="Output" value={`${data.generationMw} MW`} />
        ) : data.loadMw !== undefined ? (
          <NodeValue label="Demand" value={`${data.loadMw} MW`} />
        ) : (
          <NodeValue label="Role" value="Bus" />
        )}
      </div>
    </div>
  );
}

export function GeneratorNode({ data }: GridNodeProps) {
  return <NodeShell accent="border-cyan-400/50 bg-cyan-400/10 text-cyan-100" code="GEN" data={data} />;
}

export function BusNode({ data }: GridNodeProps) {
  return <NodeShell accent="border-indigo-300/40 bg-indigo-300/10 text-indigo-100" code="BUS" data={data} />;
}

export function LoadNode({ data }: GridNodeProps) {
  return <NodeShell accent="border-amber-300/40 bg-amber-300/10 text-amber-100" code="LD" data={data} />;
}

function NodeValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/80 px-2 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-0.5 font-semibold tabular-nums text-slate-100">{value}</div>
    </div>
  );
}

function formatValue(value: number | null, suffix: string) {
  return value === null ? "N/A" : `${value}${suffix}`;
}
