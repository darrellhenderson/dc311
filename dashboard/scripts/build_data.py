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
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
from category_rules import (  # noqa: E402
    CATEGORY_MAP,
    OPEN_STATUSES,
    WARD_ORDER,
    is_excluded_service_type,
)

DEFAULT_CSV_PATH = REPO_ROOT / "data/raw/service_requests_365days_raw.csv"
SHORT_CSV_PATH = REPO_ROOT / "data/raw/service_requests_90days_raw.csv"
OUT_DIR = Path(__file__).resolve().parents[1] / "public" / "data"
ROLLUP_DIR = OUT_DIR / "rollups"

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
AGE_BUCKETS = ["< 1 week", "1–4 weeks", "1–2 months", "2–3 months"]

# Only columns needed for the dashboard build — skips unused CSV fields on read.
CSV_COLS = [
    "SERVICEREQUESTID", "ADDDATE", "RESOLUTIONDATE", "SERVICEDUEDATE",
    "SERVICECODE", "SERVICECODEDESCRIPTION", "SERVICETYPECODEDESCRIPTION",
    "ORGANIZATIONACRONYM", "SERVICEORDERSTATUS", "PRIORITY",
    "STREETADDRESS", "CITY", "STATE", "ZIPCODE", "DETAILS", "WARD",
    "LATITUDE", "LONGITUDE",
]


# ---------------------------------------------------------------------------
# Dictionary encoder (string → integer index, accumulated globally)
# ---------------------------------------------------------------------------

class DictEncoder:
    """Assigns integer indices to repeated strings."""

    def __init__(self):
        self.tables: dict[str, list[str]] = defaultdict(list)
        self._lookup: dict[str, dict[str, int]] = defaultdict(dict)

    def encode(self, table: str, value: str | None) -> int | None:
        if value is None or value == "":
            return None
        lut = self._lookup[table]
        if value not in lut:
            idx = len(self.tables[table])
            self.tables[table].append(value)
            lut[value] = idx
        return lut[value]

    def factorize(self, table: str, series: pd.Series) -> np.ndarray:
        """Encode a string column to int32 indices via pd.factorize (C-speed)."""
        s = series.fillna("").astype(str)
        s = s.mask(s.isin(("", "nan")), other=np.nan)
        codes, uniques = pd.factorize(s, sort=False, use_na_sentinel=True)
        self.tables[table] = [str(u) for u in uniques if pd.notna(u)]
        out = codes.astype(np.float64)
        out[codes < 0] = np.nan
        return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


def age_bucket_vec_np(age_days: np.ndarray) -> np.ndarray:
    """Vectorised age-bucket assignment: 0–3."""
    buckets = np.full(len(age_days), 3, dtype=np.int8)
    buckets[age_days < 60] = 2
    buckets[age_days < 30] = 1
    buckets[age_days < 7] = 0
    return buckets


def parse_dates_ms(series: pd.Series) -> np.ndarray:
    """Parse UTC date strings to epoch-ms float64 (NaN where missing)."""
    parsed = pd.to_datetime(
        series.str.replace(" UTC", "", regex=False),
        format="%Y-%m-%d %H:%M:%S",
        errors="coerce",
        utc=True,
    )
    out = np.full(len(parsed), np.nan, dtype=np.float64)
    ok = parsed.notna()
    out[ok] = parsed[ok].astype("int64") // 1_000_000
    return out


