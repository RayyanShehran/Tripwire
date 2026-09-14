# Tripwire Architecture

Tripwire is organized as a two-service local development system.

## Frontend

The frontend is a Next.js application written in TypeScript. It is responsible for:

- Rendering the power-grid interface with React Flow.
- Managing user interactions such as selecting nodes or transmission lines.
- Sending single-component failure requests to the backend.
- Sending deterministic cascade simulation requests to the backend.
- Returning the display to the healthy baseline.
- Displaying solved operating metrics returned by the backend.
- Displaying cascade timeline playback from the stored backend response.
- Displaying current-step cascade metrics and final summary metrics.
- Displaying future decision-support metrics.
- Calling the FastAPI backend through a configurable API base URL.

Core frontend packages:

- React Flow for network visualization.
- Recharts for metrics and scenario charts.
- Tailwind CSS for styling.

## Backend

The backend is a FastAPI application. It is responsible for:

- Serving API health/status endpoints.
- Building a small pandapower transmission network.
- Running a normal power-flow calculation.
- Returning the healthy solved baseline grid state.
- Applying single-component outages from a fresh baseline.
- Running deterministic cascading-failure simulations from an initial outage.
- Returning the healthy baseline through reset endpoints.
- Returning step-by-step cascade state and severity metrics.
- Generating offline CSV scenario datasets for future ML training.

Core backend packages:

- pandapower for electrical grid modeling.
- NetworkX for graph operations.
- NumPy and pandas for computation.
- scikit-learn for future ML workflows.

## Simulation Layer

Grid logic lives under `backend/app/simulation/` instead of inside API route handlers.

- `grid.py` creates the sample grid, runs pandapower, applies component outages, detects supplied buses, assigns component status, and serializes API-safe JSON.
- `cascade.py` runs deterministic cascading-failure simulations from one initial component failure.
- `scenario.py` builds stateless single-failure scenarios from a fresh baseline and wraps solved or blackout results with scenario metadata.
- `app/ml/dataset.py` generates machine-learning-ready scenario rows from configurable pre-failure operating profiles and post-cascade targets.
- `scripts/analyze_dataset.py` reports data-quality diagnostics for a generated CSV without training a model.

The current grid is a single-voltage 230 kV teaching network. This avoids invalid direct line connections across voltage levels while keeping the topology easy to inspect.

Current baseline:

- 8 buses.
- 3 generators, including one slack source.
- 4 loads.
- 12 transmission lines.
- 400 MW total demand.
- All baseline components healthy.
- Baseline maximum line loading below 80%.

Status rules:

- Healthy: loading below 80%.
- Stressed: loading from 80% to 100%, or bus voltage outside the normal range.
- Overloaded: loading above 100%.
- Failed: out of service, disconnected, unsupplied, or missing a valid solved value.

## Cascade Engine

The cascade engine is deterministic, bounded, and stateless per request. It does not use randomness, machine learning, or mitigation recommendations.

Current flow:

1. Start from the healthy baseline grid.
2. Apply the requested initial component failure.
3. Run pandapower.
4. Record the solved grid state.
5. Find in-service transmission lines above the cascade trip threshold.
6. Trip those overloaded lines.
7. Re-run pandapower.
8. Repeat until the cascade terminates.

Current centralized cascade settings:

```text
CASCADE_TRIP_THRESHOLD_PERCENT = 100.0
DEFAULT_MAX_CASCADE_STEPS = 20
```

Termination reasons:

```text
stable
max_steps_reached
power_flow_failed
total_blackout
no_additional_failures
```

Every returned cascade step contains:

```text
step
event
newly_failed_components
overloaded_lines
grid
metrics
```

The frontend stores the complete cascade response and changes displayed React Flow data by selecting a saved step. Timeline navigation and playback do not request a new backend simulation.

Current playback behavior:

- Timeline item click jumps to that saved grid state.
- Previous and Next move one step at a time.
- Play/Pause advances through saved steps at 0.5x, 1x, or 2x speed.
- Playback stops automatically on the final step.
- Return to Baseline clears frontend cascade state and reloads the healthy grid.
- Newly failed components and currently overloaded lines are visually emphasized for the active step.

## API Boundary

The frontend reads `NEXT_PUBLIC_API_BASE_URL` and uses it for API requests. During local development, this should point to:

```text
http://127.0.0.1:8000
```

Current endpoints:

```text
GET /health
GET /api/grid
POST /api/failure
POST /api/cascade
POST /api/reset
GET /api/reset
```

Endpoint lifecycle rules:

