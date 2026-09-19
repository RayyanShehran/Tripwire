# Proposed v1.0.0-demo Release Notes

Tripwire `v1.0.0-demo` is the first complete university demonstration release of
the power-grid cascade analysis workflow. It combines an editable transmission
network, pandapower AC power flow, deterministic outage propagation, step-by-step
visual replay, baseline ML risk estimates, and simulation-tested mitigation.

## Demonstration Highlights

- Inspect generators, buses, loads, lines, electrical values, and status.
- Build and validate custom grids, save them locally, and transfer them as JSON.
- Trigger one component outage and replay each secondary line trip.
- Compare baseline demand, served and unserved load, failed components, depth,
  peak loading, and blackout severity.
- Predict cascade probability for the built-in topology using saved models.
- Rank bounded redispatch and load-shedding candidates by simulated improvement.
- Run deterministic presets suitable for a repeatable assessed demonstration.

## Evidence

The release audit passed 110 backend tests, 27 frontend unit tests, 15 Playwright
tests, frontend lint, the optimized Next.js build, and a deployed production smoke
workflow. The evidence set contains 12 screenshots at 1440 x 900. Exact measured
simulation, dataset, and model results are in `docs/final-results.md`.

## Important Limitations

This is a research and teaching prototype. Its network and training data are
synthetic, the protection model is simplified, the regressor has limited accuracy,
and no result has been validated for real grid operations. Recommendations are
simulation experiments, not operational instructions.

The release name is proposed only. Creating or pushing the `v1.0.0-demo` Git tag
requires a separate explicit authorization after the final commit is reviewed.
