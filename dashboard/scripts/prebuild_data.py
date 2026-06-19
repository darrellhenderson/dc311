#!/usr/bin/env python3
"""Prebuild hook: rebuild shards from raw CSV if present, else skip if shards exist."""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CANONICAL_CSV = REPO_ROOT / "data/raw/service_requests_365days_raw.csv"
SHORT_CSV = REPO_ROOT / "data/raw/service_requests_90days_raw.csv"
MANIFEST = Path(__file__).resolve().parents[1] / "public/data/manifest.json"
BUILD_SCRIPT = Path(__file__).resolve().parent / "build_data.py"


def resolve_csv() -> Path | None:
    if CANONICAL_CSV.is_file():
        return CANONICAL_CSV
    if SHORT_CSV.is_file():
        return SHORT_CSV
    return None


def manifest_has_estimates(path: Path) -> bool:
    """True when manifest includes a non-empty estimates array."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    estimates = data.get("estimates")
    return isinstance(estimates, list) and len(estimates) > 0


def shards_are_current(csv_path: Path) -> bool:
    """True when manifest exists, includes estimates, and is newer than the CSV."""
    return (
        MANIFEST.is_file()
        and MANIFEST.stat().st_mtime > csv_path.stat().st_mtime
        and manifest_has_estimates(MANIFEST)
    )


def main() -> int:
    csv_path = resolve_csv()
    if csv_path is not None:
        if shards_are_current(csv_path):
            print(f"Data shards are up to date ({csv_path.name}); skipping rebuild")
            return 0
        if MANIFEST.is_file() and not manifest_has_estimates(MANIFEST):
            print("Manifest missing estimate data; rebuilding shards")
        return subprocess.call([sys.executable, str(BUILD_SCRIPT), "--csv", str(csv_path)])

    if MANIFEST.is_file():
        if not manifest_has_estimates(MANIFEST):
            print(
                "Error: manifest.json exists but has no estimate data. "
                "Run query_service_requests.py and npm run build.",
                file=sys.stderr,
            )
            return 1
        print("Skipping data build: no raw CSV found; using pre-built data shards")
        return 0

    print(
        "Error: no raw CSV and no public/data/manifest.json. "
        "Run data_refresh.py or query_service_requests.py first.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
