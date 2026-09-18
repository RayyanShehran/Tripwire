"use client";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Check, Copy, Download, FileUp, Pencil, Plus, Redo2, Save, Trash2, Undo2, X } from "lucide-react";
import { ActionButton } from "../ui/action-button";
import type { ApiComponentType, GridDefinition, GridValidation } from "./api";
import { attachedComponentIds, removeComponent, upsertComponent, type ScenarioDocument } from "./grid-editor-state";

type EditorType = "bus" | "generator" | "load" | "line";
type ComponentValue = GridDefinition["buses"][number] | GridDefinition["generators"][number] | GridDefinition["loads"][number] | GridDefinition["lines"][number];
type Selection = { component_type: ApiComponentType; component_id: string } | null;
type Props = {
  definition: GridDefinition; validation: GridValidation; selected: Selection; dirty: boolean;
  canUndo: boolean; canRedo: boolean; presets: ScenarioDocument[]; activePresetId: string | null;
  onDefinitionChange: (definition: GridDefinition) => void; onUndo: () => void; onRedo: () => void;
  onValidate: () => void; onApply: () => void; onCancel: () => void; onSave: () => void;
  onLoadPreset: (preset: ScenarioDocument) => void; onDuplicatePreset: (preset: ScenarioDocument) => void;
  onRenamePreset: (preset: ScenarioDocument) => void; onDeletePreset: (preset: ScenarioDocument) => void;
  onImport: (file: File) => void; onExport: () => void;
  builtInName: string; onResetBuiltIn: () => void; onDuplicateBuiltIn: () => void;
};

export function GridEditorPanel(props: Props) {
  const [form, setForm] = useState<{ type: EditorType; previousId?: string } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => selectedDefinitionComponent(props.definition, props.selected), [props.definition, props.selected]);
  const openEdit = () => { if (selected) setForm({ type: selected.type, previousId: selected.value.id }); };
  const removeSelected = () => {
    if (!selected) return;
    const attached = selected.type === "bus" ? attachedComponentIds(props.definition, selected.value.id) : [];
    const message = attached.length ? `This bus is connected to ${attached.length} components. Delete the bus and all connected components?` : `Remove ${selected.value.name}?`;
    if (!window.confirm(message)) return;
    props.onDefinitionChange(removeComponent(props.definition, selected.type, selected.value.id, attached.length > 0));
  };
  return <aside className="control-rail editor-rail" aria-label="Grid editor">
    <section><div className="editor-heading"><div><span className="eyebrow">Mode</span><h2>Edit Grid</h2></div>{props.dirty && <span className="badge">Unsaved changes</span>}</div>
      <div className="editor-history"><ActionButton icon={<Undo2 />} disabled={!props.canUndo} onClick={props.onUndo} title="Undo (Ctrl+Z)">Undo</ActionButton><ActionButton icon={<Redo2 />} disabled={!props.canRedo} onClick={props.onRedo} title="Redo (Ctrl+Shift+Z)">Redo</ActionButton></div>
    </section>
    <section><h3>Add Component</h3><div className="component-toolbox">
      {(["bus", "generator", "load", "line"] as EditorType[]).map((type) => <button type="button" key={type} onClick={() => setForm({ type })}><Plus />{type === "line" ? "Transmission Line" : capitalize(type)}</button>)}
    </div></section>
    <section><h3>Selection</h3>{selected ? <><p className="editor-selection"><strong>{selected.value.name}</strong><small>{selected.value.id}</small></p><div className="editor-history"><ActionButton icon={<Pencil />} onClick={openEdit}>Edit</ActionButton><ActionButton icon={<Trash2 />} variant="danger" onClick={removeSelected}>Remove</ActionButton></div></> : <p className="muted editor-help">Select a component on the network to edit or remove it.</p>}</section>
    <section><button type="button" className={`validation-summary ${props.validation.valid ? "is-valid" : "is-invalid"}`} onClick={props.onValidate}>{props.validation.valid ? <Check /> : <AlertTriangle />}<span><strong>{props.validation.valid ? "Network valid" : `${props.validation.errors.length} issues`}</strong><small>{props.validation.warnings.length} warnings / validate</small></span></button>
      {(props.validation.errors.length > 0 || props.validation.warnings.length > 0) && <details className="validation-list"><summary>Errors and warnings</summary>{[...props.validation.errors, ...props.validation.warnings].map((item, index) => <p className={index < props.validation.errors.length ? "danger" : "muted"} key={`${item.code}-${index}`}><strong>{item.component_id ?? "Network"}</strong>{item.message}</p>)}</details>}
    </section>
    <section><h3>Built-in</h3><p className="editor-selection"><strong>{props.builtInName}</strong><small>Read-only preset</small></p><div className="editor-history"><ActionButton icon={<Copy />} onClick={props.onDuplicateBuiltIn}>Duplicate</ActionButton><ActionButton icon={<Redo2 />} onClick={props.onResetBuiltIn}>Reset</ActionButton></div></section>
    <section><h3>My Scenarios</h3><label className="field">Saved scenario<select value={props.activePresetId ?? ""} onChange={(event) => { const preset = props.presets.find((item) => item.id === event.target.value); if (preset) props.onLoadPreset(preset); }}><option value="">Current draft</option>{props.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
      <div className="preset-actions"><ActionButton icon={<Save />} onClick={props.onSave}>Save</ActionButton>{props.activePresetId && <><ActionButton icon={<Copy />} onClick={() => props.onDuplicatePreset(props.presets.find((item) => item.id === props.activePresetId)!)}>Duplicate</ActionButton><ActionButton icon={<Pencil />} onClick={() => props.onRenamePreset(props.presets.find((item) => item.id === props.activePresetId)!)}>Rename</ActionButton><ActionButton icon={<Trash2 />} variant="danger" onClick={() => props.onDeletePreset(props.presets.find((item) => item.id === props.activePresetId)!)}>Delete</ActionButton></>}</div>
      <div className="editor-history"><ActionButton icon={<Download />} onClick={props.onExport}>Export</ActionButton><ActionButton icon={<FileUp />} onClick={() => importRef.current?.click()}>Import</ActionButton><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onImport(file); event.target.value = ""; }} /></div>
    </section>
    <section className="editor-apply"><ActionButton icon={<X />} onClick={props.onCancel}>Cancel</ActionButton><ActionButton icon={<Check />} variant="primary" disabled={!props.validation.valid} onClick={props.onApply}>Apply & Analyze</ActionButton></section>
    {form && <ComponentDialog definition={props.definition} type={form.type} previousId={form.previousId} onClose={() => setForm(null)} onSave={(value) => { props.onDefinitionChange(upsertComponent(props.definition, form.type, value, form.previousId)); setForm(null); }} />}
  </aside>;
}

