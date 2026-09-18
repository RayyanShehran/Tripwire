# Tripwire

Tripwire is a web-based power-grid cascading failure simulation and decision-support platform.

This repository contains a deployed working version of Tripwire. It includes a FastAPI backend that builds and solves a small pandapower transmission network, a deterministic cascading-failure engine, baseline scikit-learn risk models trained on synthetic Tripwire scenarios, and a Next.js frontend that renders the network with React Flow.

Tripwire remains a university/demo project; its results are based on synthetic simulation data.

## Live Demo

Frontend: https://tripwire-eta.vercel.app

API: https://tripwire-api-4ecd.onrender.com

Deployment instructions are in `docs/deployment.md`.

## Project Structure

```text
tripwire/
  frontend/      Next.js, TypeScript, Tailwind CSS, React Flow, Recharts
  backend/       FastAPI service for grid simulation APIs
  backend/models Saved baseline ML pipelines and metadata
  docs/          Architecture and project documentation
```

## System Architecture

Tripwire is split into a browser frontend and a Python API backend.

- The frontend renders the interactive transmission-network interface with generators, buses, loads, transmission lines, solved metrics, selection details, single-component failure controls, and cascade timeline playback.
- The backend exposes stateless API endpoints for health checks, the solved baseline grid, one-off component failure simulation, deterministic cascade simulation, baseline reset, and synthetic-scenario ML risk prediction.
- The backend recommends mitigation actions by simulating bounded intervention candidates and ranking their actual simulated outcomes.
- The frontend communicates with the backend through the `NEXT_PUBLIC_API_URL` environment variable.

Current backend libraries:

- `pandapower` for electrical network modeling and power-flow analysis.
- `NetworkX` for topology features used by the scenario dataset and ML models.
- `NumPy` and `pandas` for numerical and tabular data processing.
- `scikit-learn` for the trained cascade classifier and load-loss regressor.

## Dataset Pipeline

Tripwire includes an offline dataset generator that produces the synthetic training data used by the current baseline ML models. Dataset generation and model training remain offline workflows rather than public API operations.

Pipeline:

```text
pandapower simulation -> configurable operating profiles -> deterministic cascade outcomes -> CSV dataset -> model training -> saved prediction pipelines
```

Generate the default dataset from `tripwire/backend`:

```powershell
.\.venv\Scripts\python.exe scripts\generate_dataset.py --seed 42
```

Default output:

```text
backend/data/generated/tripwire_scenarios.csv
backend/data/generated/dataset_metadata.json
```

Useful options:

```powershell
.\.venv\Scripts\python.exe scripts\generate_dataset.py `
  --output data\generated\tripwire_scenarios.csv `
  --seed 42 `
  --load-multipliers 1.0,1.15,1.25,1.35,1.5 `
  --generation-multipliers 0.8,0.9,1.0,1.1 `
  --line-rating-multipliers 0.6,0.5,0.45,0.4,0.38,0.35,0.32 `
  --component-types line,bus `
  --max-scenarios 3000
