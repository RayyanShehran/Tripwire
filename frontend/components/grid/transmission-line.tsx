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

  return (
    <>
      <BaseEdge
        id={id}
        markerEnd={markerEnd}
        path={edgePath}
        style={{
          stroke: styles.edge,
          strokeWidth: status === "Failed" ? 2 : 3,
          strokeDasharray: status === "Failed" ? "8 6" : undefined,
        }}
      />
      {data ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded border border-neutral-200 bg-white px-2 py-1 text-[10px] font-semibold text-neutral-700 shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {data.name} · {data.loadingPercent}% · {data.capacityMw} MW
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
