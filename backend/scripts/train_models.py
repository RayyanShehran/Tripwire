from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.ml.dataset import default_output_path
from app.ml.train import MODEL_DIR, summarize_training, train_models


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train Tripwire baseline ML models.")
    parser.add_argument("--dataset", type=Path, default=default_output_path())
    parser.add_argument("--output-dir", type=Path, default=MODEL_DIR)
    return parser.parse_args(argv)


def run_cli(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    result = train_models(dataset_path=args.dataset, output_dir=args.output_dir)
    print(summarize_training(result.metadata))
    print(f"\nClassifier written to: {args.output_dir / 'cascade_classifier.joblib'}")
    print(f"Regressor written to: {args.output_dir / 'load_loss_regressor.joblib'}")
    print(f"Metadata written to: {args.output_dir / 'model_metadata.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(run_cli())
