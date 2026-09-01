from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.simulation.grid import GridConvergenceError, get_grid_response

app = FastAPI(
    title="Tripwire API",
    description="Backend API for the Tripwire power-grid cascading failure platform.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):30\d{2}",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/grid")
async def get_grid() -> dict:
    try:
        return get_grid_response()
    except GridConvergenceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
