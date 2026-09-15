import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.config import get_settings
from app.ml.dataset import ScenarioCandidate, ScenarioConfig, create_operating_grid
from app.ml.inference import (
    ModelNotTrainedError,
    PredictionInputError,
    load_model_bundle,
    predict_from_scenario,
)
from app.simulation.cascade import DEFAULT_MAX_CASCADE_STEPS, simulate_cascade
from app.simulation.grid import (
    GridComponentNotFoundError,
    GridComponentType,
    GridConvergenceError,
)
from app.simulation.mitigation import recommend_mitigations
from app.simulation.scenario import ComponentFailure, get_baseline_grid
from app.simulation.scenario import simulate_failure as simulate_single_failure

settings = get_settings()
logging.basicConfig(level=settings.log_level, format="%(levelname)s %(name)s %(message)s")
logger = logging.getLogger("tripwire.api")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    logger.info(
        "starting Tripwire API allowed_origins=%s model_dir=%s data_dir=%s",
        settings.allowed_origins,
        settings.model_dir,
        settings.data_dir,
    )
    yield


app = FastAPI(
    title="Tripwire API",
    description="Backend API for the Tripwire power-grid cascading failure platform.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex=settings.allow_origin_regex,
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


class RecommendationRequest(FailureRequest):
    operating_condition: OperatingCondition = Field(default_factory=OperatingCondition)
    max_candidates: int = Field(default=24, ge=1, le=30)
    top_n: int = Field(default=3, ge=1, le=5)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def ready() -> dict:
    checks: dict[str, str] = {}
    try:
        get_baseline_grid()
        checks["simulator"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["simulator"] = "failed"
        logger.exception("readiness simulator check failed")
        raise HTTPException(status_code=503, detail={"status": "failed", "checks": checks}) from exc

    try:
        load_model_bundle(settings.model_dir)
        checks["models"] = "ok"
    except ModelNotTrainedError as exc:
        checks["models"] = "missing"
        logger.warning("readiness model check failed: %s", exc)
        raise HTTPException(status_code=503, detail={"status": "failed", "checks": checks}) from exc

    return {"status": "ready", "checks": checks}


@app.get("/api/grid")
def get_grid() -> dict:
    logger.info("grid baseline requested")
    try:
        return get_baseline_grid()
    except GridConvergenceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/failure")
def simulate_failure(request: FailureRequest) -> dict:
    logger.info(
        "single failure requested component_type=%s component_id=%s",
        request.component_type,
        request.component_id,
    )
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
    logger.info(
        "cascade requested component_type=%s component_id=%s max_steps=%s condition=%s",
        request.component_type,
        request.component_id,
        request.max_steps,
        request.operating_condition.model_dump(),
    )
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
    logger.info(
        "prediction requested component_type=%s component_id=%s condition=%s",
        request.component_type,
        request.component_id,
        request.operating_condition.model_dump(),
    )
    condition = request.operating_condition
    try:
        return predict_from_scenario(
            component_type=request.component_type,
            component_id=request.component_id,
            load_multiplier=condition.load_multiplier,
            generation_multiplier=condition.generation_multiplier,
            line_rating_multiplier=condition.line_rating_multiplier,
            dispatch_profile=condition.dispatch_profile,
            model_dir=settings.model_dir,
        )
    except GridComponentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ModelNotTrainedError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (PredictionInputError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/recommend")
def recommend_actions(request: RecommendationRequest) -> dict:
    logger.info(
        "recommendation requested component_type=%s component_id=%s max_candidates=%s top_n=%s condition=%s",
        request.component_type,
        request.component_id,
        request.max_candidates,
        request.top_n,
        request.operating_condition.model_dump(),
    )
    try:
        return recommend_mitigations(
            component_type=request.component_type,
            component_id=request.component_id,
            operating_condition=request.operating_condition.model_dump(),
            max_candidates=request.max_candidates,
            top_n=request.top_n,
        )
    except GridComponentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
