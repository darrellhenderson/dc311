#!/usr/bin/env python3
"""
Incremental DC 311 data refresh with gap audit and backfill.

Maintains a rolling 365-day canonical CSV, then build_data.py post-processes it
into dashboard JSON shards.

Daily workflow:
  1. Pull recent records (default: last 7 days) and upsert into the canonical CSV
  2. Compare local vs ArcGIS counts per month over the rolling year
  3. Backfill any months that are missing or under-counted
  4. Trim to the rolling window and save
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from category_rules import EXCLUDED_SERVICE_TYPES
from query_service_requests import (
    DATA_DIR,
    FIELDS,
    count_records,
    date_range_where,
    fetch_all,
    fetch_year_range,
    format_duration,
    layer_for_year,
    log,
    rolling_window_bounds,
    rolling_window_where,
    write_checkpoint,
)

CANONICAL_CSV = DATA_DIR / "service_requests_365days_raw.csv"
STATE_PATH = DATA_DIR / "refresh_state.json"
CHECKPOINT_PATH = DATA_DIR / "refresh_checkpoint.json"

ROLLING_WINDOW_DAYS = 365
DEFAULT_INCREMENTAL_DAYS = 7
GAP_RATIO_THRESHOLD = 0.98  # Trigger backfill when local count is below 98% of remote.
MIN_CANONICAL_ROWS = 1000  # Below this, treat the canonical CSV as bootstrap-required.


def load_state() -> dict:
    if STATE_PATH.is_file():
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return {}


def save_state(state: dict) -> None:
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def load_canonical() -> pd.DataFrame:
    if not CANONICAL_CSV.is_file():
        return pd.DataFrame(columns=FIELDS)
    return pd.read_csv(CANONICAL_CSV, low_memory=False)


def parse_adddate(series: pd.Series) -> pd.Series:
    cleaned = series.astype(str).str.replace(" UTC", "", regex=False)
    return pd.to_datetime(cleaned, utc=True, errors="coerce")


def trim_to_window(df: pd.DataFrame, window_days: int) -> pd.DataFrame:
    if df.empty:
        return df
    start_dc, _ = rolling_window_bounds(window_days)
    cutoff = pd.Timestamp(start_dc.astimezone(timezone.utc))
    dates = parse_adddate(df["ADDDATE"])
    return df.loc[dates >= cutoff].copy()


def drop_excluded_service_types(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    mask = ~df["SERVICECODEDESCRIPTION"].astype(str).isin(EXCLUDED_SERVICE_TYPES)
    return df.loc[mask].copy()


def upsert_records(existing: pd.DataFrame, new_rows: list[dict]) -> pd.DataFrame:
    if not new_rows:
        return existing
    incoming = pd.DataFrame(new_rows, columns=FIELDS)
    if existing.empty:
        return incoming
    combined = pd.concat([existing, incoming], ignore_index=True)
    return combined.drop_duplicates(subset=["SERVICEREQUESTID"], keep="last")


def save_canonical(df: pd.DataFrame) -> None:
    df = trim_to_window(df, ROLLING_WINDOW_DAYS)
    df = drop_excluded_service_types(df)
    df.to_csv(CANONICAL_CSV, index=False)
    size_mb = CANONICAL_CSV.stat().st_size / (1024 * 1024)
    log(f"  Saved canonical CSV: {len(df):,} rows → {CANONICAL_CSV} ({size_mb:.1f} MB)")


def iter_months_in_window(window_days: int):
    """Yield (month_key, range_start, range_end, calendar_year) for the rolling window."""
    start_dc, end_dc = rolling_window_bounds(window_days)
    cursor = start_dc.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    while cursor < end_dc:
        if cursor.month == 12:
            next_month = cursor.replace(year=cursor.year + 1, month=1)
        else:
            next_month = cursor.replace(month=cursor.month + 1)
        range_start = max(cursor, start_dc)
        range_end = min(next_month, end_dc)
        if range_start < range_end:
            yield cursor.strftime("%Y-%m"), range_start, range_end, cursor.year
        cursor = next_month


def local_counts_by_month(df: pd.DataFrame, window_days: int) -> dict[str, int]:
    trimmed = trim_to_window(df, window_days)
    if trimmed.empty:
        return {}
    dates = parse_adddate(trimmed["ADDDATE"])
    month_keys = dates.dt.strftime("%Y-%m")
    return month_keys.value_counts().to_dict()


def remote_count_for_range(year: int, start_dc: datetime, end_dc: datetime) -> int:
    try:
        layer_id = layer_for_year(year)
    except KeyError:
        return 0
    where = date_range_where(start_dc, end_dc)
    return count_records(layer_id, where)


def audit_gaps(df: pd.DataFrame, window_days: int) -> tuple[dict, list[dict]]:
    local = local_counts_by_month(df, window_days)
    month_audit: dict[str, dict] = {}
    gaps: list[dict] = []

    for month_key, start_dc, end_dc, year in iter_months_in_window(window_days):
        remote = remote_count_for_range(year, start_dc, end_dc)
        local_count = int(local.get(month_key, 0))
        ratio = (local_count / remote) if remote > 0 else 1.0
        needs_backfill = remote > 0 and (local_count == 0 or ratio < GAP_RATIO_THRESHOLD)
        month_audit[month_key] = {
            "local": local_count,
            "remote": remote,
            "ratio": round(ratio, 4),
            "needs_backfill": needs_backfill,
            "year": year,
            "range_start": start_dc.isoformat(),
            "range_end": end_dc.isoformat(),
        }
        if needs_backfill:
            gaps.append({
                "month": month_key,
                "year": year,
                "start": start_dc,
                "end": end_dc,
                "local": local_count,
                "remote": remote,
            })
            log(
                f"  Gap {month_key}: local={local_count:,}, remote={remote:,} "
                f"({ratio:.1%}) → backfill scheduled"
            )
        else:
            log(f"  OK   {month_key}: local={local_count:,}, remote={remote:,} ({ratio:.1%})")

    return month_audit, gaps


def pull_incremental(days: int, checkpoint_every: int) -> list[dict]:
    where = rolling_window_where(days)
    log(f"\n[incremental] Pulling records from last {days} days")
    log(f"  where: {where}")

    seen: set[str] = set()
    records: list[dict] = []
    start_dc, end_dc = rolling_window_bounds(days)
    years = range(start_dc.year, end_dc.year + 1)

    for year in years:
        try:
            layer_id = layer_for_year(year)
        except KeyError as e:
            log(f"  Warning: {e}. Skipping year {year}.")
            continue
        layer_label = f"layer {layer_id} ({year})"
        rows = fetch_all(
            layer_id,
            where=where,
            checkpoint_path=CHECKPOINT_PATH,
            checkpoint_every_pages=checkpoint_every,
            layer_label=layer_label,
        )
        added = 0
        for row in rows:
            req_id = row.get("SERVICEREQUESTID")
            if req_id in seen:
                continue
            seen.add(req_id)
            records.append(row)
            added += 1
        log(f"  [{layer_label}] Added {added:,} unique incremental rows")

    return records


def backfill_gap(df: pd.DataFrame, gap: dict, checkpoint_every: int) -> pd.DataFrame:
    year = gap["year"]
    try:
        layer_id = layer_for_year(year)
    except KeyError as e:
        log(f"  Skipping {gap['month']}: {e}")
        return df

    start_dc, end_dc = gap["start"], gap["end"]
    where = date_range_where(start_dc, end_dc)
    layer_label = f"backfill {gap['month']} (layer {layer_id})"
    log(f"\n[backfill] {gap['month']}: local={gap['local']:,}, remote={gap['remote']:,}")
    log(f"  where: {where}")
    rows = fetch_all(
        layer_id,
        where=where,
        checkpoint_path=CHECKPOINT_PATH,
        checkpoint_every_pages=checkpoint_every,
        layer_label=layer_label,
    )
    return upsert_records(df, rows)


def canonical_needs_bootstrap() -> bool:
    if not CANONICAL_CSV.is_file() or CANONICAL_CSV.stat().st_size < 1024:
        return True
    return len(load_canonical()) < MIN_CANONICAL_ROWS


def bootstrap_full_year(checkpoint_every: int) -> pd.DataFrame:
    log("\n[bootstrap] No canonical CSV; running full rolling-year pull")
    write_checkpoint(CHECKPOINT_PATH, {"phase": "bootstrap_started"})
    records = fetch_year_range(
        ROLLING_WINDOW_DAYS,
        checkpoint_path=CHECKPOINT_PATH,
        checkpoint_every_pages=checkpoint_every,
    )
    return pd.DataFrame(records, columns=FIELDS)


def refresh(
    *,
    incremental_days: int,
    checkpoint_every: int,
    skip_backfill: bool,
    bootstrap: bool,
) -> int:
    run_started = time.monotonic()
    log("=" * 60)
    log("DC 311 Incremental Data Refresh")
    log(f"Canonical CSV: {CANONICAL_CSV}")
    log(f"Rolling window: {ROLLING_WINDOW_DAYS} days")
    log(f"Incremental overlap: {incremental_days} days")
    log("=" * 60)

    if bootstrap or canonical_needs_bootstrap():
        df = bootstrap_full_year(checkpoint_every)
    else:
        df = load_canonical()
        log(f"\nLoaded canonical CSV: {len(df):,} rows")

    incremental_rows = pull_incremental(incremental_days, checkpoint_every)
    df = upsert_records(df, incremental_rows)
    log(f"  After incremental upsert: {len(df):,} rows")

    df = trim_to_window(df, ROLLING_WINDOW_DAYS)

    log("\n[audit] Comparing local vs ArcGIS counts by month…")
    month_audit, gaps = audit_gaps(df, ROLLING_WINDOW_DAYS)

    if gaps and not skip_backfill:
        log(f"\n[backfill] Filling {len(gaps)} gap(s)…")
        for gap in gaps:
            df = backfill_gap(df, gap, checkpoint_every)
            df = trim_to_window(df, ROLLING_WINDOW_DAYS)
    elif gaps:
        log(f"\n[backfill] Skipped ({len(gaps)} gap(s) detected, --skip-backfill set)")
    else:
        log("\n[backfill] No gaps detected")

    save_canonical(df)

    state = {
        "last_refresh_at": datetime.now(timezone.utc).isoformat(),
        "canonical_csv": CANONICAL_CSV.name,
        "record_count": len(df),
        "rolling_window_days": ROLLING_WINDOW_DAYS,
        "incremental_days": incremental_days,
        "months": month_audit,
        "gaps_backfilled": len(gaps) if not skip_backfill else 0,
        "total_elapsed_sec": round(time.monotonic() - run_started, 1),
    }
    save_state(state)
    write_checkpoint(CHECKPOINT_PATH, {"phase": "refresh_complete", **state})

    log("\n" + "=" * 60)
    log(f"Refresh complete in {format_duration(state['total_elapsed_sec'])}")
    log(f"Records: {len(df):,}")
    log(f"State: {STATE_PATH}")
    log("=" * 60)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Incremental refresh with gap audit/backfill for DC 311 data",
    )
    parser.add_argument(
        "--incremental-days",
        type=int,
        default=DEFAULT_INCREMENTAL_DAYS,
        help="Days of overlap to pull on each refresh (default: 7)",
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=10,
        help="Log/checkpoint every N ArcGIS pages (default: 10)",
    )
    parser.add_argument(
        "--skip-backfill",
        action="store_true",
        help="Audit gaps only; do not fetch missing months",
    )
    parser.add_argument(
        "--bootstrap",
        action="store_true",
        help="Force a full rolling-year pull before incremental steps",
    )
    parser.add_argument(
        "--audit-only",
        action="store_true",
        help="Compare local vs remote counts without pulling new data",
    )
    args = parser.parse_args()

    if args.audit_only:
        df = load_canonical()
        if df.empty:
            print(f"Error: {CANONICAL_CSV} not found", file=sys.stderr)
            return 1
        log(f"Loaded {len(df):,} rows from {CANONICAL_CSV}")
        month_audit, gaps = audit_gaps(df, ROLLING_WINDOW_DAYS)
        save_state({
            "last_audit_at": datetime.now(timezone.utc).isoformat(),
            "record_count": len(df),
            "months": month_audit,
            "gaps_found": len(gaps),
        })
        return 0

    return refresh(
        incremental_days=args.incremental_days,
        checkpoint_every=args.checkpoint_every,
        skip_backfill=args.skip_backfill,
        bootstrap=args.bootstrap,
    )


if __name__ == "__main__":
    raise SystemExit(main())
