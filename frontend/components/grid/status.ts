import type { GridStatus } from "./types";

export const statusStyles: Record<
  GridStatus,
  {
    border: string;
    badge: string;
    edge: string;
    fill: string;
  }
> = {
  Healthy: {
    border: "border-emerald-500",
    badge: "bg-emerald-100 text-emerald-800",
    edge: "#059669",
    fill: "#ecfdf5",
  },
  Stressed: {
    border: "border-amber-500",
    badge: "bg-amber-100 text-amber-900",
    edge: "#d97706",
    fill: "#fffbeb",
  },
  Overloaded: {
    border: "border-red-500",
    badge: "bg-red-100 text-red-800",
    edge: "#dc2626",
    fill: "#fef2f2",
  },
  Failed: {
    border: "border-neutral-500",
    badge: "bg-neutral-200 text-neutral-800",
    edge: "#525252",
    fill: "#f5f5f5",
  },
};
