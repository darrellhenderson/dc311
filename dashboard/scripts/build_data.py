#!/usr/bin/env python3
"""
Build compact monthly JSON shards and rollups from a raw service-requests CSV.

Output: dashboard/public/data/manifest.json, YYYY-MM.json, rollups/YYYY-MM.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
from category_rules import (  # noqa: E402
    CATEGORY_MAP,
    CLOSED_STATUSES,
    OPEN_STATUSES,
    WARD_ORDER,
    assign_category,
    is_excluded_service_type,
)

DEFAULT_CSV_PATH = REPO_ROOT / "data/raw/service_requests_365days_raw.csv"
SHORT_CSV_PATH = REPO_ROOT / "data/raw/service_requests_90days_raw.csv"
OUT_DIR = Path(__file__).resolve().parents[1] / "public" / "data"
ROLLUP_DIR = OUT_DIR / "rollups"

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
AGE_BUCKETS = ["< 1 week", "1–4 weeks", "1–2 months", "2–3 months"]


class DictEncoder:
    """Assigns integer indices to repeated strings."""

    def __init__(self):
        self.tables: dict[str, list[str]] = defaultdict(list)
        self._lookup: dict[str, dict[str, int]] = defaultdict(dict)

    def encode(self, table: str, value: str | None) -> int | None:
        if value is None or value == "":
            return None
        if value not in self._lookup[table]:
            idx = len(self.tables[table])
            self.tables[table].append(value)
            self._lookup[table][value] = idx
        return self._lookup[table][value]


def parse_date_ms(val) -> int | None:
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return None
    s = str(val).strip()
    if not s:
        return None
    if s.endswith(" UTC"):
        s = s[:-4]
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
            return int(dt.timestamp() * 1000)
        except ValueError:
            continue
    return None


def age_bucket(days: int) -> int:
    if days < 7:
        return 0
    if days < 30:
        return 1
    if days < 60:
        return 2
    return 3


def median(vals: list[float]) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def percentile(vals: list[float], p: float) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    idx = (p / 100) * (len(s) - 1)
    lo, hi = int(math.floor(idx)), int(math.ceil(idx))
    if hi >= len(s):
        return s[-1]
    w = idx - lo
    return s[lo] * (1 - w) + s[hi] * w


def process_row(row: pd.Series, now_ms: int, enc: DictEncoder) -> tuple[dict | None, bool]:
    """Returns (compact_row_or_None, dropped_for_ward)."""
    if row.get("WARD") not in WARD_ORDER:
        return None, True

    add_ms = parse_date_ms(row.get("ADDDATE"))
    if add_ms is None:
        return None, False

    svc = str(row.get("SERVICECODEDESCRIPTION") or "")
    if is_excluded_service_type(svc):
        return None, False

    res_ms = parse_date_ms(row.get("RESOLUTIONDATE"))
    due_ms = parse_date_ms(row.get("SERVICEDUEDATE"))
    status = str(row.get("SERVICEORDERSTATUS") or "")
    is_open = status in OPEN_STATUSES
    is_closed = status.startswith("Closed")

    age_days = int((now_ms - add_ms) / 86400000)
    resolution_days = None
    if is_closed and res_ms is not None:
        resolution_days = round((res_ms - add_ms) / 86400000, 2)

    add_dt = datetime.fromtimestamp(add_ms / 1000, tz=timezone.utc)
    week_ms = int(datetime(add_dt.year, add_dt.month, add_dt.day, tzinfo=timezone.utc).timestamp() * 1000) - add_dt.weekday() * 86400000

    cat = assign_category(svc)

    sc_raw = row.get("SERVICECODE")
    try:
        sc = int(sc_raw) if pd.notna(sc_raw) else None
    except (ValueError, TypeError):
        sc = enc.encode("serviceCodes", str(sc_raw))

    pri_raw = row.get("PRIORITY")
    try:
        pri = int(pri_raw) if pd.notna(pri_raw) else None
    except (ValueError, TypeError):
        pri = enc.encode("priorities", str(pri_raw))

    return {
        "id": str(row.get("SERVICEREQUESTID") or ""),
        "a": add_ms,
        "r": res_ms,
        "dd": due_ms,
        "st": enc.encode("serviceTypes", svc),
        "ag": enc.encode("agencies", str(row.get("ORGANIZATIONACRONYM") or "") or None),
        "ss": enc.encode("statuses", status),
        "w": enc.encode("wards", str(row.get("WARD") or "")),
        "c": enc.encode("categories", cat),
        "lat": float(row["LATITUDE"]) if pd.notna(row.get("LATITUDE")) else None,
        "lng": float(row["LONGITUDE"]) if pd.notna(row.get("LONGITUDE")) else None,
        "io": 1 if is_open else 0,
        "ic": 1 if is_closed else 0,
        "ad": age_days,
        "rd": resolution_days,
        "h": add_dt.hour,
        "dow": enc.encode("dayOfWeek", DAY_NAMES[add_dt.weekday()]),
        "wk": week_ms,
        "ab": age_bucket(age_days),
        "addr": str(row.get("STREETADDRESS") or "") or None,
        "det": str(row.get("DETAILS") or "") or None,
        "zip": enc.encode("zipcodes", str(row.get("ZIPCODE") or "") or None),
        "city": enc.encode("cities", str(row.get("CITY") or "") or None),
        "state": enc.encode("states", str(row.get("STATE") or "") or None),
        "sc": sc,
        "pri": pri,
        "stc": enc.encode("serviceTypeCodes", str(row.get("SERVICETYPECODEDESCRIPTION") or "") or None),
    }, False


def build_sla_rollup(rows: list[dict], enc: DictEncoder) -> list[dict]:
    """Pre-aggregate SLA table rows for a shard."""
    groups: dict[int, dict] = {}
    for row in rows:
        st = row["st"]
        if st not in groups:
            groups[st] = {
                "category": enc.tables["categories"][row["c"]],
                "agency": enc.tables["agencies"][row["ag"]] if row["ag"] is not None else "",
                "sla_days": [],
                "total": 0,
                "closed": 0,
                "met_sla_count": 0,
                "missed_sla_count": 0,
                "open_past_sla_count": 0,
                "resolution_times": [],
            }
        g = groups[st]
        g["total"] += 1
        if row["ic"]:
            g["closed"] += 1
        if row["dd"] is not None:
            sla_d = (row["dd"] - row["a"]) / 86400000
            g["sla_days"].append(sla_d)
            if row["ic"] and row["rd"] is not None:
                if row["rd"] <= sla_d:
                    g["met_sla_count"] += 1
                else:
                    g["missed_sla_count"] += 1
            if row["io"] and row["ad"] > sla_d:
                g["open_past_sla_count"] += 1
        if row["rd"] is not None:
            g["resolution_times"].append(row["rd"])

    result = []
    for st, g in groups.items():
        sla_d = round(median(g["sla_days"])) if g["sla_days"] else -1
        res_times = sorted(g["resolution_times"])
        med_res = round(median(res_times), 1) if res_times else 0
        p99_res = round(percentile(res_times, 99), 1) if res_times else 0
        pct_resolved = round(g["closed"] / g["total"] * 100, 1)
        # pct_met_sla denominator is the full request count, not just rows with a due date.
        # Requests without SERVICEDUEDATE are neither missed nor overdue, so they count as met.
        # This intentionally matches the city's published methodology.
        pct_met = round((g["total"] - g["missed_sla_count"] - g["open_past_sla_count"]) / g["total"] * 100, 1)
        result.append({
            "serviceType": st,
            "category": enc.tables["categories"].index(g["category"]),
            "agency": enc.encode("agencies", g["agency"]),
            "sla_days": sla_d,
            "total": g["total"],
            "closed": g["closed"],
            "met_sla_count": g["met_sla_count"],
            "missed_sla_count": g["missed_sla_count"],
            "open_past_sla_count": g["open_past_sla_count"],
            "median_resolution": med_res,
            "p99_resolution": p99_res,
            "pct_resolved": pct_resolved,
            "pct_met_sla": pct_met,
        })
    result.sort(key=lambda x: (enc.tables["categories"][x["category"]], x["sla_days"]))
    return result


def build_explorer_rollup(rows: list[dict], enc: DictEncoder) -> dict:
    """Pre-aggregate explorer chart inputs for a shard."""
    cat_counts: dict[int, dict] = defaultdict(lambda: {"open": 0, "resolved": 0})
    dow_counts: dict[tuple[int, int], int] = defaultdict(int)
    ward_counts: dict[int, dict] = defaultdict(lambda: {"open": 0, "resolved": 0})
    type_counts: dict[int, dict] = defaultdict(lambda: {"open": 0, "resolved": 0})
    weekly: dict[tuple[int, int], int] = defaultdict(int)

    for row in rows:
        c, w, st, dow, wk = row["c"], row["w"], row["st"], row["dow"], row["wk"]
        if row["io"]:
            cat_counts[c]["open"] += 1
            ward_counts[w]["open"] += 1
            type_counts[st]["open"] += 1
        if row["ic"]:
            cat_counts[c]["resolved"] += 1
            ward_counts[w]["resolved"] += 1
            type_counts[st]["resolved"] += 1
        dow_counts[(dow, c)] += 1
        weekly[(wk, c)] += 1

    return {
        "categoryBreakdown": [{"c": c, **v} for c, v in cat_counts.items()],
        "dayOfWeek": [{"dow": d, "c": c, "n": n} for (d, c), n in dow_counts.items()],
        "wardVolume": [{"w": w, **v} for w, v in ward_counts.items()],
        "typeCounts": [{"st": st, **v} for st, v in type_counts.items()],
        "weeklyVolume": [{"wk": wk, "c": c, "n": n} for (wk, c), n in weekly.items()],
    }


def main():
    parser = argparse.ArgumentParser(description="Build dashboard JSON shards from raw CSV.")
    parser.add_argument(
        "--csv",
        type=Path,
        default=None,
        help="Path to raw service requests CSV (default: 365-day canonical, else 90-day)",
    )
    args = parser.parse_args()
    csv_path = (args.csv or DEFAULT_CSV_PATH).resolve()
    if not csv_path.is_file() and args.csv is None:
        csv_path = SHORT_CSV_PATH.resolve()
    if not csv_path.is_file():
        print(f"Error: CSV not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Reading {csv_path}")
    df = pd.read_csv(csv_path, low_memory=False)
    print(f"  {len(df)} rows")

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    enc = DictEncoder()
    enc.tables["ageBuckets"] = AGE_BUCKETS

    # Process all rows, bucket by month.
    monthly: dict[str, list[dict]] = defaultdict(list)
    dropped_ward_count = 0
    for _, row in df.iterrows():
        compact, dropped_for_ward = process_row(row, now_ms, enc)
        if dropped_for_ward:
            dropped_ward_count += 1
        if compact is None:
            continue
        month_key = datetime.fromtimestamp(compact["a"] / 1000, tz=timezone.utc).strftime("%Y-%m")
        monthly[month_key].append(compact)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ROLLUP_DIR.mkdir(parents=True, exist_ok=True)

    shards = []
    total_rows = 0
    for month_key in sorted(monthly.keys()):
        rows = monthly[month_key]
        total_rows += len(rows)

        shard_path = f"{month_key}.json"
        shard_file = OUT_DIR / shard_path
        with open(shard_file, "w") as f:
            json.dump({"month": month_key, "rows": rows}, f, separators=(",", ":"))

        rollup = {
            "month": month_key,
            "sla": build_sla_rollup(rows, enc),
            "explorer": build_explorer_rollup(rows, enc),
        }
        rollup_path = f"rollups/{month_key}.json"
        with open(ROLLUP_DIR / f"{month_key}.json", "w") as f:
            json.dump(rollup, f, separators=(",", ":"))

        add_dates = [r["a"] for r in rows]
        shards.append({
            "id": month_key,
            "file": shard_path,
            "rollupFile": rollup_path,
            "rowCount": len(rows),
            "minDate": min(add_dates),
            "maxDate": max(add_dates),
        })
        print(f"  {month_key}: {len(rows)} rows → {shard_path}")

    version = hashlib.sha256(json.dumps(shards, sort_keys=True).encode()).hexdigest()[:12]
    manifest = {
        "version": version,
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "totalRows": total_rows,
        "shards": shards,
        "dictionaries": dict(enc.tables),
        "categoryMap": CATEGORY_MAP,
        "defaults": {"windowDays": 90},
    }

    with open(OUT_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    if dropped_ward_count:
        print(f"  Warning: {dropped_ward_count} rows dropped (missing or unrecognized WARD value).")
    drop_ratio = dropped_ward_count / max(len(df), 1)
    if drop_ratio > 0.05:
        print(
            f"Error: dropped {dropped_ward_count:,} rows ({drop_ratio:.1%}) for unrecognized WARD. "
            f"Expected values like 'Ward 1' through 'Ward 8'.",
            file=sys.stderr,
        )
        sys.exit(2)
    print(f"\nDone. {total_rows} rows across {len(shards)} shards.")
    print(f"  manifest: {OUT_DIR / 'manifest.json'} (version={version})")


if __name__ == "__main__":
    main()
