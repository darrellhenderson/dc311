#!/usr/bin/env python3
"""Prebuild hook: rebuild shards from raw CSV if present, else skip if shards exist."""

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


def main() -> int:
    csv_path = resolve_csv()
    if csv_path is not None:
        # Skip rebuild if shards are already newer than the source CSV.
        if MANIFEST.is_file() and MANIFEST.stat().st_mtime > csv_path.stat().st_mtime:
            print(f"Data shards are up to date ({csv_path.name}); skipping rebuild")
            return 0
        return subprocess.call([sys.executable, str(BUILD_SCRIPT), "--csv", str(csv_path)])

    if MANIFEST.is_file():
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
