# Tripwire Deployment Guide

Tripwire is deployed with a Vercel frontend and a Render FastAPI backend:

- Frontend: https://tripwire-eta.vercel.app
- API: https://tripwire-api-4ecd.onrender.com

The Render service uses the free plan and can take 50 seconds or more to wake after inactivity.

## Verified Production State

Production was verified on September 19, 2026 using application commit
`4b43cf822724621af223da8f7e4817e6a04eb5f6`.

- Render deploy: `dep-dan7uvbm8hqs73acgqrg`
- Deploy result: succeeded and live
- Deploy duration: 1 minute 40 seconds
- Python: 3.12.11
- Git branch: `main`
- Render root directory: `backend`
- Auto-deploy: On Commit

The production OpenAPI schema includes all expected routes:

```text
/health
/ready
/api/grid
/api/grid/definition
/api/grid/validate
/api/grid/solve
/api/failure
/api/cascade
/api/predict
/api/recommend
/api/reset
```

The live Grid Builder was verified through Vercel against the Render API. The
check covered component creation, validation, custom solve, layout movement,
browser-local save/reload, single failure, cascade, mitigation, and the truthful
ML incompatibility response for modified topology.

## Frontend: Vercel

Deploy the `frontend/` directory as the Vercel project root.

Required environment variable:

```text
NEXT_PUBLIC_API_URL=https://tripwire-api-4ecd.onrender.com
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
ALLOWED_ORIGINS=https://tripwire-eta.vercel.app
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

They are committed because the deployed API must serve predictions without
retraining. Startup validation checks that all three artifacts exist without
importing scikit-learn or deserializing the pipelines. The first prediction loads
the bundle once; later predictions reuse the in-process cache.

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
- required model artifact presence
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
ALLOWED_ORIGINS=https://tripwire-eta.vercel.app
ALLOW_ORIGIN_REGEX=
```

After the frontend is deployed, update the backend CORS variable with the exact Vercel URL.

## Common Deployment Failures

- Frontend says API URL is not configured: set `NEXT_PUBLIC_API_URL` in Vercel and redeploy.
- Browser blocks API calls: add the deployed frontend URL to `ALLOWED_ORIGINS` on the backend.
- `/ready` returns model failure: verify all files under `backend/models/` are deployed and `MODEL_PATH` points to that folder.
- Backend starts locally but not hosted: confirm the platform supplies `$PORT` and the start command uses it.
- Recommendations feel slow: mitigation evaluates six deterministic simulator candidates by default and is expected to be slower than grid, prediction, or cascade requests.
- The first request takes up to a minute: the Render free instance is waking from inactivity.

## Cold Start Behavior

Render's free service sleep is the main source of presentation-time cold starts
and can add 50 seconds or more before the application is reachable. This is
separate from Tripwire's own startup work.

The verified deployment logs showed these application startup phases:

```text
Container allocation before command: about 19 seconds
Python imports before Uvicorn process start: about 30 seconds
Tripwire startup validation: about 2 seconds
Render health routing before live status: about 10 seconds
```

The backend now defers its ML inference imports and model deserialization until
the first prediction. A three-run local cold-process benchmark reduced API-ready
time from roughly 15 seconds to 6-9 seconds. Artifact presence checks took about
2 ms; the first prediction paid a one-time 2.1-2.4 second model initialization
cost. Render container allocation and free-tier wake-up still dominate the public
cold start. Removing free-tier sleep requires a continuously running paid instance.

During the 75-second warm-up window, the frontend displays **Starting simulation
backend...** and provides **Retry connection**. It reports the backend as
unavailable only after that warm-up window expires.

## Pre-Deployment Checks

Backend:

```powershell
cd C:\Projects\Tripwire\Tripwire\backend
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend:

```powershell
cd C:\Projects\Tripwire\Tripwire\frontend
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```
