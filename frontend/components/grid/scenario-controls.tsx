"use client";
import { Activity, ChevronDown, Play, ScanLine, Shield, X, ZapOff } from "lucide-react";
import { ActionButton } from "../ui/action-button";
import type { ApiDemoPreset, ApiOperatingCondition } from "./api";
import type { ScenarioInput } from "./scenario-state";
import type { ActiveAction, OperatingProfileKey } from "./info-panel";
import type { SelectedGridElement } from "./types";

type Props = {
  activeAction: ActiveAction; input: ScenarioInput; selectedPresetId: string | null; selected: SelectedGridElement; presets: ApiDemoPreset[];
  onLoadPreset: (preset: ApiDemoPreset) => void; onProfileChange: (profile: OperatingProfileKey) => void;
  onConditionChange: (condition: ApiOperatingCondition) => void; onClear: () => void;
  onPredict: () => void; onFailure: () => void; onCascade: () => void; onMitigation: () => void;
};
export function ScenarioControls({ activeAction, input, selectedPresetId, selected, presets, onLoadPreset, onProfileChange, onConditionChange, onClear, onPredict, onFailure, onCascade, onMitigation }: Props) {
  const busy = activeAction !== null;
  const disabled = busy || !selected;
  return <aside className="control-rail" aria-label="Scenario controls">
    <section><h2 className="eyebrow">Scenario</h2>
      <label className="field">Preset<div className="select-wrap"><select disabled={busy} value={selectedPresetId ?? ""} onChange={(event) => { const preset = presets.find((item) => item.id === event.target.value); if (preset) onLoadPreset(preset); }}><option value="" disabled>Custom Scenario</option>{presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select><ChevronDown aria-hidden="true" /></div></label>
      <label className="field">Operating profile<div className="select-wrap"><select disabled={busy} value={input.profile} onChange={(event) => onProfileChange(event.target.value as OperatingProfileKey)}><option value="baseline">Baseline</option><option value="stressed">Stressed</option><option value="critical">Critical Demo</option><option value="severe">Severe</option></select><ChevronDown aria-hidden="true" /></div></label>
      <details className="condition-details"><summary>Operating conditions</summary>
        <NumberProfile label="Load multiplier" value={input.condition.load_multiplier} options={[1, 1.25, 1.5]} disabled={busy} onChange={(load_multiplier) => onConditionChange({ ...input.condition, load_multiplier })} />
        <NumberProfile label="Generation multiplier" value={input.condition.generation_multiplier} options={[.8, .9, 1]} disabled={busy} onChange={(generation_multiplier) => onConditionChange({ ...input.condition, generation_multiplier })} />
        <NumberProfile label="Line rating multiplier" value={input.condition.line_rating_multiplier} options={[.32, .35, .45, 1]} disabled={busy} onChange={(line_rating_multiplier) => onConditionChange({ ...input.condition, line_rating_multiplier })} />
        <label className="field">Dispatch<div className="select-wrap"><select disabled={busy} value={input.condition.dispatch_profile} onChange={(event) => onConditionChange({ ...input.condition, dispatch_profile: event.target.value })}>{["balanced", "south_reduced", "south_heavy"].map((profile) => <option key={profile} value={profile}>{profile.replaceAll("_", " ")}</option>)}</select><ChevronDown aria-hidden="true" /></div></label>
      </details>
      <dl className="condition-readout"><div><dt>Load</dt><dd>{input.condition.load_multiplier.toFixed(2)}x</dd></div><div><dt>Generation</dt><dd>{input.condition.generation_multiplier.toFixed(2)}x</dd></div><div><dt>Line rating</dt><dd>{input.condition.line_rating_multiplier.toFixed(2)}x</dd></div></dl>
    </section>
    <section><h2 className="eyebrow">Component</h2><div className="selected-component"><div><strong>{selected ? selected.item.data?.name ?? selected.item.id : "None selected"}</strong><p className="muted">{selected ? selected.item.id : "No initial outage"}</p></div>{selected && <ActionButton className="icon-button" disabled={busy} onClick={onClear} title="Clear selected component" aria-label="Clear selected component" icon={<X />} variant="ghost" />}</div></section>
    <section><h2 className="eyebrow">Actions</h2><div className="rail-actions">
      <ActionButton icon={<Play />} variant="primary" disabled={disabled} onClick={onCascade}>{activeAction === "cascade" ? "Running Cascade..." : "Run Cascade"}</ActionButton>
      <ActionButton icon={<ScanLine />} disabled={disabled} onClick={onPredict}>{activeAction === "predict" ? "Predicting..." : "Predict Risk"}</ActionButton>
      <ActionButton icon={<ZapOff />} variant="danger" disabled={disabled} onClick={onFailure}>{activeAction === "failure" ? "Simulating..." : "Simulate Failure"}</ActionButton>
      <ActionButton icon={<Shield />} variant="ghost" disabled={disabled} onClick={onMitigation}>{activeAction === "mitigation" ? "Evaluating..." : "Find Mitigation"}</ActionButton>
    </div></section>
    <div className="rail-footer"><Activity size={14} aria-hidden="true" /><span>AC power flow / pandapower</span></div>
  </aside>;
}
function NumberProfile({ label, value, options, disabled, onChange }: { label: string; value: number; options: number[]; disabled: boolean; onChange: (value: number) => void }) {
  return <label className="field">{label}<div className="select-wrap"><select value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}>{Array.from(new Set([...options, value])).sort((a,b) => a-b).map((item) => <option key={item} value={item}>{item.toFixed(2)}x</option>)}</select><ChevronDown aria-hidden="true" /></div></label>;
}
