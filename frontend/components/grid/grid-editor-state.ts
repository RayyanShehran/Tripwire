import type { GridDefinition, GridValidation, ApiGridResponse, ApiOperatingCondition } from "./api";
import type { GridDisplayOptions } from "./grid-display";
import type { GridPosition } from "./layout-state";

export const SCENARIO_SCHEMA_VERSION = 1;
export const DRAFT_STORAGE_KEY = "tripwire:grid-editor:draft:v1";
export const PRESET_STORAGE_KEY = "tripwire:grid-editor:presets:v1";
export const HISTORY_LIMIT = 50;

export type ScenarioDocument = {
  schema_version: 1;
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  source_preset: string | null;
  tags: string[];
  grid_definition: GridDefinition;
  operating_condition: ApiOperatingCondition;
  visual_layout: { positions: Record<string, GridPosition>; locked: boolean; zoom?: number };
  display_options: GridDisplayOptions;
};

export type EditorSnapshot = {
  definition: GridDefinition;
  positions: Record<string, GridPosition>;
};

export type EditorHistory = { past: EditorSnapshot[]; present: EditorSnapshot; future: EditorSnapshot[] };

export function createHistory(definition: GridDefinition, positions: Record<string, GridPosition> = {}): EditorHistory {
  return { past: [], present: { definition: clone(definition), positions: clone(positions) }, future: [] };
}

export function commitHistory(history: EditorHistory, next: EditorSnapshot): EditorHistory {
  if (JSON.stringify(history.present) === JSON.stringify(next)) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: clone(next), future: [] };
}

export function undoHistory(history: EditorHistory): EditorHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future].slice(0, HISTORY_LIMIT) };
}

export function redoHistory(history: EditorHistory): EditorHistory {
  const next = history.future[0];
  if (!next) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: history.future.slice(1) };
}

export function removeComponent(definition: GridDefinition, type: "bus" | "generator" | "load" | "line", id: string, cascade = false): GridDefinition {
  const next = clone(definition);
  if (type === "bus") {
    const attached = attachedComponentIds(next, id);
    if (attached.length && !cascade) throw new Error(`This bus is connected to ${attached.length} components.`);
    next.buses = next.buses.filter((item) => item.id !== id);
    if (cascade) {
      next.generators = next.generators.filter((item) => item.bus_id !== id);
      next.loads = next.loads.filter((item) => item.bus_id !== id);
      next.lines = next.lines.filter((item) => item.source_bus_id !== id && item.target_bus_id !== id);
    }
  } else if (type === "generator") next.generators = next.generators.filter((item) => item.id !== id);
  else if (type === "load") next.loads = next.loads.filter((item) => item.id !== id);
  else next.lines = next.lines.filter((item) => item.id !== id);
  return next;
}

export function attachedComponentIds(definition: GridDefinition, busId: string): string[] {
  return [
    ...definition.generators.filter((item) => item.bus_id === busId).map((item) => item.id),
    ...definition.loads.filter((item) => item.bus_id === busId).map((item) => item.id),
    ...definition.lines.filter((item) => item.source_bus_id === busId || item.target_bus_id === busId).map((item) => item.id),
  ];
}

export function upsertComponent(definition: GridDefinition, type: "bus" | "generator" | "load" | "line", value: Record<string, unknown>, previousId?: string): GridDefinition {
  const next = clone(definition);
  const key = type === "bus" ? "buses" : type === "generator" ? "generators" : type === "load" ? "loads" : "lines";
  const list = next[key] as Array<Record<string, unknown>>;
  const index = list.findIndex((item) => item.id === (previousId ?? value.id));
  if (index >= 0) list[index] = clone(value);
  else list.push(clone(value));
  return next;
}

export function draftGrid(definition: GridDefinition): ApiGridResponse {
  return {
    nodes: [
      ...definition.buses.map((item) => ({ id: item.id, name: item.name, type: "bus" as const, status: "healthy" as const, voltage: null, generation_mw: null, load_mw: null, connected_bus_id: null })),
      ...definition.generators.map((item) => ({ id: item.id, name: item.name, type: "generator" as const, status: "healthy" as const, voltage: null, generation_mw: item.setpoint_mw, load_mw: null, connected_bus_id: item.bus_id })),
      ...definition.loads.map((item) => ({ id: item.id, name: item.name, type: "load" as const, status: "healthy" as const, voltage: null, generation_mw: null, load_mw: item.demand_mw, connected_bus_id: item.bus_id })),
    ],
    lines: definition.lines.map((item) => ({ id: item.id, name: item.name, source: item.source_bus_id, target: item.target_bus_id, capacity_mw: item.capacity_mw, loading_percent: null, status: "healthy" as const })),
    metrics: { original_demand_mw: totalDemand(definition), total_demand_mw: totalDemand(definition), served_load_mw: 0, controlled_shed_mw: 0, involuntary_unserved_mw: 0, total_unserved_mw: 0, unserved_load_mw: 0, load_lost_percent: 0, total_generation_mw: 0, failed_components: 0, failed_lines: 0, max_line_loading_percent: 0 },
  };
}

