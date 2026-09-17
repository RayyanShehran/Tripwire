export function ProgressMeter({ label, value }: { label: string; value: number; tone?: "healthy" | "warning" | "danger" }) {
  return <div><div className="flex justify-between gap-2 mb-2"><span className="muted">{label}</span><span>{value.toFixed(0)}%</span></div><div className="progress-track" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><div className="progress-fill" style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} /></div></div>;
}
