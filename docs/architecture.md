# Tripwire Architecture

Tripwire is organized as a two-service local development system.

## Frontend

The frontend is a Next.js application written in TypeScript. It is responsible for:

- Rendering the power-grid interface with React Flow.
- Managing user interactions such as selecting nodes or transmission lines.
- Sending single-component failure requests to the backend.
- Resetting the current scenario.
- Displaying solved operating metrics returned by the backend.
- Displaying future cascade states and decision-support metrics.
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
- Resetting the current scenario to the healthy baseline.
- Running future cascading-failure simulation logic.
- Returning future step-by-step cascade state and severity metrics.

Core backend packages:

- pandapower for electrical grid modeling.
- NetworkX for graph operations.
- NumPy and pandas for computation.
- scikit-learn for future ML workflows.

## Simulation Layer

Grid logic lives under `backend/app/simulation/` instead of inside API route handlers.

- `grid.py` creates the sample grid, runs pandapower, applies component outages, detects supplied buses, assigns component status, and serializes API-safe JSON.
- `scenario.py` stores the current local scenario in memory and applies/reset failures against a fresh grid solve.

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

This is not a cascading-failure simulation yet. It is a single-component outage workflow that prepares the backend and frontend for the later cascade engine.
