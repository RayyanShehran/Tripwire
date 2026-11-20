# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Tripwire is a power-grid cascading-failure simulator and decision-support demo: a FastAPI + pandapower backend (`backend/`) and a Next.js 15 / React 19 / React Flow frontend (`frontend/`). All data is synthetic; it is a university demo, not an operational tool. Keep this framing in UI text and docs: mitigation results are "Recommended based on Tripwire simulation", and the ML models are not utility-grade.

## Commands

Backend (run from `backend/`, Python 3.12, venv at `backend/.venv`):

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
.\.venv\Scripts\python.exe -m pytest -q                                   # all tests
.\.venv\Scripts\python.exe -m pytest tests/test_cascade.py -q             # one file
.\.venv\Scripts\python.exe -m pytest tests/test_cascade.py -k name -q     # one test
.\.venv\Scripts\python.exe scripts\generate_dataset.py --seed 42          # offline dataset -> data/generated/
.\.venv\Scripts\python.exe scripts\analyze_dataset.py                     # dataset diagnostics
.\.venv\Scripts\python.exe scripts\train_models.py                        # retrain -> models/*.joblib + model_metadata.json
```

Frontend (run from `frontend/`, pnpm 11, Node 22; set `NEXT_PUBLIC_API_URL` in `.env.local`, default `http://127.0.0.1:8000`):

```powershell
pnpm dev
pnpm lint                                      # eslint
pnpm test                                      # node --test tests/*.test.mjs (unit)
node --test tests/scenario-state.test.mjs      # one unit test file
pnpm build                                     # production build (also the typecheck)
pnpm test:e2e                                  # Playwright; auto-starts backend (via backend/.venv) and frontend on 127.0.0.1:8000/3000
pnpm exec playwright test tests/e2e/core-workflow.spec.ts
pnpm release:evidence                          # regenerates docs/screenshots
```

CI (`.github/workflows/ci.yml`) runs backend pytest, frontend lint + unit tests + build, then the Chromium Playwright suite.

## Architecture

**Stateless scenarios.** No endpoint keeps simulation state between requests. Every request (`/api/failure`, `/api/cascade`, `/api/predict`, `/api/recommend`, `GET /api/grid` with operating-condition query params) is normalized into an immutable `ScenarioConfig` (`backend/app/simulation/config.py`). Networks are built only through `build_scenario_network(config)`. Responses carry a deterministic `scenario_id` fingerprint, which excludes the mitigation action so baseline and mitigated runs can be matched. Don't add process-level grid state.

**One topology path.** `backend/app/simulation/definition.py` defines the versioned `GridDefinition` (schema version 1). The built-in 8-bus 230 kV grid is itself a `GridDefinition`, and `build_network_from_definition()` is the only way topology becomes a pandapower network, for both built-in and user-edited grids. Validation separates hard errors from islanding warnings; unsupplied islands must still solve with finite metrics. Failure, cascade, and recommendation accept a custom `grid_definition` in the body. Prediction rejects any topology that doesn't exactly match the built-in one, because the models were trained only on it.

**Simulation layers** (`backend/app/simulation/`): `grid.py` runs power flow, sets status and serializes JSON. `scenario.py` handles single failures; blackouts return HTTP 200 with finite metrics, never NaN. `cascade.py` repeatedly trips lines over `CASCADE_TRIP_THRESHOLD_PERCENT` and re-solves, returning every step. `mitigation.py` simulates bounded redispatch and load-shedding candidates and ranks them by the actual simulated outcome. `demo.py` holds the deterministic presets that tests and docs depend on. Mitigation load accounting must preserve `served + controlled shed + involuntary unserved = original demand`.

**ML** (`backend/app/ml/`): `features.py` is the single authoritative pre-failure feature list. Never add post-cascade targets as features. `schemas.py` holds the targets, model version and risk thresholds. `dataset.py` and `train.py` are offline only and not exposed as API. scikit-learn and the models load lazily on the first `/api/predict` call to keep startup fast. `/ready` only checks that the artifact files exist. Committed artifacts live in `backend/models/`. Changing features means regenerating the dataset, retraining, and committing the new artifacts.

**Backend config** (`backend/app/config.py`): env vars `ALLOWED_ORIGINS`, `ALLOW_ORIGIN_REGEX`, `MODEL_PATH`, `DATA_PATH` (legacy `MODEL_DIR`/`DATA_DIR` still accepted), `LOG_LEVEL`. Deployment: Render (`render.yaml`, `Procfile`) for the API and Vercel for the frontend. See `docs/deployment.md`.

**Frontend** is effectively one screen: `app/page.tsx` renders `components/grid/grid-visualization.tsx`, which orchestrates everything. `components/grid/api.ts` holds the API client and response types. State is split into three independent domains:
- `GridDefinition` (electrical, managed by `grid-editor-state.ts`: immutable CRUD, undo/redo capped at 50, localStorage drafts and presets, JSON import/export with `schema_version`)
- `OperatingCondition` plus analysis results (`scenario-state.ts` reducer; a revision counter drops late responses, and fingerprints prevent mismatched comparisons)
- `VisualLayout` (`layout-state.ts`; moving nodes never changes the electrical definition)

Electrical edits invalidate prediction, cascade and mitigation results. Reset clears all scenario state. Cascade playback steps through the stored response and never re-requests.

**Frontend unit-test constraint.** `tests/*.test.mjs` read a single `.ts` source file, transpile it with `ts.transpileModule`, and evaluate it with `new Function("exports", ...)`. So the pure-logic modules they test (`scenario-state.ts`, `grid-editor-state.ts`, `layout-state.ts`, `presentation.ts`, `edge-label-layout.ts`) can only use `import type` imports. A runtime import breaks those tests.

## Docs

`README.md` and `docs/architecture.md` describe API contracts, thresholds and methodology in detail. `docs/final-results.md` and `CHANGELOG.md` record verified test counts and release results. When endpoints, thresholds, presets or commands change, update the matching docs.
