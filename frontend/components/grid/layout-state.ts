export type GridPosition = { x: number; y: number };
export type LayoutNode = { id: string; type?: string; position: GridPosition };

export const GRID_LAYOUT_STORAGE_KEY = "tripwire:grid-layout:v1";
export const GRID_LAYOUT_VERSION = 1;

// Coordinates include the full 168 x 92 node footprint plus label clearance.
const DEFAULT_POSITIONS: Record<string, GridPosition> = {
  "gen-north": { x: 0, y: 0 },
  "bus-0": { x: 0, y: 180 },
  "bus-1": { x: 270, y: 180 },
  "bus-2": { x: 540, y: 180 },
  "load-west": { x: -250, y: 420 },
  "bus-6": { x: 0, y: 420 },
  "bus-3": { x: 540, y: 420 },
  "load-east": { x: 790, y: 420 },
  "bus-4": { x: 0, y: 660 },
  "bus-5": { x: 270, y: 660 },
  "bus-7": { x: 540, y: 660 },
  "load-harbor": { x: 790, y: 660 },
  "gen-south": { x: 0, y: 850 },
  "load-metro": { x: 270, y: 850 },
  "gen-harbor": { x: 540, y: 850 },
};

type SavedLayout = {
  version: number;
  positions: Record<string, GridPosition>;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createDefaultLayout(nodes: Array<{ id: string; type?: string }>): Record<string, GridPosition> {
  const positions: Record<string, GridPosition> = {};
  const unknownByType = new Map<string, number>();
  const fallbackRows: Record<string, number> = { generator: 0, bus: 360, load: 850 };

  for (const node of nodes) {
    const known = DEFAULT_POSITIONS[node.id];
    if (known) {
      positions[node.id] = { ...known };
      continue;
    }
    const type = node.type ?? "bus";
    const index = unknownByType.get(type) ?? 0;
    unknownByType.set(type, index + 1);
    positions[node.id] = {
      x: 810 + (index % 3) * 270,
      y: (fallbackRows[type] ?? 360) + Math.floor(index / 3) * 180,
    };
  }
  return positions;
}

export function parseSavedLayout(raw: string | null, validNodeIds: Iterable<string>): Record<string, GridPosition> {
  if (!raw) return {};
  const validIds = new Set(validNodeIds);
  try {
    const parsed = JSON.parse(raw) as Partial<SavedLayout>;
    if (parsed.version !== GRID_LAYOUT_VERSION || !parsed.positions || typeof parsed.positions !== "object") return {};
    return Object.fromEntries(Object.entries(parsed.positions).filter(([id, position]) =>
      validIds.has(id) && isPosition(position),
    ).map(([id, position]) => [id, { x: position.x, y: position.y }]));
  } catch {
    return {};
  }
}

export function readSavedLayout(storage: StorageLike, validNodeIds: Iterable<string>): Record<string, GridPosition> {
  return parseSavedLayout(storage.getItem(GRID_LAYOUT_STORAGE_KEY), validNodeIds);
}

export function writeSavedLayout(storage: StorageLike, nodes: LayoutNode[]): void {
  const positions = Object.fromEntries(nodes.filter((node) => isPosition(node.position)).map((node) => [
    node.id,
    { x: node.position.x, y: node.position.y },
  ]));
  storage.setItem(GRID_LAYOUT_STORAGE_KEY, JSON.stringify({ version: GRID_LAYOUT_VERSION, positions }));
}

export function clearSavedLayout(storage: StorageLike): void {
  storage.removeItem(GRID_LAYOUT_STORAGE_KEY);
}

export function mergeLayoutPositions<T extends LayoutNode>(
  incoming: T[],
  current: LayoutNode[],
  saved: Record<string, GridPosition> = {},
): T[] {
  const currentPositions = new Map(current.map((node) => [node.id, node.position]));
  return incoming.map((node) => ({
    ...node,
    position: currentPositions.get(node.id) ?? saved[node.id] ?? node.position,
  }));
}

export function applyLayoutPositions<T extends LayoutNode>(
  nodes: T[],
  positions: Record<string, GridPosition>,
): T[] {
  return nodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position }));
}

function isPosition(value: unknown): value is GridPosition {
  if (!value || typeof value !== "object") return false;
  const position = value as Partial<GridPosition>;
  return Number.isFinite(position.x) && Number.isFinite(position.y);
}
