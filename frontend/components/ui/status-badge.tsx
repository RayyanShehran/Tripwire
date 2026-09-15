import type { GridStatus } from "../grid/types";

type StatusBadgeProps = {
  status: GridStatus | string;
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const tone = {
    Healthy: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
    Stressed: "border-amber-300/40 bg-amber-300/10 text-amber-100",
    Overloaded: "border-red-400/50 bg-red-400/10 text-red-100",
    Failed: "border-slate-500 bg-slate-700/60 text-slate-100",
  }[status] ?? "border-slate-600 bg-slate-800 text-slate-200";

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>
      {status}
    </span>
  );
}
