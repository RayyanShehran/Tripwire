# Tripwire Final Results

## Release Scope

This audit freezes the implemented university demonstration as the proposed
`v1.0.0-demo` release. No utility-grade claims are made, no Git tag is created,
and no remote is updated by this audit.

Production endpoints verified on September 19, 2026:

- Frontend: https://tripwire-eta.vercel.app
- API: https://tripwire-api-4ecd.onrender.com
- Health: `GET /health` returned `{"status":"ok"}`.
- Readiness: `GET /ready` returned `ready` with simulator and model checks `ok`.

## Baseline Network

| Measure | Verified value |
| --- | ---: |
| Buses | 8 |
| Transmission lines | 12 |
| Generators | 3 |
| Loads | 4 |
| Original demand | 400.0 MW |
| Served load | 400.0 MW |
| Unserved load | 0.0 MW |
| Solved generation | 400.89 MW |
| Load lost | 0.0% |
| Maximum line loading | 24.45% |

The baseline AC power flow converges and all components are healthy. Lines are
healthy below 80%, stressed from 80% through 100%, overloaded above 100%, and
failed when out of service or unsupplied. Cascades trip in-service lines above
100% loading. The default maximum is 20 cascade steps. Termination reasons are
`stable`, `max_steps_reached`, `power_flow_failed`, `total_blackout`, and
`no_additional_failures`.

## Deterministic Demo Outcomes

| Preset | Initial outage | Result | Depth | Failed lines | Load lost | Peak loading |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Low Risk | `line-402` | Stable | 0 | 1 | 0.0% | 28.32% |
| Severe Cascade | `line-101` | Total blackout | 2 | 12 | 100.0% | 131.26% |
| Mitigation Example | `line-101` | Total blackout before mitigation | 2 | 12 | 100.0% | 131.26% |

The top mitigation for the demonstration case is 5% system-wide controlled load
shedding. It serves 475 MW of the original 500 MW, limits total unserved load to
25 MW, leaves one failed line, terminates stable at depth 0, and reduces load loss
from 100% to 5%, an improvement of 95 percentage points.

## Dataset Audit

The generated dataset is reproducible with seed 42 and is intentionally ignored
by Git; its schema metadata and trained artifacts are retained separately.

| Measure | Verified value |
| --- | ---: |
| Scenarios | 3,000 |
| Total columns | 48 |
| Pre-failure feature columns | 36 |
| Post-cascade target columns | 11 |
| Positive cascades | 709 (23.63%) |
| Negative cascades | 2,291 (76.37%) |
| Missing / non-finite / duplicate rows | 0 / 0 / 0 |
| Failed or excluded simulations | 0 |

Severity distribution: LOW 1,625; MODERATE 136; HIGH 389; CRITICAL 850.
Cascade-depth distribution: depth 0: 2,291; depth 1: 73; depth 2: 507;
depth 3: 128; depth 4: 1. Termination distribution: stable 2,246 and total
blackout 754. `cascade_happened` means at least one secondary failure after the
initial outage, not merely the requested initial failure.

## Model Audit

The classifier is logistic regression and the load-loss regressor is a random
forest. Both use only pre-failure features and grouped splits by initial component.

| Classifier metric | Value |
| --- | ---: |
| Accuracy | 0.8608 |
| Precision | 0.6569 |
| Recall | 0.8771 |
| F1 | 0.7512 |
| ROC AUC | 0.9132 |

Classifier confusion matrix: `[[486, 82], [22, 157]]`.

| Regressor metric | Value |
| --- | ---: |
| MAE | 23.2752 percentage points |
| RMSE | 41.4950 percentage points |
| R2 | 0.2961 |
| Severe-blackout MAE | 45.1114 percentage points |

The regressor has limited predictive quality, especially on severe outcomes.
The UI therefore presents cascade probability as the primary model signal and
load-loss prediction as an uncertain secondary estimate. Neither model is
validated on real utility data.

## Verification Matrix

| Check | Result |
| --- | --- |
| Backend pytest | 113 passed |
| Frontend unit tests | 27 passed |
| Frontend lint | Passed |
| Next.js production build and type check | Passed |
| Playwright end-to-end suite | 15 passed |
| Desktop layouts | 1366x768, 1440x900, and 1920x1080 passed |
| Production smoke and evidence runner | Passed |
| Release screenshots | 12 PNG files, each 1440x900 |

Verified local toolchain: Python 3.12.14, Node.js 22.16.0, pnpm 11.19.0,
FastAPI 0.141.1, pandapower 3.5.4, NetworkX 3.6.1, NumPy 2.4.6,
pandas 2.3.3, scikit-learn 1.9.0, Next.js 15.5.24, React 19.2.8,
React Flow 12.11.5, Recharts 2.15.4, TypeScript 5.9.3, and Tailwind CSS 3.4.19.

## Security And Repository Audit

- No credential-like content or private-key material was found in tracked files.
- Only `.env.example` files are tracked; real `.env` variants are ignored.
- Production CORS uses explicit configured origins and disables the localhost
  origin regex through `render.yaml`; wildcard credentialed origins are rejected.
- Unexpected API exceptions are logged server-side and return a generic message.
- Pydantic rejects invalid and non-finite request values; imported scenarios are
  schema-version checked and electrically validated before analysis.
- Python caches, virtual environments, Node modules, Next.js output, Playwright
  output, logs, and generated datasets are ignored. No generated runtime artifact
  is tracked except the intentional generated-data `.gitkeep`.

## Known Limitations

- Synthetic 8-bus teaching network and synthetic training scenarios only.
- No validation against utility telemetry, protection models, or operator studies.
- Cascading protection behavior is a deterministic overload-trip abstraction.
- Custom topology is supported by simulation but not by the trained ML models.
- Saved custom scenarios live only in browser local storage.
- No authentication, multi-user persistence, or cloud scenario synchronization.
- Mitigation candidates are bounded simulation experiments, not control advice.
- The free Render service can require a cold-start wait before a demonstration.

The next credible research step is validation on a recognized benchmark network
and independently sourced operating cases, followed by model recalibration and
uncertainty reporting. Those items are deliberately outside this demo release.
