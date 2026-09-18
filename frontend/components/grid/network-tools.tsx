"use client";
import { useReactFlow } from "@xyflow/react";
import { LayoutGrid, Lock, Maximize, Pencil, RotateCcw, SlidersHorizontal, Unlock } from "lucide-react";
import { ActionButton } from "../ui/action-button";
import type { GridDisplayOptions } from "./grid-display";

type NetworkToolsProps = {
  disabled: boolean;
  locked: boolean;
  onAutoLayout: () => void;
  onResetLayout: () => void;
  onToggleLock: () => void;
  displayOptions: GridDisplayOptions;
  onDisplayOptionChange: (option: keyof GridDisplayOptions, value: boolean) => void;
  onEditGrid: () => void;
};

export function NetworkTools({ disabled, locked, onAutoLayout, onResetLayout, onToggleLock, displayOptions, onDisplayOptionChange, onEditGrid }: NetworkToolsProps) {
  const { fitView } = useReactFlow();
  return <div className="network-tools">
    <ActionButton className="network-tool-button" disabled={disabled} icon={<Pencil />} onClick={onEditGrid} variant="primary">Edit Grid</ActionButton>
    <ActionButton className="network-tool-button" disabled={disabled} icon={<LayoutGrid />} onClick={onAutoLayout} variant="ghost">Auto Layout</ActionButton>
    <ActionButton className="network-tool-button" disabled={disabled} icon={<Maximize />} onClick={() => { void fitView({ padding: .12, minZoom: .2, maxZoom: 1 }); }} variant="ghost">Fit View</ActionButton>
    <ActionButton className="network-tool-button" aria-pressed={locked} disabled={disabled} icon={locked ? <Lock /> : <Unlock />} onClick={onToggleLock} variant="ghost">{locked ? "Locked" : "Unlocked"}</ActionButton>
    <ActionButton className="network-tool-button" disabled={disabled} icon={<RotateCcw />} onClick={onResetLayout} variant="ghost">Reset Layout</ActionButton>
    <details className="display-settings">
      <summary className="button button-ghost network-tool-button"><SlidersHorizontal aria-hidden="true" />Display</summary>
      <div className="display-settings-menu" aria-label="Grid display options">
        <DisplayToggle label="Line IDs" checked={displayOptions.showLineIds} onChange={(value) => onDisplayOptionChange("showLineIds", value)} />
        <DisplayToggle label="Line loading" checked={displayOptions.showLineLoading} onChange={(value) => onDisplayOptionChange("showLineLoading", value)} />
        <DisplayToggle label="Electrical values" checked={displayOptions.showElectricalValues} onChange={(value) => onDisplayOptionChange("showElectricalValues", value)} />
        <DisplayToggle label="Status text" checked={displayOptions.showStatusText} onChange={(value) => onDisplayOptionChange("showStatusText", value)} />
        <DisplayToggle label="Compact nodes" checked={displayOptions.compactNodeMode} onChange={(value) => onDisplayOptionChange("compactNodeMode", value)} />
      </div>
    </details>
  </div>;
}

function DisplayToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}
