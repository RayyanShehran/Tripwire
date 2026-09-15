from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    allowed_origins: list[str]
    allow_origin_regex: str | None
    model_dir: Path
    data_dir: Path
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
        model_dir=Path(os.getenv("MODEL_DIR", str(backend_root / "models"))),
        data_dir=Path(os.getenv("DATA_DIR", str(backend_root / "data"))),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
    )


def _csv_env(name: str, default: str) -> list[str]:
    raw_value = os.getenv(name, default)
    return [value.strip() for value in raw_value.split(",") if value.strip()]