function ComponentDialog({ definition, type, previousId, onClose, onSave }: { definition: GridDefinition; type: EditorType; previousId?: string; onClose: () => void; onSave: (value: Record<string, unknown>) => void }) {
  const existing = selectedDefinitionComponent(definition, previousId ? { component_type: type, component_id: previousId } : null)?.value;
  const defaults = componentDefaults(type, definition);
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const source = existing && "electrical_parameters" in existing
      ? { ...existing, ...existing.electrical_parameters }
      : existing ?? defaults;
    return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, typeof value === "boolean" ? value : String(value ?? "")]));
  });
  const field = (name: string) => String(values[name] ?? "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const common = { id: field("id").trim(), name: field("name").trim(), notes: field("notes").trim() };
    if (type === "bus") onSave({ ...common, voltage_kv: number(field("voltage_kv")) });
    if (type === "generator") onSave({ ...common, bus_id: field("bus_id"), min_mw: number(field("min_mw")), max_mw: number(field("max_mw")), setpoint_mw: number(field("setpoint_mw")), is_slack: Boolean(values.is_slack), voltage_pu: 1 });
    if (type === "load") onSave({ ...common, bus_id: field("bus_id"), demand_mw: number(field("demand_mw")), reactive_mvar: number(field("reactive_mvar")) });
    if (type === "line") onSave({ ...common, source_bus_id: field("source_bus_id"), target_bus_id: field("target_bus_id"), length_km: number(field("length_km")), capacity_mw: number(field("capacity_mw")), electrical_parameters: { resistance_ohm_per_km: number(field("resistance_ohm_per_km")), reactance_ohm_per_km: number(field("reactance_ohm_per_km")), capacitance_nf_per_km: number(field("capacitance_nf_per_km")) } });
  };
  const set = (name: string, value: string | boolean) => setValues((current) => ({ ...current, [name]: value }));
  return <div className="editor-dialog-backdrop" role="presentation"><form className="editor-dialog" aria-label={`${previousId ? "Edit" : "Add"} ${type}`} onSubmit={submit}><header><div><span className="eyebrow">Grid component</span><h2>{previousId ? "Edit" : "Add"} {type === "line" ? "Transmission Line" : capitalize(type)}</h2></div><button type="button" className="button button-ghost icon-button" onClick={onClose} aria-label="Close"><X /></button></header>
    <div className="editor-form-grid"><Input label="Name" value={field("name")} onChange={(value) => set("name", value)} required /><Input label="Identifier" value={field("id")} onChange={(value) => set("id", value)} required />
      {type === "bus" && <Input label="Nominal voltage (kV)" type="number" value={field("voltage_kv")} onChange={(value) => set("voltage_kv", value)} required />}
      {(type === "generator" || type === "load") && <BusSelect label="Connected bus" buses={definition.buses} value={field("bus_id")} onChange={(value) => set("bus_id", value)} />}
      {type === "generator" && <><Input label="Minimum MW" type="number" value={field("min_mw")} onChange={(value) => set("min_mw", value)} required /><Input label="Maximum MW" type="number" value={field("max_mw")} onChange={(value) => set("max_mw", value)} required /><Input label="Setpoint MW" type="number" value={field("setpoint_mw")} onChange={(value) => set("setpoint_mw", value)} required /><label className="editor-check"><input type="checkbox" checked={Boolean(values.is_slack)} onChange={(event) => set("is_slack", event.target.checked)} />Slack / source</label></>}
      {type === "load" && <><Input label="Demand MW" type="number" value={field("demand_mw")} onChange={(value) => set("demand_mw", value)} required /><Input label="Reactive MVAr" type="number" value={field("reactive_mvar")} onChange={(value) => set("reactive_mvar", value)} /></>}
      {type === "line" && <><BusSelect label="Source bus" buses={definition.buses} value={field("source_bus_id")} onChange={(value) => set("source_bus_id", value)} /><BusSelect label="Target bus" buses={definition.buses} value={field("target_bus_id")} onChange={(value) => set("target_bus_id", value)} /><Input label="Capacity MW" type="number" value={field("capacity_mw")} onChange={(value) => set("capacity_mw", value)} required /><Input label="Length km" type="number" value={field("length_km")} onChange={(value) => set("length_km", value)} required /><Input label="Resistance ohm/km" type="number" value={field("resistance_ohm_per_km")} onChange={(value) => set("resistance_ohm_per_km", value)} required /><Input label="Reactance ohm/km" type="number" value={field("reactance_ohm_per_km")} onChange={(value) => set("reactance_ohm_per_km", value)} required /><Input label="Capacitance nF/km" type="number" value={field("capacitance_nf_per_km")} onChange={(value) => set("capacitance_nf_per_km", value)} required /></>}
      <label className="editor-field editor-notes">Notes<textarea value={field("notes")} onChange={(event) => set("notes", event.target.value)} /></label>
    </div><footer><ActionButton onClick={onClose}>Cancel</ActionButton><ActionButton icon={<Check />} variant="primary" type="submit">Apply</ActionButton></footer></form></div>;
}

