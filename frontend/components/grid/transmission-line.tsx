"use client";
import { BaseEdge, EdgeLabelRenderer, getStraightPath, type EdgeProps } from "@xyflow/react";
import { TriangleAlert } from "lucide-react";
import { statusStyles } from "./status";
import type { GridLineData } from "./types";
export function TransmissionLine({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps & { data?: GridLineData }) {
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
  return <>
    {selected && <BaseEdge path={path} style={{ stroke: "var(--color-paper)", strokeWidth: 9 }} />}
    <BaseEdge id={id} path={path} interactionWidth={20} style={{
      stroke: unsupplied ? "var(--color-mid-gray)" : selected && status !== "Failed" ? "var(--color-ink)" : style.edge,
      strokeWidth: selected ? 4 : connection ? 1 : style.width,
      strokeDasharray: unsupplied ? "2 5" : style.dash, opacity: unsupplied ? .5 : 1,
    }} />
    {!connection && data && <EdgeLabelRenderer>
      <div className={`edge-label nodrag nopan ${selected ? "is-selected" : ""} ${status === "Failed" && !unsupplied ? "danger" : ""}`}
        style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>
        {status === "Overloaded" && <TriangleAlert size={11} aria-hidden="true" />}
        <span>{id.replace("line-", "L")}</span><strong>{unsupplied ? "Unsupplied" : data.loadingPercent == null ? status : `${data.loadingPercent.toFixed(0)}%`}</strong>
      </div>
    </EdgeLabelRenderer>}
  </>;
}
