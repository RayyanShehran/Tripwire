from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.ml.dataset import run_cli


if __name__ == "__main__":
    raise SystemExit(run_cli())
