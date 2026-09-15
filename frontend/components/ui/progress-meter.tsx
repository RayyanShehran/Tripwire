type ProgressMeterProps = {
  label: string;
  value: number;
  tone?: "healthy" | "warning" | "danger";
};

export function ProgressMeter({ label, tone = "healthy", value }: ProgressMeterProps) {
  const width = Math.max(0, Math.min(value, 100));
  const fills = {
    healthy: "bg-emerald-400",
    warning: "bg-amber-300",
    danger: "bg-red-400",
  };

  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-400">{label}</span>
        <span className="font-semibold tabular-nums text-slate-100">{value.toFixed(0)}%</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${fills[tone]}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
