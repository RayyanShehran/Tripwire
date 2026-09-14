# Tripwire Architecture

Tripwire is organized as a two-service local development system.

## Frontend

The frontend is a Next.js application written in TypeScript. It is responsible for:

- Rendering the power-grid interface with React Flow.
- Managing user interactions such as selecting nodes or transmission lines.
- Sending single-component failure requests to the backend.
- Sending deterministic cascade simulation requests to the backend.
- Resetting the current scenario.
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
- Returning the current solved grid state.
- Applying single-component outages to the current scenario.
- Running deterministic cascading-failure simulations from an initial outage.
- Resetting the current scenario to the healthy baseline.
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
- `scenario.py` stores the current local scenario in memory and applies/reset failures against a fresh grid solve.
- `app/ml/dataset.py` generates machine-learning-ready scenario rows from pre-failure features and post-cascade targets.

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

The cascade engine is deterministic and bounded. It does not use randomness, machine learning, or mitigation recommendations.

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
- Return to Baseline clears cascade state and reloads the healthy grid.
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
```

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
```

`POST /api/failure` accepts one component failure at a time:

```json
{
  "component_type": "line",
  "component_id": "line-101"
}
```

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
-> operating-condition perturbations
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
pre-failure demand and generation
reserve margin
pre-failure line loading statistics
network component counts
failed component pre-failure loading/capacity
endpoint voltage and degree
NetworkX centrality/path features
```

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

The generator validates that scenario IDs are unique, required fields are present, numeric values are finite, and severity labels are known.
