import type { GridStatus } from "./types";
export const statusStyles: Record<GridStatus, { edge: string; width: number; dash?: string }> = {
  Healthy: { edge: "var(--color-mid-gray)", width: 1.5 },
  Stressed: { edge: "var(--color-ink-soft)", width: 2.5, dash: "9 3" },
  Overloaded: { edge: "var(--color-ink)", width: 4 },
  Failed: { edge: "var(--color-ember)", width: 2, dash: "6 5" },
};
