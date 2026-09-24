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
from sklearn.base import clone
from sklearn.ensemble import (
    GradientBoostingRegressor,
    HistGradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
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

from app.ml.artifacts import (
    CLASSIFIER_ARTIFACT,
    METADATA_ARTIFACT,
    MODEL_DIR,
    REGRESSOR_ARTIFACT,
)
from app.ml.dataset import DATASET_SCHEMA_VERSION, default_output_path, validate_dataset
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

@dataclass(frozen=True)
class SplitData:
    x_train: pd.DataFrame
    x_validation: pd.DataFrame
    x_test: pd.DataFrame
    y_class_train: pd.Series
    y_class_validation: pd.Series
    y_class_test: pd.Series
    y_reg_train: pd.Series
    y_reg_validation: pd.Series
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

    champion_classifier_name = _select_classifier(classifier_results)
    champion_regressor_name = _select_regressor(regressor_results)
    classifier_validation_metrics = classifier_results[champion_classifier_name][1]
    regressor_validation_metrics = regressor_results[champion_regressor_name][1]
    champion_classifier = _refit_classifier(
        classifier_results[champion_classifier_name][0], split
    )
    champion_regressor = _refit_regressor(
        regressor_results[champion_regressor_name][0], split
    )
    classifier_test_metrics = _classification_metrics(
        champion_classifier, split.x_test, split.y_class_test
    )
    regressor_test_metrics = _regression_metrics(
        champion_regressor, split.x_test, split.y_reg_test
    )

    metadata = _metadata(
        dataframe=dataframe,
        dataset_path=dataset_path,
        split_strategy=split.strategy,
        classifier_name=champion_classifier_name,
        regressor_name=champion_regressor_name,
        classifier_validation_metrics=classifier_validation_metrics,
        regressor_validation_metrics=regressor_validation_metrics,
        classifier_test_metrics=classifier_test_metrics,
        regressor_test_metrics=regressor_test_metrics,
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

    if groups.nunique() >= 6:
        outer = GroupShuffleSplit(n_splits=30, test_size=0.2, random_state=random_seed)
        for train_validation_index, test_index in outer.split(features, y_class, groups):
            inner_features = features.iloc[train_validation_index]
            inner_classes = y_class.iloc[train_validation_index]
            inner_groups = groups.iloc[train_validation_index]
            inner = GroupShuffleSplit(
                n_splits=30,
                test_size=0.25,
                random_state=random_seed + 1,
            )
            for train_relative, validation_relative in inner.split(
                inner_features, inner_classes, inner_groups
            ):
                train_index = train_validation_index[train_relative]
                validation_index = train_validation_index[validation_relative]
                if all(
                    y_class.iloc[index].nunique() > 1
                    for index in (train_index, validation_index, test_index)
                ):
                    return SplitData(
                        x_train=features.iloc[train_index],
                        x_validation=features.iloc[validation_index],
                        x_test=features.iloc[test_index],
                        y_class_train=y_class.iloc[train_index],
                        y_class_validation=y_class.iloc[validation_index],
                        y_class_test=y_class.iloc[test_index],
                        y_reg_train=y_reg.iloc[train_index],
                        y_reg_validation=y_reg.iloc[validation_index],
                        y_reg_test=y_reg.iloc[test_index],
                        strategy="grouped_train_validation_test_by_initial_component",
                    )

    stratify = y_class if y_class.nunique() > 1 else None
    (
        x_train_validation,
        x_test,
        y_class_train_validation,
        y_class_test,
        y_reg_train_validation,
        y_reg_test,
    ) = train_test_split(
        features,
        y_class,
        y_reg,
        test_size=0.2,
        random_state=random_seed,
        stratify=stratify,
    )
    inner_stratify = y_class_train_validation if y_class_train_validation.nunique() > 1 else None
    (
        x_train,
        x_validation,
        y_class_train,
        y_class_validation,
        y_reg_train,
        y_reg_validation,
    ) = train_test_split(
        x_train_validation,
        y_class_train_validation,
        y_reg_train_validation,
        test_size=0.25,
        random_state=random_seed + 1,
        stratify=inner_stratify,
    )
    return SplitData(
        x_train=x_train,
        x_validation=x_validation,
        x_test=x_test,
        y_class_train=y_class_train,
        y_class_validation=y_class_validation,
        y_class_test=y_class_test,
        y_reg_train=y_reg_train,
        y_reg_validation=y_reg_validation,
        y_reg_test=y_reg_test,
        strategy="stratified_train_validation_test",
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
        name: (
            pipeline.fit(split.x_train, split.y_class_train),
            _classification_metrics(
                pipeline, split.x_validation, split.y_class_validation
            ),
        )
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
        "hist_gradient_boosting_regressor": Pipeline(
            [
                ("preprocess", _preprocessor(scale_numeric=False)),
                (
                    "model",
                    HistGradientBoostingRegressor(
                        max_iter=160,
                        learning_rate=0.06,
                        max_leaf_nodes=24,
                        l2_regularization=1.0,
                        random_state=random_seed,
                    ),
                ),
            ]
        ),
        "gradient_boosting_regressor": Pipeline(
            [
                ("preprocess", _preprocessor(scale_numeric=False)),
                (
                    "model",
                    GradientBoostingRegressor(
                        n_estimators=160,
                        learning_rate=0.05,
                        max_depth=3,
                        min_samples_leaf=3,
                        random_state=random_seed,
                    ),
                ),
            ]
        ),
    }
    return {
        name: (
            pipeline.fit(split.x_train, split.y_reg_train),
            _regression_metrics(
                pipeline, split.x_validation, split.y_reg_validation
            ),
        )
        for name, pipeline in models.items()
    }


def _classification_metrics(
    pipeline: Pipeline,
    features: pd.DataFrame,
    targets: pd.Series,
) -> dict[str, Any]:
    predictions = pipeline.predict(features)
    probabilities = pipeline.predict_proba(features)[:, 1]
    return {
        "accuracy": _round(accuracy_score(targets, predictions)),
        "precision": _round(precision_score(targets, predictions, zero_division=0)),
        "recall": _round(recall_score(targets, predictions, zero_division=0)),
        "f1": _round(f1_score(targets, predictions, zero_division=0)),
        "roc_auc": _round(roc_auc_score(targets, probabilities))
        if targets.nunique() > 1
        else None,
        "confusion_matrix": confusion_matrix(targets, predictions).tolist(),
    }


def _regression_metrics(
    pipeline: Pipeline,
    features: pd.DataFrame,
    targets: pd.Series,
) -> dict[str, Any]:
    predictions = np.clip(pipeline.predict(features), 0.0, 100.0)
    rmse = math.sqrt(mean_squared_error(targets, predictions))
    severe_mask = targets >= 50.0
    severe_mae = (
        mean_absolute_error(targets[severe_mask], predictions[severe_mask])
        if severe_mask.any()
        else 0.0
    )
    return {
        "mae": _round(mean_absolute_error(targets, predictions)),
        "rmse": _round(rmse),
        "r2": _round(r2_score(targets, predictions)),
        "severe_blackout_mae": _round(severe_mae),
        "severity_buckets": _severity_bucket_metrics(targets, predictions),
    }


def _select_classifier(
    results: dict[str, tuple[Pipeline, dict[str, Any]]],
) -> str:
    return max(
        results,
        key=lambda model_name: (
            results[model_name][1]["f1"],
            results[model_name][1]["roc_auc"] or 0.0,
            results[model_name][1]["recall"],
        ),
    )


def _select_regressor(
    results: dict[str, tuple[Pipeline, dict[str, Any]]],
) -> str:
    return min(
        results,
        key=lambda model_name: (
            results[model_name][1]["mae"],
            results[model_name][1]["severe_blackout_mae"],
            results[model_name][1]["rmse"],
        ),
    )


def _preprocessor(scale_numeric: bool) -> ColumnTransformer:
    numeric_transformer = StandardScaler() if scale_numeric else "passthrough"
    return ColumnTransformer(
        [
            (
                "categorical",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                CATEGORICAL_FEATURES,
            ),
            ("numeric", numeric_transformer, NUMERIC_FEATURES),
    ]
    )


def _refit_classifier(pipeline: Pipeline, split: SplitData) -> Pipeline:
    return clone(pipeline).fit(
        pd.concat([split.x_train, split.x_validation]),
        pd.concat([split.y_class_train, split.y_class_validation]),
    )


def _refit_regressor(pipeline: Pipeline, split: SplitData) -> Pipeline:
    return clone(pipeline).fit(
        pd.concat([split.x_train, split.x_validation]),
        pd.concat([split.y_reg_train, split.y_reg_validation]),
    )


def _severity_bucket_metrics(
    targets: pd.Series,
    predictions: np.ndarray,
) -> dict[str, dict[str, float | int]]:
    buckets = {
        "zero": targets == 0.0,
        "moderate": (targets > 0.0) & (targets < 50.0),
        "severe": targets >= 50.0,
    }
    result: dict[str, dict[str, float | int]] = {}
    for name, mask in buckets.items():
        count = int(mask.sum())
        result[name] = {
            "count": count,
            "mae": _round(mean_absolute_error(targets[mask], predictions[mask]))
            if count
            else 0.0,
        }
    return result


def _metadata(
    dataframe: pd.DataFrame,
    dataset_path: Path,
    split_strategy: str,
    classifier_name: str,
    regressor_name: str,
    classifier_validation_metrics: dict[str, Any],
    regressor_validation_metrics: dict[str, Any],
    classifier_test_metrics: dict[str, Any],
    regressor_test_metrics: dict[str, Any],
    classifier_results: dict[str, tuple[Pipeline, dict[str, Any]]],
    regressor_results: dict[str, tuple[Pipeline, dict[str, Any]]],
    random_seed: int,
    classifier: Pipeline,
    regressor: Pipeline,
) -> dict[str, Any]:
    class_counts = dataframe[CLASSIFICATION_TARGET].value_counts().to_dict()
    target_distribution = _target_distribution(dataframe[REGRESSION_TARGET])
    return {
        "model_version": MODEL_VERSION,
        "training_timestamp": datetime.now(UTC).isoformat(),
        "dataset_path": str(dataset_path),
        "dataset_schema_version": DATASET_SCHEMA_VERSION,
        "dataset_row_count": len(dataframe),
        "git_commit": _git_commit(),
        "feature_columns": MODEL_FEATURE_COLUMNS,
        "categorical_features": CATEGORICAL_FEATURES,
        "numeric_features": NUMERIC_FEATURES,
        "classification_target": CLASSIFICATION_TARGET,
        "regression_target": REGRESSION_TARGET,
        "train_validation_test_strategy": split_strategy,
        "train_test_strategy": split_strategy,
        "random_seed": random_seed,
        "class_distribution": {
            "cascade_false": int(class_counts.get(False, 0)),
            "cascade_true": int(class_counts.get(True, 0)),
        },
        "load_loss_target_distribution": target_distribution,
        "classifier_model": classifier_name,
        "regressor_model": regressor_name,
        "classifier_validation_metrics": classifier_validation_metrics,
        "classifier_test_metrics": classifier_test_metrics,
        "regressor_validation_metrics": regressor_validation_metrics,
        "regressor_test_metrics": regressor_test_metrics,
        # Backward-compatible aliases used by inference and existing reports.
        "classifier_metrics": classifier_test_metrics,
        "regressor_metrics": regressor_test_metrics,
        "all_classifier_validation_metrics": {
            name: metrics for name, (_, metrics) in classifier_results.items()
        },
        "all_regressor_validation_metrics": {
            name: metrics for name, (_, metrics) in regressor_results.items()
        },
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
            "classifier": (
                "selected on validation F1, then ROC AUC and recall; final metrics "
                "are from the untouched grouped test split"
            ),
            "regressor": (
                "selected on validation MAE, then severe-case MAE and RMSE; final "
                "metrics are from the untouched grouped test split"
            ),
        },
        "limitations": (
            "Models are trained only on Tripwire's synthetic simulation scenarios. "
            "Load loss is strongly multimodal, including many zero-loss and total-"
            "blackout outcomes, so the regression estimate has high uncertainty and "
            "is secondary to cascade probability. These models must not be interpreted "
            "as real-world grid reliability models."
        ),
    }


def _target_distribution(targets: pd.Series) -> dict[str, dict[str, float | int]]:
    numeric = targets.astype(float)
    buckets = {
        "zero": numeric == 0.0,
        "moderate": (numeric > 0.0) & (numeric < 50.0),
        "severe": (numeric >= 50.0) & (numeric < 100.0),
        "total_blackout": numeric >= 100.0,
    }
    total = len(numeric)
    return {
        name: {
            "count": int(mask.sum()),
            "percent": _round(100.0 * float(mask.sum()) / total) if total else 0.0,
        }
        for name, mask in buckets.items()
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
        f"Load-loss distribution: {metadata['load_loss_target_distribution']}",
        "",
        f"Champion classifier: {metadata['classifier_model']}",
        f"Classifier validation metrics: {metadata['classifier_validation_metrics']}",
        f"Classifier final test metrics: {metadata['classifier_test_metrics']}",
        "",
        f"Champion regressor: {metadata['regressor_model']}",
        f"Regressor validation metrics: {metadata['regressor_validation_metrics']}",
        f"Regressor final test metrics: {metadata['regressor_test_metrics']}",
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
