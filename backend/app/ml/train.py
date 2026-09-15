from __future__ import annotations

import json
import math
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from app.ml.dataset import default_output_path, validate_dataset
from app.ml.features import (
    CATEGORICAL_FEATURES,
    MODEL_FEATURE_COLUMNS,
    NUMERIC_FEATURES,
    feature_frame,
)
from app.ml.schemas import (
    CLASSIFICATION_TARGET,
    MODEL_VERSION,
    RANDOM_SEED,
    REGRESSION_TARGET,
)

MODEL_DIR = Path(__file__).resolve().parents[2] / "models"
CLASSIFIER_ARTIFACT = "cascade_classifier.joblib"
REGRESSOR_ARTIFACT = "load_loss_regressor.joblib"
METADATA_ARTIFACT = "model_metadata.json"


@dataclass(frozen=True)
class SplitData:
    x_train: pd.DataFrame
    x_test: pd.DataFrame
    y_class_train: pd.Series
    y_class_test: pd.Series
    y_reg_train: pd.Series
    y_reg_test: pd.Series
    strategy: str


@dataclass(frozen=True)
class TrainingResult:
    classifier: Pipeline
    regressor: Pipeline
    metadata: dict[str, Any]


def train_models(
    dataset_path: Path | None = None,
    dataframe: pd.DataFrame | None = None,
    output_dir: Path = MODEL_DIR,
    random_seed: int = RANDOM_SEED,
    save_artifacts: bool = True,
) -> TrainingResult:
    dataset_path = dataset_path or default_output_path()
    if dataframe is None:
        dataframe = pd.read_csv(dataset_path)
    else:
        dataframe = dataframe.copy()
    validate_dataset(dataframe)

    split = split_dataset(dataframe, random_seed=random_seed)
    classifier_results = _train_classifiers(split, random_seed)
    regressor_results = _train_regressors(split, random_seed)

    champion_classifier_name, champion_classifier, classifier_metrics = _select_classifier(
        classifier_results
    )
    champion_regressor_name, champion_regressor, regressor_metrics = _select_regressor(
        regressor_results
    )

    metadata = _metadata(
        dataframe=dataframe,
        dataset_path=dataset_path,
        split_strategy=split.strategy,
        classifier_name=champion_classifier_name,
        regressor_name=champion_regressor_name,
        classifier_metrics=classifier_metrics,
        regressor_metrics=regressor_metrics,
        classifier_results=classifier_results,
        regressor_results=regressor_results,
        random_seed=random_seed,
        classifier=champion_classifier,
        regressor=champion_regressor,
    )

    if save_artifacts:
        save_model_artifacts(
            champion_classifier,
            champion_regressor,
            metadata,
            output_dir=output_dir,
        )

    return TrainingResult(
        classifier=champion_classifier,
        regressor=champion_regressor,
        metadata=metadata,
    )


def split_dataset(dataframe: pd.DataFrame, random_seed: int = RANDOM_SEED) -> SplitData:
    features = feature_frame(dataframe)
    y_class = dataframe[CLASSIFICATION_TARGET].astype(bool)
    y_reg = dataframe[REGRESSION_TARGET].astype(float)
    groups = dataframe["component_id"].astype(str)

    if groups.nunique() >= 4:
        splitter = GroupShuffleSplit(n_splits=20, test_size=0.25, random_state=random_seed)
        for train_index, test_index in splitter.split(features, y_class, groups):
            train_classes = y_class.iloc[train_index].nunique()
            test_classes = y_class.iloc[test_index].nunique()
            if train_classes > 1 and test_classes > 1:
                return SplitData(
                    x_train=features.iloc[train_index],
                    x_test=features.iloc[test_index],
                    y_class_train=y_class.iloc[train_index],
                    y_class_test=y_class.iloc[test_index],
                    y_reg_train=y_reg.iloc[train_index],
                    y_reg_test=y_reg.iloc[test_index],
                    strategy="group_shuffle_split_by_initial_component",
                )

    stratify = y_class if y_class.nunique() > 1 else None
    x_train, x_test, y_class_train, y_class_test, y_reg_train, y_reg_test = train_test_split(
        features,
        y_class,
        y_reg,
        test_size=0.25,
        random_state=random_seed,
        stratify=stratify,
    )
    return SplitData(
        x_train=x_train,
        x_test=x_test,
        y_class_train=y_class_train,
        y_class_test=y_class_test,
        y_reg_train=y_reg_train,
        y_reg_test=y_reg_test,
        strategy="stratified_random_split",
    )


