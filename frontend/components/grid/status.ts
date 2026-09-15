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
    border: "border-emerald-400/70",
    badge: "border border-emerald-400/40 bg-emerald-400/10 text-emerald-100",
    edge: "#34d399",
    fill: "#052e26",
  },
  Stressed: {
    border: "border-amber-300/80",
    badge: "border border-amber-300/40 bg-amber-300/10 text-amber-100",
    edge: "#fbbf24",
    fill: "#3b2f08",
  },
  Overloaded: {
    border: "border-red-400/80",
    badge: "border border-red-400/50 bg-red-400/10 text-red-100",
    edge: "#f87171",
    fill: "#3b0b12",
  },
  Failed: {
    border: "border-slate-500",
    badge: "border border-slate-500 bg-slate-700/70 text-slate-100",
    edge: "#64748b",
    fill: "#1e293b",
  },
};
