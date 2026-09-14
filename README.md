# Tripwire

Tripwire is a web-based power-grid cascading failure simulation and decision-support platform.

This repository currently contains the first working local version of Tripwire. It includes a FastAPI backend that builds and solves a small pandapower transmission network, a deterministic cascading-failure engine, and a Next.js frontend that renders the network with React Flow.

Machine-learning prediction and mitigation recommendation features are intentionally not implemented yet.

## Project Structure

```text
tripwire/
  frontend/      Next.js, TypeScript, Tailwind CSS, React Flow, Recharts
  backend/       FastAPI service for grid simulation APIs
  docs/          Architecture and project documentation
```

## System Architecture

Tripwire is split into a browser frontend and a Python API backend.

- The frontend renders the interactive transmission-network interface with generators, buses, loads, transmission lines, solved metrics, selection details, single-component failure controls, and cascade timeline playback.
- The backend exposes API endpoints for health checks, the solved grid state, one-off component failure simulation, deterministic cascade simulation, and scenario reset.
- The frontend communicates with the backend through the `NEXT_PUBLIC_API_BASE_URL` environment variable.

Current backend libraries:

- `pandapower` for electrical network modeling and power-flow analysis.
- `NetworkX` for future graph topology analysis.
- `NumPy` and `pandas` for numerical and tabular data processing.
- `scikit-learn` for future vulnerability prediction models.

## Dataset Pipeline

Tripwire includes an offline dataset generator for future ML work. It is not exposed through the web API.

Pipeline:

```text
pandapower simulation -> deterministic scenario generator -> cascade outcomes -> CSV dataset -> future ML training
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
  --load-multipliers 0.8,0.9,1.0,1.1,1.2 `
  --component-types line,bus `
  --max-scenarios 5000
```

Feature columns are pre-failure inputs only, including operating condition, grid loading, reserve margin, component loading/capacity, endpoint voltages, and topology features. Target columns are post-cascade outcomes, including cascade depth, failed components, unserved load, load lost percentage, termination reason, and severity label.

`cascade_happened` is defined as true only when at least one secondary failure occurs after the initial failure.

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
GET /api/grid
POST /api/failure
POST /api/cascade
POST /api/reset
```

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

Health check:

```powershell
curl http://127.0.0.1:8000/health
```

Expected response:

```json
{"status":"ok"}
```

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

Reset the scenario:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/reset -Method Post
```

Run a deterministic cascade from an initial failure:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/cascade `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"component_type":"line","component_id":"line-101","max_steps":20}'
```

The cascade engine stores every simulated step in the response. The frontend keeps that response in memory and lets the user step through it without requesting a new backend simulation.

### Frontend

From `tripwire/frontend`:

```powershell
pnpm install
pnpm dev
```

The frontend runs at `http://localhost:3000` by default and expects the backend at `http://127.0.0.1:8000`.

To override the backend URL, edit `.env.local`:

```text
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

## Development Commands

Backend:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend:

```powershell
pnpm lint
pnpm build
```

## Current Scope

Implemented:

- Repository architecture and documentation.
- FastAPI backend.
- `GET /health` endpoint returning `{"status":"ok"}`.
- `GET /api/grid` endpoint returning a solved pandapower network.
- `POST /api/failure` endpoint for single component outage simulation.
- `POST /api/cascade` endpoint for deterministic cascading-failure simulation.
- `POST /api/reset` endpoint for restoring the baseline scenario.
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
- CSV and metadata output for future ML training.
- Backend and frontend ignore files.

Not implemented yet:

- Interactive grid editor.
- Machine-learning prediction.
- Machine-learning model training.
- Mitigation recommendation engine.
