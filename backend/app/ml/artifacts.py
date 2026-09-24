from __future__ import annotations

from pathlib import Path


MODEL_DIR = Path(__file__).resolve().parents[2] / "models"
CLASSIFIER_ARTIFACT = "cascade_classifier.joblib"
REGRESSOR_ARTIFACT = "load_loss_regressor.joblib"
METADATA_ARTIFACT = "model_metadata.json"


class ModelNotTrainedError(RuntimeError):
    pass


def model_artifact_paths(model_dir: str | Path = MODEL_DIR) -> tuple[Path, Path, Path]:
    root = Path(model_dir)
    return (
        root / CLASSIFIER_ARTIFACT,
        root / REGRESSOR_ARTIFACT,
        root / METADATA_ARTIFACT,
    )


def validate_model_artifacts(model_dir: str | Path = MODEL_DIR) -> tuple[Path, Path, Path]:
    paths = model_artifact_paths(model_dir)
    missing = [str(path) for path in paths if not path.is_file()]
    if missing:
        raise ModelNotTrainedError(
            "Model artifacts are missing. Run backend/scripts/train_models.py first. "
            f"Missing: {missing}"
        )
    return paths
