# Tripwire

Tripwire is a web-based power-grid cascading failure simulation and decision-support platform.

This repository currently contains the project scaffold only. The power-grid simulation, cascade analysis, machine-learning prediction, and mitigation recommendation features are intentionally not implemented yet.

## Project Structure

```text
tripwire/
  frontend/      Next.js, TypeScript, Tailwind CSS, React Flow, Recharts
  backend/       FastAPI service for grid simulation APIs
  docs/          Architecture and project documentation
```

## System Architecture

Tripwire is split into a browser frontend and a Python API backend.

- The frontend renders the interactive transmission-network interface and will eventually show substations, buses, generators, loads, lines, cascading failures, and charts.
- The backend exposes API endpoints for health checks and, later, power-flow simulation, cascade progression, graph analysis, machine-learning predictions, and mitigation recommendations.
- The frontend communicates with the backend through the `NEXT_PUBLIC_API_BASE_URL` environment variable.

Planned backend libraries:

- `pandapower` for electrical network modeling and power-flow analysis.
- `NetworkX` for graph topology analysis.
- `NumPy` and `pandas` for numerical and tabular data processing.
- `scikit-learn` for future vulnerability prediction models.

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
pytest
```

Frontend:

```powershell
pnpm lint
pnpm build
```

## Current Scope

Implemented:

- Repository architecture and documentation.
- Minimal FastAPI backend.
- `GET /health` endpoint returning `{"status":"ok"}`.
- Minimal Next.js frontend configured for backend communication.
- Backend and frontend ignore files.

Not implemented yet:

- Power-grid modeling.
- Cascading-failure simulation.
- Interactive grid editor.
- Failure injection workflow.
- Machine-learning prediction.
- Mitigation recommendation engine.
