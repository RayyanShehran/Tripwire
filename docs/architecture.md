# Tripwire Architecture

Tripwire is organized as a two-service local development system.

## Frontend

The frontend is a Next.js application written in TypeScript. It is responsible for:

- Rendering the power-grid interface.
- Managing user interactions such as selecting nodes or transmission lines.
- Displaying future cascade states and decision-support metrics.
- Calling the FastAPI backend through a configurable API base URL.

Core planned frontend packages:

- React Flow for network visualization.
- Recharts for metrics and scenario charts.
- Tailwind CSS for styling.

## Backend

The backend is a FastAPI application. It is responsible for:

- Serving API health/status endpoints.
- Accepting future failure-trigger requests.
- Running future cascading-failure simulation logic.
- Returning future step-by-step cascade state and severity metrics.

Core planned backend packages:

- pandapower for electrical grid modeling.
- NetworkX for graph operations.
- NumPy and pandas for computation.
- scikit-learn for future ML workflows.

## API Boundary

The frontend reads `NEXT_PUBLIC_API_BASE_URL` and uses it for API requests. During local development, this should point to:

```text
http://127.0.0.1:8000
```

Current endpoint:

```text
GET /health
```
