type MetricCardProps = {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "healthy" | "warning" | "danger";
};

export function MetricCard({ detail, label, tone = "default", value }: MetricCardProps) {
  const tones = {
    default: "border-slate-800 bg-slate-950/70",
    healthy: "border-emerald-500/30 bg-emerald-500/5",
    warning: "border-amber-400/30 bg-amber-400/5",
    danger: "border-red-500/30 bg-red-500/5",
  };

  return (
    <div className={`rounded-md border px-3 py-2.5 ${tones[tone]}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-slate-50">
        {value}
      </div>
      {detail ? <div className="mt-0.5 text-xs text-slate-400">{detail}</div> : null}
    </div>
  );
}