```

Scenario generation varies load demand, generator availability, generator dispatch profile, line thermal-rating stress, and initial component failure independently. The healthy application baseline is not changed; dataset scenarios may intentionally represent stressed operating conditions.

Feature columns are pre-failure inputs only, including operating condition, available generation capacity, reserve margin, grid loading, component loading/capacity, endpoint voltages, endpoint load/generation context, and topology features. Target columns are post-cascade outcomes, including cascade depth, failed components, unserved load, load lost percentage, termination reason, and severity label.

`reserve_margin_mw` is computed as:

```text
available_generation_capacity_mw - total_demand_mw
```

`reserve_margin_percent` is computed as:

```text
reserve_margin_mw / total_demand_mw * 100
```

These reserve features use only pre-failure scenario configuration and demand, not post-failure solved generation.

`cascade_happened` is defined as true only when at least one secondary failure occurs after the initial failure.

Analyze the generated CSV:

```powershell
.\.venv\Scripts\python.exe scripts\analyze_dataset.py
```

The diagnostics report dataset size, positive cascade rate, severity distribution, feature ranges, constant columns, imbalanced categorical values, missing values, non-finite values, and duplicate scenario IDs.

## Baseline ML Models

Tripwire trains two baseline models from the generated synthetic scenario dataset:

- Cascade classifier: predicts the probability that an initial outage causes at least one secondary failure.
- Load-loss regressor: predicts final load lost percentage after the full cascade.

Training uses separate grouped training, validation, and final test partitions. Candidate
models are selected on validation data; the final test split is used only for reporting.
Because synthetic load-loss outcomes are strongly concentrated around zero loss and total
blackout, the UI treats cascade probability as the primary signal and labels load loss as
a secondary estimate with model uncertainty.

Training uses a single authoritative pre-failure feature list. It excludes post-cascade targets such as cascade depth, failed components, final served/unserved load, termination reason, and severity.

Train models from `tripwire/backend`:

```powershell
.\.venv\Scripts\python.exe scripts\train_models.py
```

Artifacts are written to:

```text
backend/models/cascade_classifier.joblib
backend/models/load_loss_regressor.joblib
backend/models/model_metadata.json
```

Current risk thresholds are based on cascade probability:

```text
LOW: 0.00 <= p < 0.25
MODERATE: 0.25 <= p < 0.50
HIGH: 0.50 <= p < 0.75
CRITICAL: 0.75 <= p <= 1.00
```

This ML risk level is separate from load-loss severity labels. These models are trained on Tripwire's synthetic simulation scenarios and should not be described as utility-grade or real-world blackout prediction models.

## Simulation-Based Mitigation

Tripwire can evaluate a bounded set of candidate interventions for a risky scenario and rank them by simulated improvement. Recommendations are generated by the simulation engine, not by an LLM.

Implemented action types:

- Generator redispatch: shift 5% or 10% output between available controllable generators while respecting non-negative output and configured capacity.
- Controlled load shedding: shed 2%, 5%, or 10% at each load bus or across all load buses.

Every recommendation request first simulates the unmitigated baseline, then simulates each feasible mitigation candidate before the initial failure. The ranking score is:

```text
load_loss_reduction * 10
+ failed_component_reduction * 2
+ cascade_depth_reduction * 3
- intervention_cost * 0.25
```

The UI and API describe results as "Recommended based on Tripwire simulation." They are not guarantees.

## Current Grid Model

The backend creates a small 230 kV teaching network with:

- 8 buses.
- 3 generators, including one slack grid source.
- 4 loads.
- 12 transmission lines.

The backend runs a normal pandapower power-flow calculation before returning grid data. The baseline scenario is intentionally healthy, with all components in service and all line loading below the stressed threshold.

Status thresholds:

- Healthy: line loading below 80%.
- Stressed: line loading from 80% to 100%, or bus voltage outside the normal range.
- Overloaded: line loading above 100%.
- Failed: component is out of service, disconnected, unsupplied, or has no valid solved value.

## API Endpoints

```text
GET /health
GET /ready
GET /api/grid
GET /api/demo-presets
POST /api/failure
POST /api/cascade
POST /api/reset
GET /api/reset
POST /api/predict
POST /api/recommend
```

Scenario endpoints do not share hidden simulation state:

- `GET /api/grid` returns the healthy solved baseline by default; operating-condition query parameters return the matching pre-failure grid.
- `POST /api/failure`, `/api/cascade`, `/api/predict`, and `/api/recommend` use the same operating-condition fields and deterministic scenario fingerprint.
- `POST /api/failure` starts from the requested operating condition, applies one requested outage, and returns that solved or blackout scenario.
- `POST /api/cascade` starts from the same requested operating condition, applies one requested initial outage, and then trips overloaded lines step by step.
- `POST /api/reset` and `GET /api/reset` return the healthy baseline.

Outages do not carry over into later requests.

`backend/app/simulation/config.py` is the authoritative scenario definition. Its immutable `ScenarioConfig` contains the load, generation, dispatch, line-rating, initial-failure, preset, and seed inputs. Prediction, failure, cascade, dataset generation, and mitigation all build networks through the same helper. API responses include `scenario_id` and `scenario_config` so clients can verify that results belong to the same case.

The frontend Reset Scenario action uses full-reset semantics: it clears selection, prediction, failure, original cascade, mitigation recommendations, selected mitigation, and mitigated cascade, then returns the operating profile and rendered grid to baseline.

Failure request body:

```json
{
  "component_type": "line",
  "component_id": "line-101"
}
```

Supported component types:

```text
bus | line | generator | load
```

Useful component IDs in the sample grid include:

```text
bus-0, bus-1, bus-2, bus-3, bus-4, bus-5, bus-6, bus-7
line-101, line-102, line-103, line-104, line-201, line-202, line-203, line-301, line-302, line-401, line-402, line-403
gen-north, gen-south, gen-harbor
load-east, load-metro, load-west, load-harbor
```

## Local Development

### Backend

From `tripwire/backend`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Optional backend environment settings are documented in `backend/.env.example`:

```text
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
ALLOW_ORIGIN_REGEX=http://(localhost|127\.0\.0\.1):30\d{2}
MODEL_PATH=C:\Projects\Tripwire\Tripwire\backend\models
DATA_PATH=C:\Projects\Tripwire\Tripwire\backend\data
LOG_LEVEL=INFO
```

Health check:

```powershell
curl http://127.0.0.1:8000/health
```

Expected response:

```json
{"status":"ok"}
```

Readiness check:

```powershell
curl http://127.0.0.1:8000/ready
```

Readiness verifies that the simulator initializes and model artifacts can load.

Grid check:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/grid
```

