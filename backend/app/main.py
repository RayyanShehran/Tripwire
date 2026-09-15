from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.ml.dataset import ScenarioCandidate, ScenarioConfig, create_operating_grid
from app.ml.inference import ModelNotTrainedError, PredictionInputError, predict_from_scenario
from app.simulation.cascade import DEFAULT_MAX_CASCADE_STEPS, simulate_cascade
from app.simulation.grid import (
    GridComponentNotFoundError,
    GridComponentType,
    GridConvergenceError,
)
from app.simulation.scenario import ComponentFailure, get_baseline_grid
from app.simulation.scenario import simulate_failure as simulate_single_failure

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

class FailureRequest(BaseModel):
    component_type: GridComponentType
    component_id: str = Field(..., min_length=1)


class OperatingCondition(BaseModel):
    load_multiplier: float = Field(default=1.0, gt=0)
    generation_multiplier: float = Field(default=1.0, gt=0)
    line_rating_multiplier: float = Field(default=1.0, gt=0)
    dispatch_profile: str = Field(default="balanced", min_length=1)


class CascadeRequest(FailureRequest):
    max_steps: int = Field(default=DEFAULT_MAX_CASCADE_STEPS, ge=0, le=100)
    operating_condition: OperatingCondition = Field(default_factory=OperatingCondition)


class PredictionRequest(FailureRequest):
    operating_condition: OperatingCondition = Field(default_factory=OperatingCondition)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/grid")
def get_grid() -> dict:
    try:
        return get_baseline_grid()
    except GridConvergenceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/failure")
def simulate_failure(request: FailureRequest) -> dict:
    try:
        return simulate_single_failure(
            ComponentFailure(request.component_type, request.component_id)
        )
    except GridComponentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except GridConvergenceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/reset")
def reset_scenario() -> dict:
    return reset_grid()


@app.get("/api/reset")
def reset_grid() -> dict:
    try:
        return get_baseline_grid()
    except GridConvergenceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/cascade")
def run_cascade(request: CascadeRequest) -> dict:
    condition = request.operating_condition
    config = ScenarioConfig(
        load_multiplier=condition.load_multiplier,
        generation_multiplier=condition.generation_multiplier,
        line_rating_multiplier=condition.line_rating_multiplier,
        dispatch_profile=condition.dispatch_profile,
        initial_failure=ScenarioCandidate(request.component_type, request.component_id),
        seed=42,
    )
    try:
        return simulate_cascade(
            component_type=request.component_type,
            component_id=request.component_id,
            max_steps=request.max_steps,
            net_factory=lambda: create_operating_grid(config),
        )
    except GridComponentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/predict")
def predict_risk(request: PredictionRequest) -> dict:
    condition = request.operating_condition
    try:
        return predict_from_scenario(
            component_type=request.component_type,
            component_id=request.component_id,
            load_multiplier=condition.load_multiplier,
            generation_multiplier=condition.generation_multiplier,
            line_rating_multiplier=condition.line_rating_multiplier,
            dispatch_profile=condition.dispatch_profile,
        )
    except GridComponentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ModelNotTrainedError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (PredictionInputError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
