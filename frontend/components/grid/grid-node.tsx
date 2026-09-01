"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { statusStyles } from "./status";
import type { GridNodeData } from "./types";

type GridNodeProps = NodeProps & {
  data: GridNodeData;
};

function NodeShell({
  data,
  accent,
}: {
  data: GridNodeData;
  accent: string;
}) {
  const styles = statusStyles[data.status];

  return (
    <div
      className={`min-w-44 rounded border-2 ${styles.border} bg-white px-3 py-2 shadow-sm`}
    >
      <Handle className="!h-2.5 !w-2.5 !bg-neutral-500" position={Position.Left} type="target" />
      <Handle className="!h-2.5 !w-2.5 !bg-neutral-500" position={Position.Right} type="source" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-neutral-950">{data.name}</div>
          <div className="mt-0.5 text-xs font-medium text-neutral-500">{data.type}</div>
        </div>
        <div className={`h-3 w-3 rounded-full ${accent}`} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-neutral-700">
        <span>{data.voltageKv} p.u.</span>
        <span className={`rounded px-2 py-0.5 font-semibold ${styles.badge}`}>
          {data.status}
        </span>
      </div>
      {data.generationMw !== undefined ? (
        <div className="mt-2 text-xs text-neutral-700">
          Generation: <span className="font-semibold">{data.generationMw} MW</span>
        </div>
      ) : null}
      {data.loadMw !== undefined ? (
        <div className="mt-2 text-xs text-neutral-700">
          Load: <span className="font-semibold">{data.loadMw} MW</span>
        </div>
      ) : null}
    </div>
  );
}

export function GeneratorNode({ data }: GridNodeProps) {
  return <NodeShell accent="bg-sky-500" data={data} />;
}

export function BusNode({ data }: GridNodeProps) {
  return <NodeShell accent="bg-violet-500" data={data} />;
}

export function LoadNode({ data }: GridNodeProps) {
  return <NodeShell accent="bg-rose-500" data={data} />;
}