Simulate one component failure:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/failure `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"component_type":"line","component_id":"line-101"}'
```

Single-failure responses wrap the rendered grid with scenario metadata:

```json
{
  "status": "solved",
  "termination_reason": "solved",
  "initial_failure": {
    "component_type": "line",
    "component_id": "line-101"
  },
  "grid": {
    "nodes": [],
    "lines": [],
    "metrics": {}
  },
  "metrics": {}
}
```

If the initial outage disconnects the source bus, the API still returns HTTP 200 with a valid blackout response. Load metrics report zero served load and 100% load lost instead of returning non-finite JSON values.

Reset the scenario:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/reset -Method Post
```

Run a deterministic cascade from an initial failure:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/cascade `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"component_type":"line","component_id":"line-101","max_steps":20,"operating_condition":{"load_multiplier":1.5,"generation_multiplier":1.0,"line_rating_multiplier":0.32,"dispatch_profile":"balanced"}}'
```

The cascade engine stores every simulated step in the response. The frontend keeps that response in memory and lets the user step through it without requesting a new backend simulation. If no operating condition is supplied, the cascade runs on the healthy baseline profile.

Predict cascade risk before running a simulation:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/predict `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"component_type":"line","component_id":"line-101","operating_condition":{"load_multiplier":1.5,"generation_multiplier":1.0,"line_rating_multiplier":0.32,"dispatch_profile":"balanced"}}'
```

The prediction endpoint constructs only the pre-failure scenario features and then runs the saved ML pipelines. It does not run the cascade to derive the answer.

Find simulation-validated mitigations:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/recommend `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"component_type":"line","component_id":"line-101","operating_condition":{"load_multiplier":1.25,"generation_multiplier":1.0,"line_rating_multiplier":0.35,"dispatch_profile":"balanced"},"top_n":3}'
```

The endpoint returns the no-mitigation baseline, top beneficial recommendations, simulated before/after outcomes, score, candidate counts, runtime, and a cascade result that the frontend can replay.

Controlled shedding remains part of customer load not served. Mitigation metrics distinguish:

```text
original_demand_mw
served_load_mw
controlled_shed_mw
involuntary_unserved_mw
total_unserved_mw
load_lost_percent
```

The accounting invariant is `served + controlled shed + involuntary unserved = original demand`. For example, shedding 25 MW from an otherwise supplied 500 MW scenario reports 475 MW served, 25 MW total unserved, and 5% load lost. A reduction from 100% to 5% is reported as 95 percentage points.

Concise request/response examples are also available in `docs/api-examples.md`.

## Quick Demo

Backend:

```powershell
cd C:\Projects\Tripwire\Tripwire\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Frontend:

```powershell
cd C:\Projects\Tripwire\Tripwire\frontend
pnpm dev
```

Then open:

```text
http://localhost:3000
```

If port 3000 is busy, Next.js may choose another localhost port. The frontend expects the backend URL to be configured with `NEXT_PUBLIC_API_URL`.

If model artifacts are absent, regenerate the dataset and retrain:

```powershell
cd C:\Projects\Tripwire\Tripwire\backend
.\.venv\Scripts\python.exe scripts\generate_dataset.py --seed 42
.\.venv\Scripts\python.exe scripts\train_models.py
```

