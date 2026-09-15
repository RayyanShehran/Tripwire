from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    allowed_origins: list[str]
    allow_origin_regex: str | None
    model_path: Path
    data_path: Path
    log_level: str


def get_settings() -> Settings:
    backend_root = Path(__file__).resolve().parents[1]
    allowed_origins = _csv_env(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    )
    return Settings(
        allowed_origins=allowed_origins,
        allow_origin_regex=os.getenv("ALLOW_ORIGIN_REGEX", r"http://(localhost|127\.0\.0\.1):30\d{2}"),
        model_path=Path(
            os.getenv("MODEL_PATH")
            or os.getenv("MODEL_DIR", str(backend_root / "models"))
        ),
        data_path=Path(
            os.getenv("DATA_PATH")
            or os.getenv("DATA_DIR", str(backend_root / "data"))
        ),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
    )


def validate_settings(settings: Settings) -> None:
    if "*" in settings.allowed_origins:
        raise ValueError("ALLOWED_ORIGINS cannot contain '*' when credentials are enabled")

    if not settings.allowed_origins and not settings.allow_origin_regex:
        raise ValueError("At least one frontend origin must be configured")

    if settings.log_level.upper() not in {
        "CRITICAL",
        "ERROR",
        "WARNING",
        "INFO",
        "DEBUG",
        "NOTSET",
    }:
        raise ValueError("LOG_LEVEL must be a valid Python logging level")


def _csv_env(name: str, default: str) -> list[str]:
    raw_value = os.getenv(name, default)
    return [value.strip() for value in raw_value.split(",") if value.strip()]
