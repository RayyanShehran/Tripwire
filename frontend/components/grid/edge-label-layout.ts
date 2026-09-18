export type LayoutPoint = { x: number; y: number };
export type LayoutRect = { x: number; y: number; width: number; height: number };

export const GRID_NODE_WIDTH = 168;
export const GRID_NODE_HEIGHT = 92;
const LABEL_WIDTH = 62;
const LABEL_HEIGHT = 28;
const NODE_CLEARANCE = 12;
const LABEL_CLEARANCE = 6;

export function chooseEdgeLabelPosition(
  source: LayoutPoint,
  target: LayoutPoint,
  nodeRects: LayoutRect[],
  occupiedLabelRects: LayoutRect[],
): { point: LayoutPoint; rect: LayoutRect } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const candidates = [
    ...candidatePoints([0.5, 0.38, 0.62], [0, 28, -28], source, dx, dy, normal),
    ...candidatePoints([0.3, 0.7], [42, -42], source, dx, dy, normal),
    ...candidatePoints([0.5, 0.35, 0.65], [64, -64, 84, -84], source, dx, dy, normal),
  ];
  const scored = candidates.map(({ point, displacement }) => {
    const rect = centeredRect(point, LABEL_WIDTH, LABEL_HEIGHT);
    const nodeCollisions = nodeRects.filter((node) => intersects(rect, inflate(node, NODE_CLEARANCE))).length;
    const labelCollisions = occupiedLabelRects.filter((label) => intersects(rect, inflate(label, LABEL_CLEARANCE))).length;
    return {
      point,
      rect,
      score: nodeCollisions * 10000 + labelCollisions * 1000 + displacement,
    };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored[0];
}

function candidatePoints(
  fractions: number[],
  offsets: number[],
  source: LayoutPoint,
  dx: number,
  dy: number,
  normal: LayoutPoint,
) {
  return fractions.flatMap((fraction) => offsets.map((offset) => ({
    point: {
      x: source.x + dx * fraction + normal.x * offset,
      y: source.y + dy * fraction + normal.y * offset,
    },
    displacement: Math.abs(fraction - 0.5) * 80 + Math.abs(offset) * 0.25,
  })));
}

function centeredRect(point: LayoutPoint, width: number, height: number): LayoutRect {
  return { x: point.x - width / 2, y: point.y - height / 2, width, height };
}

function inflate(rect: LayoutRect, amount: number): LayoutRect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function intersects(a: LayoutRect, b: LayoutRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
