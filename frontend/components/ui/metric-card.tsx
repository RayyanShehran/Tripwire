type MetricCardProps = { label: string; value: string; detail?: string; tone?: "default" | "healthy" | "warning" | "danger" };
export function MetricCard({ detail, label, value }: MetricCardProps) {
  return <div className="metric"><div className="eyebrow">{label}</div><span className="metric-value">{value}</span>{detail && <p className="muted">{detail}</p>}</div>;
}
