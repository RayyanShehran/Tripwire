# Tripwire Technical Report Outline

## 1. Introduction

Introduce cascading failures in transmission grids and the motivation for an educational decision-support prototype.

## 2. Problem Statement

Define the challenge: visualizing grid state, triggering an initial outage, simulating propagation, estimating risk, and evaluating mitigation candidates.

## 3. Objectives

List implemented objectives and distinguish them from future work.

## 4. System Architecture

Describe the Next.js frontend, FastAPI backend, simulation modules, ML modules, and API boundary.

## 5. Power Grid Modeling

Explain the synthetic 8-bus pandapower network, generators, loads, transmission lines, status thresholds, and baseline health checks.

## 6. Cascading Failure Algorithm

Describe the deterministic loop: apply initial outage, run power flow, trip overloaded lines, repeat until stable, blackout, or maximum depth.

## 7. Dataset Generation

Describe synthetic operating conditions, failure candidates, pre-failure features, post-cascade targets, validation checks, and metadata.

## 8. Machine Learning

Describe classifier/regressor targets, feature leakage prevention, split strategy, model families, metrics, saved artifacts, and limitations.

## 9. Mitigation Strategy

Describe candidate generation, generator redispatch, controlled load shedding, feasibility filters, simulation-based scoring, and before/after comparison.

## 10. Frontend Visualization

Describe React Flow grid rendering, node/line types, status colors, side panel, metrics, timeline playback, demo presets, and summary panels.

## 11. Testing

Summarize backend unit/integration tests, frontend lint/build checks, CI workflow, and deterministic demo preset regression tests.

## 12. Results

Report only measured outcomes from the current system, such as deterministic demo scenario outputs and test results. Do not fabricate real-world validation.

## 13. Limitations

State that the grid and dataset are synthetic, ML is trained on generated scenarios, mitigations are bounded examples, and the system is not operationally validated.

## 14. Future Work

Mention larger grid cases, real datasets, more realistic protection models, richer mitigation actions, deployment, authentication, and explainable ML.

## 15. Conclusion

Summarize what Tripwire demonstrates and how it supports understanding of cascading failure risk.
