"use client";
import { useReactFlow } from "@xyflow/react";
import { LayoutGrid, Lock, Maximize, RotateCcw, Unlock } from "lucide-react";
import { ActionButton } from "../ui/action-button";

type NetworkToolsProps = {
  disabled: boolean;
  locked: boolean;
  onAutoLayout: () => void;
  onResetLayout: () => void;
  onToggleLock: () => void;
};

export function NetworkTools({ disabled, locked, onAutoLayout, onResetLayout, onToggleLock }: NetworkToolsProps) {
  const { fitView } = useReactFlow();
  return <div className="network-tools">
    <ActionButton className="network-tool-button" disabled={disabled} icon={<LayoutGrid />} onClick={onAutoLayout} variant="ghost">Auto Layout</ActionButton>
    <ActionButton className="network-tool-button" disabled={disabled} icon={<Maximize />} onClick={() => { void fitView({ padding: .12, minZoom: .2, maxZoom: 1 }); }} variant="ghost">Fit View</ActionButton>
    <ActionButton className="network-tool-button" aria-pressed={locked} disabled={disabled} icon={locked ? <Lock /> : <Unlock />} onClick={onToggleLock} variant="ghost">{locked ? "Locked" : "Unlocked"}</ActionButton>
    <ActionButton className="network-tool-button" disabled={disabled} icon={<RotateCcw />} onClick={onResetLayout} variant="ghost">Reset Layout</ActionButton>
  </div>;
}