function Input({ label, value, onChange, type = "text", required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) { return <label className="editor-field">{label}<input type={type} step={type === "number" ? "any" : undefined} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>; }
function BusSelect({ label, buses, value, onChange }: { label: string; buses: GridDefinition["buses"]; value: string; onChange: (value: string) => void }) { return <label className="editor-field">{label}<select value={value} onChange={(event) => onChange(event.target.value)} required><option value="" disabled>Select bus</option>{buses.map((bus) => <option value={bus.id} key={bus.id}>{bus.name}</option>)}</select></label>; }
function componentDefaults(type: EditorType, definition: GridDefinition): Record<string, unknown> { const id = nextId(definition, type); const bus = definition.buses[0]?.id ?? ""; if (type === "bus") return { id, name: "New Bus", voltage_kv: 230, notes: "" }; if (type === "generator") return { id, name: "New Generator", bus_id: bus, min_mw: 0, max_mw: 100, setpoint_mw: 50, is_slack: false, notes: "" }; if (type === "load") return { id, name: "New Load", bus_id: bus, demand_mw: 50, reactive_mvar: 10, notes: "" }; return { id, name: "New Line", source_bus_id: bus, target_bus_id: definition.buses[1]?.id ?? bus, capacity_mw: 150, length_km: 20, resistance_ohm_per_km: .04, reactance_ohm_per_km: .28, capacitance_nf_per_km: 11, notes: "" }; }
function nextId(definition: GridDefinition, type: EditorType): string { const ids = new Set([...definition.buses, ...definition.generators, ...definition.loads, ...definition.lines].map((item) => item.id)); let index = 1; while (ids.has(`${type}-${index}`)) index += 1; return `${type}-${index}`; }
function selectedDefinitionComponent(definition: GridDefinition, selected: Selection): { type: EditorType; value: ComponentValue } | null { if (!selected) return null; const type = selected.component_type as EditorType; const collection: ComponentValue[] = type === "bus" ? definition.buses : type === "generator" ? definition.generators : type === "load" ? definition.loads : definition.lines; const value = collection.find((item) => item.id === selected.component_id); return value ? { type, value } : null; }
function number(value: string): number { return Number(value || 0); }
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
