# Changelog

All notable changes to Tripwire are documented here.

## [Unreleased]

### Changed

- Deferred scikit-learn imports and model deserialization until the first risk
  prediction, reducing measured local API-ready time from roughly 15 seconds to
  6-9 seconds while retaining lightweight startup and readiness artifact checks.

## [1.0.0-demo] - Proposed 2026-09-19

### Added

- Interactive React Flow transmission-network visualization and component details.
- Versioned Grid Scenario Builder with validation, undo/redo, presets, and JSON transfer.
- pandapower baseline, outage, and deterministic cascading-failure simulation.
- Step-by-step timeline playback and blackout severity metrics.
- Synthetic dataset generation, diagnostics, and baseline scikit-learn models.
- Simulation-ranked redispatch and controlled load-shedding recommendations.
- Deterministic Low Risk, Severe Cascade, and Mitigation Example presets.
- Vercel frontend, Render API configuration, readiness checks, and CI.
- Production smoke runner and 12 release screenshots.

### Verified

- 113 backend tests, 27 frontend unit tests, and 15 browser tests pass.
- Frontend lint and optimized production build pass.
- Deployed API, grid editing, custom analysis, prediction, cascade, replay,
  mitigation comparison, reset, import/export, and local scenario persistence pass.

### Known Limitations

- Synthetic teaching network and generated data; no real utility validation.
- ML inference is restricted to the built-in topology.
- Browser-local persistence only; no authentication or shared scenario store.
- Research demonstration only, not for operational use.