```text
GET /api/grid      -> healthy solved baseline
POST /api/failure  -> fresh baseline + one requested outage
POST /api/cascade  -> fresh baseline + one initial outage + automatic secondary trips
POST /api/reset    -> healthy solved baseline
GET /api/reset     -> healthy solved baseline
```

No endpoint inherits outages from a previous request. This keeps repeated tests deterministic and avoids hidden process-level scenario state.

`GET /api/grid` returns:

```text
nodes
lines
metrics
```

The metrics distinguish demand from served load:

```text
total_demand_mw
served_load_mw
unserved_load_mw
total_generation_mw
max_line_loading_percent
load_lost_percent
failed_components
failed_lines
```

`POST /api/failure` accepts one component failure at a time:

```json
{
  "component_type": "line",
  "component_id": "line-101"
}
```

It returns:

```text
status
termination_reason
initial_failure
grid
metrics
```

Failure termination reasons:

```text
solved
no_slack_source
total_blackout
```

A source/slack bus outage is represented as a valid HTTP 200 blackout scenario. The response keeps finite numeric metrics, including zero served load, full unserved demand, and 100% load lost.

`POST /api/cascade` accepts the same component fields plus an optional `max_steps` value:

```json
{
  "component_type": "line",
  "component_id": "line-101",
  "max_steps": 20
}
```

The cascade endpoint returns the initial failure, termination reason, cascade depth, all preserved steps, and final metrics such as load lost percentage, failed component count, failed line count, and peak line loading.

## Dataset Pipeline

Dataset generation is an offline backend workflow. It is intentionally not exposed as a public API endpoint.

Flow:

```text
healthy grid model
-> independent operating-condition profiles
-> initial failure candidates
-> pre-failure feature extraction
-> deterministic cascade simulation
-> target/label extraction
-> CSV + metadata
```

Default output:

```text
backend/data/generated/tripwire_scenarios.csv
backend/data/generated/dataset_metadata.json
```

Feature columns are limited to values known before the initial failure:

```text
scenario metadata
load multiplier
generation availability multiplier
generator dispatch profile
line rating multiplier
pre-failure demand and generation
available generation capacity
reserve margin
pre-failure line loading statistics
network component counts
failed component pre-failure loading/capacity
endpoint load/generation context
endpoint voltage and degree
NetworkX centrality/path features
```

Operating profiles are configured per scenario and do not mutate global grid state. The current defaults intentionally include stressed dataset-only cases:

```text
load_multipliers = 1.0, 1.15, 1.25, 1.35, 1.5
generation_multipliers = 0.8, 0.9, 1.0, 1.1
line_rating_multipliers = 0.6, 0.5, 0.45, 0.4, 0.38, 0.35, 0.32
dispatch_profiles = balanced, south_heavy, harbor_heavy, south_reduced
```

The application baseline returned by `GET /api/grid` remains healthy. Dataset line-rating stress is applied only inside generated scenario networks so positive cascade labels arise from actual simulated overloads and secondary trips.

Reserve margin is a pre-failure feature:

```text
reserve_margin_mw = available_generation_capacity_mw - total_demand_mw
reserve_margin_percent = reserve_margin_mw / total_demand_mw * 100
```

It is not calculated from solved post-failure generation.

Target columns are post-cascade labels and outcomes:

```text
cascade_happened
cascade_depth
total_failed_lines
total_failed_components
overloaded_events
served_load_mw
unserved_load_mw
load_lost_percent
peak_line_loading_percent
termination_reason
severity_label
```

The `cascade_happened` target is true only when at least one secondary failure occurs after the initial failure. It is false for scenarios where only the initial component fails.

Severity labels are deterministic:

```text
LOW: 0 <= load lost < 5%
MODERATE: 5 <= load lost < 20%
HIGH: 20 <= load lost < 50%
CRITICAL: load lost >= 50%
```

The generator validates that scenario IDs are unique, required fields are present, numeric values are finite, impossible negative values are absent, load lost is between 0 and 100%, cascade depth is non-negative, served plus unserved load balances to demand, and severity labels are known.

Dataset metadata includes schema version, git commit when available, grid version, cascade threshold, configured multipliers, dispatch profiles, seed, scenario count, positive rate, feature columns, target columns, failed/excluded scenario count, and generation timestamp.

Diagnostics can be run with:

```powershell
.\.venv\Scripts\python.exe scripts\analyze_dataset.py
```

The diagnostics script prints dataset size, positive cascade rate, severity distribution, feature ranges, potential constant columns, highly imbalanced categorical values, missing/non-finite value counts, and duplicate count. It intentionally does not train a model.