def save_model_artifacts(
    classifier: Pipeline,
    regressor: Pipeline,
    metadata: dict[str, Any],
    output_dir: Path = MODEL_DIR,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(classifier, output_dir / CLASSIFIER_ARTIFACT)
    joblib.dump(regressor, output_dir / REGRESSOR_ARTIFACT)
    (output_dir / METADATA_ARTIFACT).write_text(
        json.dumps(metadata, allow_nan=False, indent=2),
        encoding="utf-8",
    )


def _train_classifiers(split: SplitData, random_seed: int) -> dict[str, tuple[Pipeline, dict[str, Any]]]:
    models = {
        "logistic_regression": Pipeline(
            [
                ("preprocess", _preprocessor(scale_numeric=True)),
                (
                    "model",
                    LogisticRegression(
                        max_iter=1000,
                        class_weight="balanced",
                        random_state=random_seed,
                    ),
                ),
            ]
        ),
        "random_forest_classifier": Pipeline(
            [
                ("preprocess", _preprocessor(scale_numeric=False)),
                (
                    "model",
                    RandomForestClassifier(
                        n_estimators=160,
                        min_samples_leaf=2,
                        class_weight="balanced",
                        random_state=random_seed,
                        n_jobs=-1,
                    ),
                ),
            ]
        ),
    }
    return {
        name: (pipeline.fit(split.x_train, split.y_class_train), _classification_metrics(pipeline, split))
        for name, pipeline in models.items()
    }


def _train_regressors(split: SplitData, random_seed: int) -> dict[str, tuple[Pipeline, dict[str, Any]]]:
    models = {
        "ridge_regression": Pipeline(
            [
                ("preprocess", _preprocessor(scale_numeric=True)),
                ("model", Ridge(alpha=1.0)),
            ]
        ),
        "random_forest_regressor": Pipeline(
            [
                ("preprocess", _preprocessor(scale_numeric=False)),
                (
                    "model",
                    RandomForestRegressor(
                        n_estimators=160,
                        min_samples_leaf=2,
                        random_state=random_seed,
                        n_jobs=-1,
                    ),
                ),
            ]
        ),
    }
    return {
        name: (pipeline.fit(split.x_train, split.y_reg_train), _regression_metrics(pipeline, split))
        for name, pipeline in models.items()
    }


def _classification_metrics(pipeline: Pipeline, split: SplitData) -> dict[str, Any]:
    predictions = pipeline.predict(split.x_test)
    probabilities = pipeline.predict_proba(split.x_test)[:, 1]
    return {
        "accuracy": _round(accuracy_score(split.y_class_test, predictions)),
        "precision": _round(precision_score(split.y_class_test, predictions, zero_division=0)),
        "recall": _round(recall_score(split.y_class_test, predictions, zero_division=0)),
        "f1": _round(f1_score(split.y_class_test, predictions, zero_division=0)),
        "roc_auc": _round(roc_auc_score(split.y_class_test, probabilities))
        if split.y_class_test.nunique() > 1
        else None,
        "confusion_matrix": confusion_matrix(split.y_class_test, predictions).tolist(),
    }


def _regression_metrics(pipeline: Pipeline, split: SplitData) -> dict[str, Any]:
    predictions = np.clip(pipeline.predict(split.x_test), 0.0, 100.0)
    rmse = math.sqrt(mean_squared_error(split.y_reg_test, predictions))
    severe_mask = split.y_reg_test >= 50.0
    severe_mae = (
        mean_absolute_error(split.y_reg_test[severe_mask], predictions[severe_mask])
        if severe_mask.any()
        else 0.0
    )
    return {
        "mae": _round(mean_absolute_error(split.y_reg_test, predictions)),
        "rmse": _round(rmse),
        "r2": _round(r2_score(split.y_reg_test, predictions)),
        "severe_blackout_mae": _round(severe_mae),
    }


def _select_classifier(
    results: dict[str, tuple[Pipeline, dict[str, Any]]],
) -> tuple[str, Pipeline, dict[str, Any]]:
    name = max(
        results,
        key=lambda model_name: (
            results[model_name][1]["f1"],
            results[model_name][1]["roc_auc"] or 0.0,
            results[model_name][1]["recall"],
        ),
    )
    pipeline, metrics = results[name]
    return name, pipeline, metrics


def _select_regressor(
    results: dict[str, tuple[Pipeline, dict[str, Any]]],
) -> tuple[str, Pipeline, dict[str, Any]]:
    name = min(results, key=lambda model_name: results[model_name][1]["mae"])
    pipeline, metrics = results[name]
    return name, pipeline, metrics


def _preprocessor(scale_numeric: bool) -> ColumnTransformer:
    numeric_transformer = StandardScaler() if scale_numeric else "passthrough"
    return ColumnTransformer(
        [
            ("categorical", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
            ("numeric", numeric_transformer, NUMERIC_FEATURES),
        ]
    )


def _metadata(
    dataframe: pd.DataFrame,
    dataset_path: Path,
    split_strategy: str,
    classifier_name: str,
    regressor_name: str,
    classifier_metrics: dict[str, Any],
    regressor_metrics: dict[str, Any],
    classifier_results: dict[str, tuple[Pipeline, dict[str, Any]]],
    regressor_results: dict[str, tuple[Pipeline, dict[str, Any]]],
    random_seed: int,
    classifier: Pipeline,
    regressor: Pipeline,
) -> dict[str, Any]:
    class_counts = dataframe[CLASSIFICATION_TARGET].value_counts().to_dict()
    return {
        "model_version": MODEL_VERSION,
        "training_timestamp": datetime.now(UTC).isoformat(),
        "dataset_path": str(dataset_path),
        "dataset_row_count": len(dataframe),
        "git_commit": _git_commit(),
        "feature_columns": MODEL_FEATURE_COLUMNS,
        "categorical_features": CATEGORICAL_FEATURES,
        "numeric_features": NUMERIC_FEATURES,
        "classification_target": CLASSIFICATION_TARGET,
        "regression_target": REGRESSION_TARGET,
        "train_test_strategy": split_strategy,
        "random_seed": random_seed,
        "class_distribution": {
            "cascade_false": int(class_counts.get(False, 0)),
            "cascade_true": int(class_counts.get(True, 0)),
        },
        "classifier_model": classifier_name,
        "regressor_model": regressor_name,
        "classifier_metrics": classifier_metrics,
        "regressor_metrics": regressor_metrics,
        "all_classifier_metrics": {
            name: metrics for name, (_, metrics) in classifier_results.items()
        },
        "all_regressor_metrics": {
            name: metrics for name, (_, metrics) in regressor_results.items()
        },
        "classifier_top_features": top_feature_importances(classifier),
        "regressor_top_features": top_feature_importances(regressor),
        "package_versions": {
            "pandas": pd.__version__,
            "numpy": np.__version__,
            "scikit_learn": sklearn.__version__,
            "joblib": joblib.__version__,
        },
        "selection_rationale": {
            "classifier": "highest F1 score, then ROC AUC and recall",
            "regressor": "lowest MAE on the held-out split",
        },
        "limitations": (
            "Models are trained only on Tripwire's synthetic simulation scenarios "
            "and should not be interpreted as real-world grid reliability models."
        ),
    }


def top_feature_importances(pipeline: Pipeline, limit: int = 12) -> list[dict[str, Any]]:
    model = pipeline.named_steps["model"]
    if not hasattr(model, "feature_importances_"):
        return []

    names = pipeline.named_steps["preprocess"].get_feature_names_out()
    importances = model.feature_importances_
    ranked = sorted(zip(names, importances), key=lambda item: item[1], reverse=True)[:limit]
    return [
        {
            "feature": _clean_feature_name(str(feature)),
            "importance": _round(float(importance)),
        }
        for feature, importance in ranked
    ]


def summarize_training(metadata: dict[str, Any]) -> str:
    lines = [
        f"Dataset rows: {metadata['dataset_row_count']}",
        f"Split strategy: {metadata['train_test_strategy']}",
        f"Class distribution: {metadata['class_distribution']}",
        "",
        f"Champion classifier: {metadata['classifier_model']}",
        f"Classifier metrics: {metadata['classifier_metrics']}",
        "",
        f"Champion regressor: {metadata['regressor_model']}",
        f"Regressor metrics: {metadata['regressor_metrics']}",
        "",
        "Top classifier features:",
    ]
    lines.extend(
        f"{item['feature']}: {item['importance']}"
        for item in metadata["classifier_top_features"][:8]
    )
    lines.extend(["", "Top regressor features:"])
    lines.extend(
        f"{item['feature']}: {item['importance']}"
        for item in metadata["regressor_top_features"][:8]
    )
    return "\n".join(lines)


def _clean_feature_name(name: str) -> str:
    return (
        name.replace("categorical__", "")
        .replace("numeric__", "")
        .replace("component_id_", "component_id=")
        .replace("component_type_", "component_type=")
        .replace("dispatch_profile_", "dispatch_profile=")
    )


def _git_commit() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=Path(__file__).resolve().parents[3],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.SubprocessError):
        return None


def _round(value: float) -> float:
    return round(float(value), 4)
