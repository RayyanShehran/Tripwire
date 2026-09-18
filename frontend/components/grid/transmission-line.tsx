"use client";
import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getStraightPath, useStore, type EdgeProps } from "@xyflow/react";
import { TriangleAlert } from "lucide-react";
import { statusStyles } from "./status";
import type { GridLineData } from "./types";
import { useGridDisplayOptions } from "./grid-display";
export const TransmissionLine = memo(function TransmissionLine({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps & { data?: GridLineData }) {
  const zoom = useStore((state) => state.transform[2]);
  const display = useGridDisplayOptions();
  let [path, x, y] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const corridor = sourceX + (data?.routeSide === "left" ? -42 : 42);
  if (data?.routeSide) {
    path = `M ${sourceX} ${sourceY} H ${corridor} V ${targetY} H ${targetX}`;
    x = corridor;
    y = (sourceY + targetY) / 2;
  }
  const status = data?.status ?? "Healthy";
  const style = statusStyles[status];
  const connection = id.startsWith("connection-");
  const unsupplied = data?.isUnsupplied;
  const showId = display.showLineIds && (zoom >= 0.8 || selected);
  const showLoading = display.showLineLoading && zoom >= 0.55;
  const showCriticalState = status !== "Healthy" || unsupplied;
  const showLabel = !connection && data && (showId || showLoading || showCriticalState);
  const labelPosition = data?.labelPosition ?? { x, y };
  return <>
    {selected && <BaseEdge path={path} style={{ stroke: "var(--color-paper)", strokeWidth: 9 }} />}
    <BaseEdge id={id} path={path} interactionWidth={20} style={{
      stroke: unsupplied ? "var(--color-mid-gray)" : selected && status !== "Failed" ? "var(--color-ink)" : style.edge,
      strokeWidth: selected ? 4 : connection ? 1 : style.width,
      strokeDasharray: unsupplied ? "2 5" : style.dash, opacity: unsupplied ? .5 : 1,
    }} />
    {showLabel && <EdgeLabelRenderer>
      <div className={`edge-label nodrag nopan ${selected ? "is-selected" : ""} ${status === "Failed" && !unsupplied ? "danger" : ""}`}
        style={{ transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)` }}>
        {status === "Overloaded" && <TriangleAlert size={11} aria-hidden="true" />}
        {showId && <span className="edge-label-id">{id.replace("line-", "L")}</span>}
        {(showLoading || showCriticalState) && <strong>{unsupplied ? "Unsupplied" : data.loadingPercent == null ? status : `${data.loadingPercent.toFixed(0)}%`}</strong>}
      </div>
    </EdgeLabelRenderer>}
  </>;
});
