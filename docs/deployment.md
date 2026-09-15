# Tripwire Deployment Guide

Tripwire is prepared for a hosted frontend on Vercel and a hosted FastAPI backend on Render or Railway. This guide does not deploy automatically.

## Frontend: Vercel

Deploy the `frontend/` directory as the Vercel project root.

Required environment variable:

```text
NEXT_PUBLIC_API_URL=https://your-tripwire-api.example.com
```

Use the deployed backend URL without a trailing slash. The frontend reads this value at build time. If it is missing, the app displays a clear API configuration error instead of silently using localhost.

Build command:

```text
pnpm build
```

Install command:

```text
pnpm install --frozen-lockfile
```

Output is handled by Next.js/Vercel automatically.

## Backend: Render

This repository includes `render.yaml` for a simple Render web service.

Backend root directory:

```text
backend
```

Build command:

```text
pip install -r requirements.txt
```

Start command:

```text
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Required environment variables:

```text
ALLOWED_ORIGINS=https://your-vercel-frontend.example.com
ALLOW_ORIGIN_REGEX=
MODEL_PATH=/opt/render/project/src/backend/models
DATA_PATH=/opt/render/project/src/backend/data
LOG_LEVEL=INFO
```

Do not set `ALLOWED_ORIGINS=*` because the API enables credentials for CORS.

## Backend: Railway

Railway can run the backend using the repository `Procfile`:

```text
web: uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port $PORT
```

Set the same environment variables used for Render. If Railway builds from the repository root, make sure it installs dependencies from `backend/requirements.txt`.

## Model Artifacts

The prediction endpoint requires these committed runtime files:

```text
backend/models/cascade_classifier.joblib
backend/models/load_loss_regressor.joblib
backend/models/model_metadata.json
```

They are committed because the deployed API must serve predictions without retraining on startup. Startup validation loads the model bundle once and fails clearly if artifacts are missing.

To recreate artifacts locally:

```powershell
cd C:\Projects\Tripwire\Tripwire\backend
.\.venv\Scripts\python.exe scripts\generate_dataset.py --seed 42
.\.venv\Scripts\python.exe scripts\train_models.py
```

Do not silently retrain models during deployment startup.

## Dataset Files

Training datasets under `backend/data/generated/` are ignored by Git except `.gitkeep`. Runtime deployment does not need large generated CSV files. The simulator, demo presets, and ML inference use code plus committed model artifacts.

## Readiness

Use:

```text
GET /ready
```

The readiness endpoint verifies:

- simulator initialization
- model artifact loading
- application readiness

Expected response:

```json
{
  "status": "ready",
  "checks": {
    "simulator": "ok",
    "models": "ok"
  }
}
```

## CORS Setup

For local development:

```text
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
ALLOW_ORIGIN_REGEX=http://(localhost|127\.0\.0\.1):30\d{2}
```

For production:

```text
ALLOWED_ORIGINS=https://your-vercel-frontend.example.com
ALLOW_ORIGIN_REGEX=
```

After the frontend is deployed, update the backend CORS variable with the exact Vercel URL.

## Common Deployment Failures

- Frontend says API URL is not configured: set `NEXT_PUBLIC_API_URL` in Vercel and redeploy.
- Browser blocks API calls: add the deployed frontend URL to `ALLOWED_ORIGINS` on the backend.
- `/ready` returns model failure: verify all files under `backend/models/` are deployed and `MODEL_PATH` points to that folder.
- Backend starts locally but not hosted: confirm the platform supplies `$PORT` and the start command uses it.
- Recommendations feel slow: mitigation evaluates multiple simulator candidates; this is expected to be slower than grid, prediction, or cascade requests.

## Pre-Deployment Checks

Backend:

```powershell
cd C:\Projects\Tripwire\Tripwire\backend
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend:

```powershell
cd C:\Projects\Tripwire\Tripwire\frontend
pnpm lint
pnpm build
```
