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
          strokeWidth: isEmphasized ? 5 : status === "Failed" ? 2 : 3,
          strokeDasharray: status === "Failed" ? "8 6" : undefined,
        }}
      />
      {data && data.capacityMw !== null && data.capacityMw > 0 ? (
        <EdgeLabelRenderer>
          <div
            className={`nodrag nopan pointer-events-none absolute rounded border bg-white px-2 py-1 text-[10px] font-semibold shadow-sm ${
              isEmphasized
                ? "border-red-300 text-red-800"
                : "border-neutral-200 text-neutral-700"
            }`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {data.name} · {formatNullableValue(data.loadingPercent, "%")} · {data.capacityMw} MW
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function formatNullableValue(value: number | null, suffix: string) {
  return value === null ? "N/A" : `${value}${suffix}`;
}
