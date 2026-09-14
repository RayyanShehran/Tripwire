from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.ml.dataset import default_output_path, summarize_diagnostics, analyze_dataset


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze a generated Tripwire dataset CSV.")
    parser.add_argument("--input", type=Path, default=default_output_path())
    return parser.parse_args(argv)


def run_cli(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    dataframe = pd.read_csv(args.input)
    diagnostics = analyze_dataset(dataframe)
    print(summarize_diagnostics(diagnostics))
    return 0


if __name__ == "__main__":
    raise SystemExit(run_cli())
