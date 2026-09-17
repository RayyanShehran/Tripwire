import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse
from time import perf_counter
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.config import get_settings, validate_settings
from app.ml.inference import (
    ModelNotTrainedError,
    PredictionInputError,
    load_model_bundle,
    predict_from_config,
)
from app.simulation.config import ScenarioConfig, scenario_config, build_scenario_network
from app.simulation.cascade import DEFAULT_MAX_CASCADE_STEPS, simulate_cascade
from app.simulation.grid import (
    GridComponentNotFoundError,
    GridComponentType,
    GridConvergenceError,
    run_power_flow,
    serialize_grid_state,
)
from app.simulation.mitigation import recommend_mitigations
from app.simulation.demo import list_demo_presets
from app.simulation.scenario import ComponentFailure, get_baseline_grid
from app.simulation.scenario import simulate_failure as simulate_single_failure

settings = get_settings()
validate_settings(settings)
logging.basicConfig(level=settings.log_level.upper(), format="%(levelname)s %(name)s %(message)s")
logger = logging.getLogger("tripwire.api")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    logger.info(
        "starting Tripwire API allowed_origins=%s model_dir=%s data_dir=%s",
        settings.allowed_origins,
        settings.model_path,
        settings.data_path,
    )
    get_baseline_grid()
    load_model_bundle(settings.model_path)
    logger.info("Tripwire API startup validation complete")
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
    load_multiplier: float = Field(default=1.0, gt=0, allow_inf_nan=False)
    generation_multiplier: float = Field(default=1.0, gt=0, allow_inf_nan=False)
    line_rating_multiplier: float = Field(default=1.0, gt=0, allow_inf_nan=False)
    dispatch_profile: Literal["balanced", "south_heavy", "harbor_heavy", "south_reduced"] = "balanced"


class ScenarioRequest(FailureRequest):
    operating_condition: OperatingCondition = Field(default_factory=OperatingCondition)
    preset_id: str | None = None


class CascadeRequest(ScenarioRequest):
    max_steps: int = Field(default=DEFAULT_MAX_CASCADE_STEPS, ge=0, le=100)


class PredictionRequest(ScenarioRequest):
    pass


class RecommendationRequest(ScenarioRequest):
    max_candidates: int = Field(default=24, ge=1, le=30)
    top_n: int = Field(default=3, ge=1, le=5)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.exception_handler(Exception)
async def unexpected_exception_handler(_, exc: Exception) -> JSONResponse:
    logger.exception("unexpected API error")
    return JSONResponse(
        status_code=500,
        content={"detail": "Unexpected server error. Check backend logs."},
    )


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
        load_model_bundle(settings.model_path)
        checks["models"] = "ok"
    except ModelNotTrainedError as exc:
        checks["models"] = "missing"
        logger.warning("readiness model check failed: %s", exc)
        raise HTTPException(status_code=503, detail={"status": "failed", "checks": checks}) from exc

    return {"status": "ready", "checks": checks}


@app.get("/api/grid")
def get_grid(condition: OperatingCondition = Depends()) -> dict:
    logger.info("grid baseline requested")
    start = perf_counter()
    try:
        net = build_scenario_network(scenario_config("line", "line-101", condition.model_dump()))
        run_power_flow(net)
        return serialize_grid_state(net)
    except GridConvergenceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        logger.info("grid baseline completed elapsed_ms=%.2f", _elapsed_ms(start))


@app.get("/api/demo-presets")
def get_demo_presets() -> dict:
    logger.info("demo presets requested")
    return {"presets": list_demo_presets()}


@app.post("/api/failure")
def simulate_failure(request: ScenarioRequest) -> dict:
    logger.info(
        "single failure requested component_type=%s component_id=%s",
        request.component_type,
        request.component_id,
    )
    start = perf_counter()
    try:
        return simulate_single_failure(
            ComponentFailure(request.component_type, request.component_id),
            config=_scenario_config_from_request(request),
        )
    except GridComponentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except GridConvergenceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        logger.info("single failure completed elapsed_ms=%.2f", _elapsed_ms(start))


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
    start = perf_counter()
    config = _scenario_config_from_request(request)
    try:
        return simulate_cascade(
            component_type=request.component_type,
            component_id=request.component_id,
            max_steps=request.max_steps,
            config=config,
        )
    except GridComponentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        logger.info("cascade completed elapsed_ms=%.2f", _elapsed_ms(start))


@app.post("/api/predict")
def predict_risk(request: PredictionRequest) -> dict:
    logger.info(
        "prediction requested component_type=%s component_id=%s condition=%s",
        request.component_type,
        request.component_id,
        request.operating_condition.model_dump(),
    )
    start = perf_counter()
    config = _scenario_config_from_request(request)
    try:
        return predict_from_config(
            config,
            model_dir=settings.model_path,
        )
    except GridComponentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ModelNotTrainedError, GridConvergenceError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (PredictionInputError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        logger.info("prediction completed elapsed_ms=%.2f", _elapsed_ms(start))


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
    start = perf_counter()
    config = _scenario_config_from_request(request)
    try:
        return recommend_mitigations(
            component_type=request.component_type,
            component_id=request.component_id,
            config=config,
            max_candidates=request.max_candidates,
            top_n=request.top_n,
        )
    except GridComponentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except GridConvergenceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        logger.info("recommendation completed elapsed_ms=%.2f", _elapsed_ms(start))


def _elapsed_ms(start: float) -> float:
    return (perf_counter() - start) * 1000


def _scenario_config_from_request(request: ScenarioRequest) -> ScenarioConfig:
    return scenario_config(
        request.component_type,
        request.component_id,
        request.operating_condition.model_dump(),
        preset_id=request.preset_id,
    )
