from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.simulation.grid import (
    GridComponentNotFoundError,
    GridComponentType,
    GridConvergenceError,
    get_grid_response,
)
from app.simulation.scenario import ComponentFailure, GridScenario

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

scenario = GridScenario()


class FailureRequest(BaseModel):
    component_type: GridComponentType
    component_id: str = Field(..., min_length=1)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/grid")
async def get_grid(
    outage_type: Annotated[GridComponentType | None, Query()] = None,
    outage_id: Annotated[str | None, Query()] = None,
) -> dict:
    try:
        return get_grid_response(outage_type=outage_type, outage_id=outage_id)
    except GridComponentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except GridConvergenceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/failure")
async def simulate_failure(request: FailureRequest) -> dict:
    try:
        return scenario.apply_failure(
            ComponentFailure(
                component_type=request.component_type,
                component_id=request.component_id,
            )
        )
    except GridComponentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except GridConvergenceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/reset")
async def reset_scenario() -> dict:
    try:
        return scenario.reset()
    except GridConvergenceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