## Demo Presets

The frontend includes deterministic demo presets loaded from `GET /api/demo-presets`.

| Preset | Initial failure | Operating condition | Expected simulator result |
| --- | --- | --- | --- |
| Low Risk | `line-402` | Baseline | Depth 0, 0.0% load lost, 1 failed line |
| Severe Cascade | `line-101` | Critical demo profile | Depth 2, 100.0% load lost, 12 failed lines |
| Mitigation Example | `line-101` | Critical demo profile | Same severe baseline, with beneficial mitigation available |

Recommended presentation path:

1. Load healthy grid.
2. Select **Severe Cascade** or **Mitigation Example**.
3. Click **Predict Risk**.
4. Click **Run Cascade** and play the timeline.
5. Click **Find Mitigation**.
6. Compare prediction, actual result, and mitigated result in the demo summary.

## Demo Workflow

1. Start the backend.
2. Start the frontend.
3. Open the healthy grid.
4. Select a bus or transmission line.
5. Use `Predict Risk`.
6. Use `Simulate Failure`.
7. Use `Run Cascade`.
8. Step through the cascade timeline.
9. Use `Find Mitigation`.
10. Compare no-mitigation and recommended outcomes.
11. Use `Simulate Recommendation` to replay the selected mitigation.
12. Use `Return to Baseline`.

## Screenshots / Demo

Use `docs/screenshots.md` as the capture checklist before submission.

Submission support docs:

- `docs/demo-script.md`
- `docs/report-outline.md`
- `docs/screenshots.md`
- `docs/api-examples.md`
- `docs/architecture.md`

### Frontend

From `tripwire/frontend`:

```powershell
pnpm install
pnpm dev
```

The frontend runs at `http://localhost:3000` by default and expects the backend at `http://127.0.0.1:8000`.

To configure the backend URL, create `.env.local` from `frontend/.env.example`:

```text
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

## Development Commands

Backend:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend:

```powershell
pnpm lint
pnpm test
pnpm build
```

CI:

- GitHub Actions runs backend tests.
- GitHub Actions runs frontend tests, lint, and the production build after a frozen-lockfile install.
- GitHub Actions runs one Chromium component-selection smoke test after both jobs pass.

## Current Scope

Implemented:

- Repository architecture and documentation.
- FastAPI backend.
- `GET /health` endpoint returning `{"status":"ok"}`.
- `GET /api/grid` endpoint returning a solved pandapower network.
- `POST /api/failure` endpoint for stateless single component outage simulation.
- `POST /api/cascade` endpoint for deterministic cascading-failure simulation.
- `POST /api/reset` and `GET /api/reset` endpoints for returning the healthy baseline.
- Next.js frontend configured for backend communication.
- React Flow grid visualization.
- Generator, bus, load, and transmission-line display.
- Selection details panel.
- Basic failure and reset controls.
- Cascade timeline with clickable steps.
- Previous, play/pause, next, and speed controls.
- Current-step cascade metrics and final cascade summary.
- Current-step emphasis for newly failed components and overloaded lines.
- Offline scenario dataset generation.
- Dataset diagnostics script.
- CSV and metadata output used for baseline ML training.
- Baseline scikit-learn model training.
- Saved classifier/regressor pipelines and model metadata.
- `POST /api/predict` endpoint for synthetic-scenario cascade risk prediction.
- `POST /api/recommend` endpoint for simulation-validated mitigation ranking.
- `GET /api/demo-presets` endpoint for deterministic presentation presets.
- Frontend prediction panel for selected lines and buses.
- Frontend mitigation panel with before/after comparison and recommendation playback.
- Frontend demo scenario controls and compact demo result summary.
- Frontend status legend, help text, and methodology/limitations panel.
- Backend and frontend ignore files.
- GitHub Actions CI workflow.

Not implemented yet:

- Interactive grid editor.
- Real utility dataset ingestion.

## Limitations

- The network is a synthetic 8-bus teaching model.
- Operating conditions are simplified and generated for simulation coverage.
- Results are not validated against real utility data.
- Tripwire is not intended for operational grid control.
- ML metrics apply only to generated Tripwire simulation scenarios.
- Mitigation recommendations are simulation-derived and not guaranteed blackout prevention.
- The Render free service sleeps after inactivity, so its first request can take 50 seconds or more.
