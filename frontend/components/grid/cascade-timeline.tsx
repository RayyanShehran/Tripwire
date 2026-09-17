"use client";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import type { ApiCascadeResponse, ApiCascadeStep } from "./api";
import { ActionButton } from "../ui/action-button";
import { playbackState } from "./presentation";
type CascadeTimelineProps = {
  cascade: ApiCascadeResponse | null; currentStepIndex: number; isPlaying: boolean;
  onNextStep: () => void; onPlaybackSpeedChange: (speed: number) => void;
  onPreviousStep: () => void; onSelectStep: (stepIndex: number) => void; onTogglePlayback: () => void; playbackSpeed: number;
};
export function CascadeTimeline({ cascade, currentStepIndex, isPlaying, onNextStep, onPlaybackSpeedChange, onPreviousStep, onSelectStep, onTogglePlayback, playbackSpeed }: CascadeTimelineProps) {
  if (!cascade) return null;
  const playback = playbackState(cascade.steps.length, currentStepIndex, isPlaying);
  const Icon = isPlaying ? Pause : playback.atEnd ? RotateCcw : Play;
  return <section className="cascade-timeline" aria-label="Cascade timeline">
    <header className="timeline-header"><div><h2>Cascade timeline</h2><p className="muted" aria-live="polite">Step {currentStepIndex + 1} / {cascade.steps.length}</p></div>
      <div className="playback-controls">
        <ActionButton className="icon-button" disabled={currentStepIndex === 0} icon={<ChevronLeft />} aria-label="Previous step" title="Previous step" onClick={onPreviousStep} variant="ghost" />
        <ActionButton disabled={!playback.canPlay} icon={<Icon />} onClick={onTogglePlayback} variant="primary" title={playback.label}>{playback.label}</ActionButton>
        <ActionButton className="icon-button" disabled={playback.atEnd} icon={<ChevronRight />} aria-label="Next step" title="Next step" onClick={onNextStep} variant="ghost" />
        <label className="speed-control"><span className="eyebrow">Speed</span><select value={playbackSpeed} onChange={(event) => onPlaybackSpeedChange(Number(event.target.value))}><option value={.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option></select></label>
      </div>
    </header>
    <ol className="timeline-steps">{cascade.steps.map((step, index) => <li key={step.step}>
      <button type="button" aria-current={index === currentStepIndex ? "step" : undefined} onClick={() => onSelectStep(index)} title={describeStep(step)}>
        <span className={`step-number ${step.metrics.load_lost_percent >= 80 ? "step-blackout" : ""}`}>{step.step}</span>
        <span><strong>{step.metrics.load_lost_percent >= 80 ? "Blackout" : step.event === "initial_failure" ? "Initial failure" : step.event === "power_flow_failed" ? "Solver stopped" : "Secondary trip"}</strong><small>{step.metrics.load_lost_percent.toFixed(1)}% loss / {step.metrics.failed_lines} failed lines</small></span>
      </button>
    </li>)}</ol>
    <div className="timeline-outcome"><span className="eyebrow">Final outcome</span><span>{cascade.termination_reason.replaceAll("_", " ")} / depth {cascade.cascade_depth}</span></div>
  </section>;
}
function describeStep(step: ApiCascadeStep) {
  return [`Step ${step.step}`, ...step.newly_failed_components.map((item) => `Failed: ${item.component_id}`), ...step.overloaded_lines.map((item) => `Overload: ${item.component_id} (${item.loading_percent.toFixed(1)}%)`)].join("; ");
}
