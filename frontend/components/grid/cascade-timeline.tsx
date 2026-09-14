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
    <section className="border-b border-neutral-200 bg-white px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-950">
            Cascade Step {currentStepIndex + 1} of {totalSteps}
          </h2>
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
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
        <div className="text-right text-xs text-neutral-600">
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
        className="rounded border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-400"
        disabled={!canGoPrevious}
        onClick={onPreviousStep}
        title="Show previous cascade step"
        type="button"
      >
        Previous
      </button>
      <button
        className="rounded bg-neutral-950 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
        disabled={totalSteps <= 1 || (!canGoNext && !isPlaying)}
        onClick={onTogglePlayback}
        title={isPlaying ? "Pause cascade playback" : "Play cascade playback"}
        type="button"
      >
        {isPlaying ? "Pause" : "Play"}
      </button>
      <button
        className="rounded border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-400"
        disabled={!canGoNext}
        onClick={onNextStep}
        title="Show next cascade step"
        type="button"
      >
        Next
      </button>
      <label className="flex items-center gap-2 text-xs font-medium text-neutral-600">
        Speed
        <select
          className="rounded border border-neutral-300 bg-white px-2 py-2 text-xs font-semibold text-neutral-800"
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
      className={`min-w-56 rounded border px-3 py-2 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-red-700 ${
        isActive
          ? "border-red-700 bg-red-50"
          : "border-neutral-200 bg-neutral-50 hover:border-neutral-300"
      }`}
      onClick={onClick}
      title={`Show ${formatEvent(step.event)} step ${step.step}`}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-neutral-950">Step {step.step}</span>
        <span className="text-xs text-neutral-500">{formatEvent(step.event)}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-600">
        {describeStep(step)}
      </p>
      <div className="mt-2 text-xs font-medium text-neutral-700">
        Lost {formatPercent(loadLostPercent(step))}%
      </div>
    </button>
  );
}

function describeStep(step: ApiCascadeStep) {
  if (step.newly_failed_components.length > 0) {
    return `Failed: ${step.newly_failed_components
      .map((component) => component.component_id)
      .join(", ")}`;
  }

  if (step.overloaded_lines.length > 0) {
    return `Overloaded: ${step.overloaded_lines
      .map((line) => line.component_id)
      .join(", ")}`;
  }

  return "Network stabilized";
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