def build_compact_df(df: pd.DataFrame, enc: DictEncoder) -> pd.DataFrame:
    """Transform raw CSV rows into compact encoded rows using vectorised ops."""
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    # --- Single-pass filter: ward, date, excluded service types ---
    add_dt = pd.to_datetime(
        df["ADDDATE"].str.replace(" UTC", "", regex=False),
        format="%Y-%m-%d %H:%M:%S",
        errors="coerce",
        utc=True,
    )
    svc = df["SERVICECODEDESCRIPTION"].fillna("").astype(str)
    mask = (
        df["WARD"].isin(WARD_ORDER)
        & add_dt.notna()
        & ~svc.isin({"Test", "Sample SR"})
    )
    df = df.loc[mask].reset_index(drop=True)
    add_dt = add_dt.loc[mask].reset_index(drop=True)
    svc = svc.loc[mask].reset_index(drop=True)

    add_ms = (add_dt.astype("int64") // 1_000_000).values
    res_ms = parse_dates_ms(df["RESOLUTIONDATE"])
    due_ms = parse_dates_ms(df["SERVICEDUEDATE"])

    status = df["SERVICEORDERSTATUS"].fillna("").astype(str)
    is_open = status.isin(OPEN_STATUSES).astype(np.int8).values
    is_closed = status.str.startswith("Closed").astype(np.int8).values

    age_days = ((now_ms - add_ms) / 86_400_000).astype(np.int32)
    resolution_days = np.where(
        (is_closed == 1) & ~np.isnan(res_ms),
        np.round((res_ms - add_ms) / 86_400_000, 2),
        np.nan,
    ).astype(np.float64)

    hour = add_dt.dt.hour.to_numpy(dtype=np.int8)
    dow_int = add_dt.dt.dayofweek.to_numpy(dtype=np.int8)
    week_ms = (
        (add_dt.dt.normalize() - pd.to_timedelta(add_dt.dt.dayofweek, unit="D"))
        .astype("int64") // 1_000_000
    ).to_numpy(dtype=np.int64)

    cat_series = svc.map(CATEGORY_MAP).fillna("Other")
    dow_labels = pd.Series(np.array(DAY_NAMES)[dow_int])

    svc_idx = enc.factorize("serviceTypes", svc)
    agency_idx = enc.factorize("agencies", df["ORGANIZATIONACRONYM"])
    status_idx = enc.factorize("statuses", status)
    ward_idx = enc.factorize("wards", df["WARD"])
    cat_idx = enc.factorize("categories", cat_series)
    dow_idx = enc.factorize("dayOfWeek", dow_labels)
    zip_idx = enc.factorize("zipcodes", df["ZIPCODE"])
    city_idx = enc.factorize("cities", df["CITY"])
    state_idx = enc.factorize("states", df["STATE"])
    stc_idx = enc.factorize("serviceTypeCodes", df["SERVICETYPECODEDESCRIPTION"])

    sc_numeric = pd.to_numeric(df["SERVICECODE"], errors="coerce").to_numpy(dtype=np.float64)
    sc_nan = np.isnan(sc_numeric)
    if sc_nan.any():
        sc_codes = enc.factorize("serviceCodes", df["SERVICECODE"].where(sc_nan))
        sc_numeric[sc_nan] = sc_codes[sc_nan]

    pri_numeric = pd.to_numeric(df["PRIORITY"], errors="coerce").to_numpy(dtype=np.float64)
    pri_nan = np.isnan(pri_numeric)
    if pri_nan.any():
        pri_codes = enc.factorize("priorities", df["PRIORITY"].where(pri_nan))
        pri_numeric[pri_nan] = pri_codes[pri_nan]

    return pd.DataFrame({
        "id": df["SERVICEREQUESTID"].fillna("").astype(str).to_numpy(),
        "a": add_ms.astype(np.int64),
        "r": res_ms,
        "dd": due_ms,
        "st": svc_idx.astype(np.int32),
        "ag": agency_idx,
        "ss": status_idx.astype(np.int32),
        "w": ward_idx.astype(np.int32),
        "c": cat_idx.astype(np.int32),
        "lat": pd.to_numeric(df["LATITUDE"], errors="coerce").to_numpy(dtype=np.float64),
        "lng": pd.to_numeric(df["LONGITUDE"], errors="coerce").to_numpy(dtype=np.float64),
        "io": is_open,
        "ic": is_closed,
        "ad": age_days,
        "rd": resolution_days,
        "h": hour,
        "dow": dow_idx.astype(np.int32),
        "wk": week_ms,
        "ab": age_bucket_vec_np(age_days),
        "addr": df["STREETADDRESS"].fillna("").astype(str).to_numpy(),
        "det": df["DETAILS"].fillna("").astype(str).to_numpy(),
        "zip": zip_idx,
        "city": city_idx,
        "state": state_idx,
        "sc": sc_numeric,
        "pri": pri_numeric,
        "stc": stc_idx,
        "_month": add_dt.dt.strftime("%Y-%m").to_numpy(),
    })


# ---------------------------------------------------------------------------
# Rollup builders (operate on lists of dicts — same logic as before)
# ---------------------------------------------------------------------------

def build_sla_rollup(rows: list[dict], enc: DictEncoder) -> list[dict]:
    """Pre-aggregate SLA table rows for a shard."""
    groups: dict[int, dict] = {}
    for row in rows:
        st = row["st"]
        if st not in groups:
            ag = row["ag"]
            ag_valid = ag is not None and not (isinstance(ag, float) and math.isnan(ag))
            groups[st] = {
                "category": enc.tables["categories"][int(row["c"])],
                "agency": enc.tables["agencies"][int(ag)] if ag_valid else "",
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
        dd = row["dd"]
        rd = row["rd"]
        if dd is not None and not (isinstance(dd, float) and math.isnan(dd)):
            sla_d = (dd - row["a"]) / 86_400_000
            g["sla_days"].append(sla_d)
            if row["ic"] and rd is not None and not (isinstance(rd, float) and math.isnan(rd)):
                if rd <= sla_d:
                    g["met_sla_count"] += 1
                else:
                    g["missed_sla_count"] += 1
            if row["io"] and row["ad"] > sla_d:
                g["open_past_sla_count"] += 1
        if rd is not None and not (isinstance(rd, float) and math.isnan(rd)):
            g["resolution_times"].append(rd)

    result = []
    for st, g in groups.items():
        sla_d = round(median(g["sla_days"])) if g["sla_days"] else -1
        res_times = sorted(g["resolution_times"])
        med_res = round(median(res_times), 1) if res_times else 0
        p99_res = round(percentile(res_times, 99), 1) if res_times else 0
        pct_resolved = round(g["closed"] / g["total"] * 100, 1)
        pct_met = round(
            (g["total"] - g["missed_sla_count"] - g["open_past_sla_count"]) / g["total"] * 100, 1
        )
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
    result.sort(key=lambda x: (enc.tables["categories"][int(x["category"])], x["sla_days"]))
    return result


def _estimate_row_from_group(group_df: pd.DataFrame, st: int, w: int | None, min_n: int) -> dict | None:
    """Build one manifest estimate row from a service-type (and optional ward) slice."""
    closed = group_df[(group_df["ic"] == 1) & group_df["rd"].notna()]
    n_closed = len(closed)
    if n_closed < min_n:
        return None

    res_times = sorted(closed["rd"].tolist())
    total = len(group_df)
    missed = 0
    open_past = 0
    sla_days_list: list[float] = []

    for row in group_df.itertuples(index=False):
        dd = row.dd
        if dd is None or (isinstance(dd, float) and math.isnan(dd)):
            continue
        sla_d = (dd - row.a) / 86_400_000
        sla_days_list.append(sla_d)
        rd = row.rd
        if row.ic == 1 and rd is not None and not (isinstance(rd, float) and math.isnan(rd)):
            if rd > sla_d:
                missed += 1
        if row.io == 1 and row.ad > sla_d:
            open_past += 1

    pct_met = round((total - missed - open_past) / total * 100, 1) if total > 0 else 0.0
    sla_d = round(median(sla_days_list)) if sla_days_list else -1

    return {
        "st": int(st),
        "w": w,
        "n": n_closed,
        "p25": round(percentile(res_times, 25), 1),
        "p50": round(percentile(res_times, 50), 1),
        "p75": round(percentile(res_times, 75), 1),
        "p90": round(percentile(res_times, 90), 1),
        "p95": round(percentile(res_times, 95), 1),
        "sla_days": sla_d,
        "pct_met_sla": pct_met,
    }


# Keep in sync with estimateData.ts: CITYWIDE_MIN_SAMPLE, WARD_MIN_SAMPLE
CITYWIDE_ESTIMATE_MIN_N = 10
WARD_ESTIMATE_MIN_N = 30


def build_estimate_data(
    compact_df: pd.DataFrame,
    citywide_min_n: int = CITYWIDE_ESTIMATE_MIN_N,
    ward_min_n: int = WARD_ESTIMATE_MIN_N,
) -> list[dict]:
    """Pre-aggregate response-time percentiles for the Estimate tab (full dataset)."""
    rows: list[dict] = []
    for st, group in compact_df.groupby("st", sort=False):
        row = _estimate_row_from_group(group, int(st), None, citywide_min_n)
        if row is not None:
            rows.append(row)
    for (st, w), group in compact_df.groupby(["st", "w"], sort=False):
        row = _estimate_row_from_group(group, int(st), int(w), ward_min_n)
        if row is not None:
            rows.append(row)
    rows.sort(key=lambda r: (r["st"], -1 if r["w"] is None else r["w"]))
    return rows


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


def write_shard(month_key: str, group: pd.DataFrame, path: Path) -> None:
    """Write a monthly shard JSON file using pandas to_json (faster than to_dict)."""
    rows_json = group.drop(columns="_month").to_json(orient="records")
    path.write_text(f'{{"month":"{month_key}","rows":{rows_json}}}', encoding="utf-8")


def month_rows_for_rollups(group: pd.DataFrame) -> list[dict]:
    """Convert one month's compact rows to dicts for rollup builders."""
    g = group.drop(columns="_month")
    for col in ("st", "w", "c", "ss", "dow", "io", "ic", "ad", "h", "ab", "a", "wk"):
        if col in g.columns:
            g[col] = g[col].astype(np.int64)
    return json.loads(g.to_json(orient="records", date_format="epoch"))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Build dashboard JSON shards from raw CSV.")
    parser.add_argument(
        "--csv",
        type=Path,
        default=None,
        help="Path to raw service requests CSV",
    )
    args = parser.parse_args()
    csv_path = (args.csv or DEFAULT_CSV_PATH).resolve()
    if not csv_path.is_file() and args.csv is None:
        csv_path = SHORT_CSV_PATH.resolve()
    if not csv_path.is_file():
        print(f"Error: CSV not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Reading {csv_path}")
    t0 = time.monotonic()
    df = pd.read_csv(csv_path, usecols=CSV_COLS, low_memory=False)
    print(f"  {len(df):,} rows ({time.monotonic() - t0:.1f}s)")

    n_raw = len(df)
    dropped_ward_count = n_raw - int(df["WARD"].isin(WARD_ORDER).sum())

    enc = DictEncoder()
    enc.tables["ageBuckets"] = AGE_BUCKETS

    print("  Transforming…")
    t0 = time.monotonic()
    compact_df = build_compact_df(df, enc)
    print(f"  {len(compact_df):,} rows after filtering ({time.monotonic() - t0:.1f}s)")

    print("  Building estimate data…")
    t0 = time.monotonic()
    estimates = build_estimate_data(compact_df)
    print(f"  {len(estimates):,} estimate rows ({time.monotonic() - t0:.1f}s)")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ROLLUP_DIR.mkdir(parents=True, exist_ok=True)

    shards = []
    total_rows = 0

    print("  Writing shards…")
    t0 = time.monotonic()
    for month_key, group in compact_df.groupby("_month", sort=True):
        rows = month_rows_for_rollups(group)
        total_rows += len(rows)

        shard_path = f"{month_key}.json"
        write_shard(month_key, group, OUT_DIR / shard_path)

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
        print(f"  {month_key}: {len(rows):,} rows → {shard_path}")
    print(f"  Shards written ({time.monotonic() - t0:.1f}s)")

    version = hashlib.sha256(json.dumps(shards, sort_keys=True).encode()).hexdigest()[:12]
    manifest = {
        "version": version,
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "totalRows": total_rows,
        "shards": shards,
        "dictionaries": dict(enc.tables),
        "categoryMap": CATEGORY_MAP,
        "defaults": {"windowDays": 90},
        "estimates": estimates,
    }
    with open(OUT_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    if dropped_ward_count:
        print(f"  Warning: {dropped_ward_count:,} rows dropped (missing or unrecognized WARD value).")
    drop_ratio = dropped_ward_count / max(n_raw, 1)
    if drop_ratio > 0.05:
        print(
            f"Error: dropped {dropped_ward_count:,} rows ({drop_ratio:.1%}) for unrecognized WARD. "
            f"Expected values like 'Ward 1' through 'Ward 8'.",
            file=sys.stderr,
        )
        sys.exit(2)
    print(f"\nDone. {total_rows:,} rows across {len(shards)} shards.")
    print(f"  manifest: {OUT_DIR / 'manifest.json'} (version={version})")


if __name__ == "__main__":
    main()
