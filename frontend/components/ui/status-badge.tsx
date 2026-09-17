import { Activity, Check, TriangleAlert, Unplug, X } from "lucide-react";
export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const Icon = normalized === "failed" || normalized === "blackout" ? X : normalized === "unsupplied" ? Unplug : normalized === "overloaded" ? TriangleAlert : normalized === "healthy" ? Check : Activity;
  return <span className={`badge status-${normalized}`}><Icon aria-hidden="true" />{status}</span>;
}