export function parseScenarioDocument(raw: string): ScenarioDocument {
  const value = JSON.parse(raw) as Partial<ScenarioDocument>;
  if (value.schema_version !== SCENARIO_SCHEMA_VERSION) throw new Error(`Unsupported scenario schema version: ${String(value.schema_version)}`);
  if (!value.grid_definition || value.grid_definition.version !== 1 || !Array.isArray(value.grid_definition.buses) || !Array.isArray(value.grid_definition.generators) || !Array.isArray(value.grid_definition.loads) || !Array.isArray(value.grid_definition.lines)) throw new Error("Scenario does not contain a valid grid definition");
  if (!value.name || !value.id || !value.operating_condition || !value.visual_layout || !value.display_options) throw new Error("Scenario is missing required fields");
  return value as ScenarioDocument;
}

export function readPresets(storage: Pick<Storage, "getItem">): ScenarioDocument[] {
  try { const value = JSON.parse(storage.getItem(PRESET_STORAGE_KEY) ?? "[]") as unknown; return Array.isArray(value) ? value.map((item) => parseScenarioDocument(JSON.stringify(item))) : []; } catch { return []; }
}
export function writePresets(storage: Pick<Storage, "setItem">, presets: ScenarioDocument[]): void { storage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets)); }
export function readDraft(storage: Pick<Storage, "getItem">): ScenarioDocument | null { const raw = storage.getItem(DRAFT_STORAGE_KEY); if (!raw) return null; try { return parseScenarioDocument(raw); } catch { return null; } }
export function writeDraft(storage: Pick<Storage, "setItem">, draft: ScenarioDocument): void { storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft)); }

export function createScenarioDocument(name: string, definition: GridDefinition, condition: ApiOperatingCondition, positions: Record<string, GridPosition>, displayOptions: GridDisplayOptions, sourcePreset: string | null = null): ScenarioDocument {
  const now = new Date().toISOString();
  return { schema_version: 1, id: `scenario-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, description: "", created_at: now, updated_at: now, source_preset: sourcePreset, tags: ["custom"], grid_definition: clone(definition), operating_condition: clone(condition), visual_layout: { positions: clone(positions), locked: true }, display_options: clone(displayOptions) };
}

export function localValidation(definition: GridDefinition): GridValidation {
  const errors: GridValidation["errors"] = [];
  const ids = new Set<string>();
  const all = [...definition.buses, ...definition.generators, ...definition.loads, ...definition.lines];
  for (const item of all) { if (ids.has(item.id)) errors.push({ component_id: item.id, field: "id", message: "Component ID must be unique", code: "duplicate_id" }); ids.add(item.id); }
  const buses = new Set(definition.buses.map((item) => item.id));
  if (!definition.buses.length) errors.push({ component_id: null, field: "buses", message: "At least one bus is required", code: "missing_bus" });
  for (const item of [...definition.generators, ...definition.loads]) if (!buses.has(item.bus_id)) errors.push({ component_id: item.id, field: "bus_id", message: "Connected bus does not exist", code: "missing_bus_reference" });
  for (const line of definition.lines) { if (!buses.has(line.source_bus_id) || !buses.has(line.target_bus_id)) errors.push({ component_id: line.id, field: "source_bus_id", message: "Line bus reference does not exist", code: "missing_bus_reference" }); if (line.source_bus_id === line.target_bus_id) errors.push({ component_id: line.id, field: "target_bus_id", message: "A line cannot connect a bus to itself", code: "self_loop" }); if (!(line.capacity_mw > 0) || !(line.length_km > 0)) errors.push({ component_id: line.id, field: "capacity_mw", message: "Line capacity and length must be positive", code: "invalid_line" }); }
  for (const gen of definition.generators) if (!(gen.min_mw >= 0 && gen.min_mw <= gen.setpoint_mw && gen.setpoint_mw <= gen.max_mw)) errors.push({ component_id: gen.id, field: "setpoint_mw", message: "Generator limits are invalid", code: "invalid_generator_limits" });
  if (definition.generators.filter((item) => item.is_slack).length !== 1) errors.push({ component_id: null, field: "generators", message: "Exactly one slack/source generator is required", code: "invalid_slack_count" });
  return { valid: errors.length === 0, errors, warnings: [], island_count: 0 };
}

function totalDemand(definition: GridDefinition): number { return definition.loads.reduce((sum, item) => sum + item.demand_mw, 0); }
function clone<T>(value: T): T { return structuredClone(value); }
