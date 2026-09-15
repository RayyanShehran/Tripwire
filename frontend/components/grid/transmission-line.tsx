"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

import { statusStyles } from "./status";
import type { GridLineData } from "./types";

type TransmissionLineProps = EdgeProps & {
  data?: GridLineData;
};

export function TransmissionLine({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: TransmissionLineProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const status = data?.status ?? "Healthy";
  const styles = statusStyles[status];
  const isEmphasized = data?.isNewlyFailed || data?.isCurrentlyOverloaded;

  return (
    <>
      <BaseEdge
        id={id}
        markerEnd={markerEnd}
        path={edgePath}
        style={{
          stroke: styles.edge,
          strokeWidth: isEmphasized ? 4.5 : status === "Failed" ? 2 : 2.6,
          strokeDasharray: status === "Failed" ? "7 6" : undefined,
          opacity: status === "Failed" ? 0.55 : 0.9,
        }}
      />
      {data && data.capacityMw !== null && data.capacityMw > 0 ? (
        <EdgeLabelRenderer>
          <div
            className={`nodrag nopan pointer-events-none absolute rounded border px-2 py-1 text-[10px] font-semibold shadow-lg shadow-black/30 ${
              isEmphasized
                ? "border-red-400/70 bg-red-950/90 text-red-100"
                : "border-slate-700 bg-slate-950/90 text-slate-200"
            }`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {formatNullableValue(data.loadingPercent, "%")} · {data.capacityMw} MW
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function formatNullableValue(value: number | null, suffix: string) {
  return value === null ? "N/A" : `${value}${suffix}`;
}
