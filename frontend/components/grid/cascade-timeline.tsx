"use client";

import type { ApiCascadeResponse, ApiCascadeStep } from "./api";

type CascadeTimelineProps = {
  cascade: ApiCascadeResponse | null;
  currentStepIndex: number;
  isPlaying: boolean;
  onNextStep: () => void;
  onPlaybackSpeedChange: (speed: number) => void;
  onPreviousStep: () => void;
  onSelectStep: (stepIndex: number) => void;
  onTogglePlayback: () => void;
  playbackSpeed: number;
};

export function CascadeTimeline({
  cascade,
  currentStepIndex,
  isPlaying,
  onNextStep,
  onPlaybackSpeedChange,
  onPreviousStep,
  onSelectStep,
  onTogglePlayback,
  playbackSpeed,
}: CascadeTimelineProps) {
  if (!cascade) {
    return null;
  }

  const totalSteps = cascade.steps.length;
  const currentStep = cascade.steps[currentStepIndex] ?? cascade.steps[0];

  return (
    <section className="border-b border-slate-800 bg-slate-950 px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-50">
            Cascade Step {currentStepIndex + 1} of {totalSteps}
          </h2>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.16em] text-cyan-300">
            {formatEvent(currentStep.event)}
          </p>
        </div>
        <PlaybackControls
          canGoNext={currentStepIndex < totalSteps - 1}
          canGoPrevious={currentStepIndex > 0}
          isPlaying={isPlaying}
          onNextStep={onNextStep}
          onPlaybackSpeedChange={onPlaybackSpeedChange}
          onPreviousStep={onPreviousStep}
          onTogglePlayback={onTogglePlayback}
          playbackSpeed={playbackSpeed}
          totalSteps={totalSteps}
        />
        <div className="text-right text-xs text-slate-500">
          <div>Termination: {formatReason(cascade.termination_reason)}</div>
          <div>Depth: {cascade.cascade_depth}</div>
        </div>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {cascade.steps.map((step, index) => (
          <TimelineItem
            isActive={index === currentStepIndex}
            key={step.step}
            onClick={() => onSelectStep(index)}
            step={step}
          />
        ))}
      </div>
    </section>
  );
}

function PlaybackControls({
  canGoNext,
  canGoPrevious,
  isPlaying,
  onNextStep,
  onPlaybackSpeedChange,
  onPreviousStep,
  onTogglePlayback,
  playbackSpeed,
  totalSteps,
}: {
  canGoNext: boolean;
  canGoPrevious: boolean;
  isPlaying: boolean;
  onNextStep: () => void;
  onPlaybackSpeedChange: (speed: number) => void;
  onPreviousStep: () => void;
  onTogglePlayback: () => void;
  playbackSpeed: number;
  totalSteps: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:text-slate-600"
        disabled={!canGoPrevious}
        onClick={onPreviousStep}
        title="Show previous cascade step"
        type="button"
      >
        Previous
      </button>
      <button
        className="rounded-md border border-cyan-400 bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
        disabled={totalSteps <= 1 || (!canGoNext && !isPlaying)}
        onClick={onTogglePlayback}
        title={isPlaying ? "Pause cascade playback" : "Play cascade playback"}
        type="button"
      >
        {isPlaying ? "Pause" : "Play"}
      </button>
      <button
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:text-slate-600"
        disabled={!canGoNext}
        onClick={onNextStep}
        title="Show next cascade step"
        type="button"
      >
        Next
      </button>
      <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
        Speed
        <select
          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-xs font-semibold text-slate-200"
          onChange={(event) => onPlaybackSpeedChange(Number(event.target.value))}
          title="Cascade playback speed"
          value={playbackSpeed}
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
        </select>
      </label>
    </div>
  );
}

function TimelineItem({
  isActive,
  onClick,
  step,
}: {
  isActive: boolean;
  onClick: () => void;
  step: ApiCascadeStep;
}) {
  return (
    <button
      aria-current={isActive ? "step" : undefined}
      className={`min-w-56 rounded-md border px-3 py-2 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-cyan-300/70 ${
        isActive
          ? "border-cyan-400 bg-cyan-400/10"
          : "border-slate-800 bg-slate-900/70 hover:border-slate-600"
      }`}
      onClick={onClick}
      title={`Show ${formatEvent(step.event)} step ${step.step}`}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-50">Step {step.step}</span>
        <span className="text-xs text-slate-500">{formatEvent(step.event)}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
        {describeStep(step)}
      </p>
      <div className="mt-2 text-xs font-medium text-slate-300">
        Lost {formatPercent(loadLostPercent(step))}%
      </div>
    </button>
  );
}

function describeStep(step: ApiCascadeStep) {
  const events: string[] = [];

  if (step.newly_failed_components.length > 0) {
    events.push(`Failed: ${step.newly_failed_components
      .map((component) => component.component_id)
      .join(", ")}`);
  }

  if (step.overloaded_lines.length > 0) {
    events.push(`Overloaded: ${step.overloaded_lines
      .map((line) => line.component_id)
      .join(", ")}`);
  }

  return events.length > 0 ? events.join("; ") : "Network stabilized";
}

function loadLostPercent(step: ApiCascadeStep) {
  if (step.metrics.total_demand_mw === 0) {
    return 0;
  }

  return (step.metrics.unserved_load_mw / step.metrics.total_demand_mw) * 100;
}

function formatEvent(event: ApiCascadeStep["event"]) {
  const labels: Record<ApiCascadeStep["event"], string> = {
    cascade_step: "Secondary Failure",
    initial_failure: "Initial Failure",
    power_flow_failed: "Power Flow Failed",
  };

  return labels[event];
}

function formatPercent(value: number) {
  return value.toFixed(1);
}

function formatReason(reason: string) {
  return reason.replaceAll("_", " ");
}
