import type { ApiCascadeResponse, ApiGridResponse } from "./api";
export type SystemState = "Healthy" | "Stressed" | "Cascade" | "Blackout" | "Unknown";
export function playbackState(totalSteps: number, index: number, playing: boolean) {
  const atEnd = index >= totalSteps - 1;
  return { atEnd, canPlay: totalSteps > 1, label: playing ? "Pause" : atEnd ? "Replay" : "Play" };
}
export function systemState(grid: ApiGridResponse | null, cascade: ApiCascadeResponse | null, stepIndex: number, running: boolean): SystemState {
  if (!grid) return "Unknown";
  // The header describes the displayed step, not a future final result.
  const finalStep = cascade && stepIndex === cascade.steps.length - 1;
  if (grid.metrics.load_lost_percent >= 80 || (finalStep && cascade.termination_reason === "total_blackout")) return "Blackout";
  if (running || (cascade && stepIndex > 0 && cascade.steps[stepIndex]?.event === "cascade_step")) return "Cascade";
  if (grid.metrics.failed_components > 0 || grid.metrics.total_unserved_mw > .01 || grid.nodes.some((item) => item.status !== "healthy") || grid.lines.some((item) => item.status !== "healthy")) return "Stressed";
  return "Healthy";
}
