from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.ml.artifacts import ModelNotTrainedError, validate_model_artifacts
from app.main import app
import app.main as main


def test_health_returns_ok() -> None:
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_checks_artifact_presence_without_loading_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checked: list[Path] = []

    def validate(path: Path):
        checked.append(path)
        return (path / "classifier", path / "regressor", path / "metadata")

    monkeypatch.setattr(main, "validate_model_artifacts", validate)

    client = TestClient(app)
    try:
        response = client.get("/ready")
    finally:
        client.close()

    assert response.status_code == 200
    assert response.json()["checks"]["models"] == "ok"
    assert checked == [main.settings.model_path]


def test_ready_reports_missing_model_artifacts(monkeypatch: pytest.MonkeyPatch) -> None:
    def missing(_: Path):
        raise ModelNotTrainedError("missing models")

    monkeypatch.setattr(main, "validate_model_artifacts", missing)

    client = TestClient(app)
    try:
        response = client.get("/ready")
    finally:
        client.close()

    assert response.status_code == 503
    assert response.json()["detail"]["checks"]["models"] == "missing"


def test_model_artifact_validation_rejects_missing_directory(tmp_path: Path) -> None:
    with pytest.raises(ModelNotTrainedError, match="Model artifacts are missing"):
        validate_model_artifacts(tmp_path)
