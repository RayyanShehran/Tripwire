"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Factory, UtilityPole, PlugZap, TriangleAlert, Unplug, X } from "lucide-react";
import type { GridNodeData } from "./types";

type GridNodeProps = NodeProps & { data: GridNodeData };
function NodeShell({ data }: { data: GridNodeData }) {
  const Icon = data.type === "Generator" ? Factory : data.type === "Load" ? PlugZap : UtilityPole;
  const status = data.isUnsupplied ? "Unsupplied" : data.status;
  const StatusIcon = status === "Failed" ? X : status === "Unsupplied" ? Unplug : TriangleAlert;
  const name = data.name.replace(/ 230 kV Bus$/, "").replace(/ Generator$/, "").replace(/ Load$/, "");
  const value = data.type === "Generator" ? data.generationMw : data.type === "Load" ? data.loadMw : data.voltagePu;
  return <div className={`grid-node status-${status.toLowerCase()} ${data.isNewlyFailed ? "new-failure" : ""}`} title={`${data.name}: ${status}`}>
    {[Position.Left, Position.Right, Position.Top, Position.Bottom].map((position) => <span key={position}>
      <Handle type="target" id={`target-${position}`} position={position} />
      <Handle type="source" id={`source-${position}`} position={position} />
    </span>)}
    <div className="node-caption"><Icon size={14} aria-hidden="true" /><span>{data.type === "Substation / Bus" ? "Bus / 230 kV" : data.type}</span></div>
    <div className="node-name">{name}</div>
    <div className="node-reading"><span>{value == null ? "N/A" : value.toFixed(data.type === "Substation / Bus" ? 3 : 1)}<small>{data.type === "Substation / Bus" ? " p.u." : " MW"}</small></span>
      <span className="node-status">{status !== "Healthy" && <StatusIcon size={11} aria-hidden="true" />}{status}</span>
    </div>
  </div>;
}
export const GeneratorNode = memo(function GeneratorNode({ data }: GridNodeProps) { return <NodeShell data={data} />; });
export const BusNode = memo(function BusNode({ data }: GridNodeProps) { return <NodeShell data={data} />; });
export const LoadNode = memo(function LoadNode({ data }: GridNodeProps) { return <NodeShell data={data} />; });
