"""
DC 311 Full Dataset Pull
--------------------------
Pulls service requests from DC's 311 ArcGIS FeatureServer and saves to data/raw.

Layer 13 = last 90 days only. For 365-day rolling window, use --days 365 which
pulls from per-calendar-year layers (see dashboard/DATA_AVAILABILITY.md).

Output: data/raw/service_requests_90days_raw.csv (or service_requests_{days}days_raw.csv)
"""

import argparse
import json
import time
import requests
import pandas as pd
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_URL = (
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/"
    "ServiceRequests/FeatureServer/{layer_id}/query"
)

LAYER_LAST_90_DAYS = 13

# Per-calendar-year layers for rolling-window pulls (see DATA_AVAILABILITY.md).
# To find the layer ID for a new year: browse the FeatureServer index at
# https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/ServiceRequests/FeatureServer
# and identify the layer whose name matches the target calendar year.
YEAR_LAYERS = {
    2025: 18,
    2026: 21,
}
DATA_DIR = Path("data/raw")
DATA_DIR.mkdir(parents=True, exist_ok=True)

FIELDS = [
    "SERVICEREQUESTID",
    "ADDDATE",
    "RESOLUTIONDATE",
    "SERVICEDUEDATE",
    "SERVICEORDERDATE",
    "INSPECTIONDATE",
    "CREATED",
    "EDITED",
    "SERVICECODE",
    "SERVICECODEDESCRIPTION",
    "SERVICETYPECODEDESCRIPTION",
    "ORGANIZATIONACRONYM",
    "SERVICEORDERSTATUS",
    "STATUS_CODE",
    "PRIORITY",
    "SERVICECALLCOUNT",
    "INSPECTIONFLAG",
    "INSPECTORNAME",
    "STREETADDRESS",
    "CITY",
    "STATE",
    "ZIPCODE",
    "DETAILS",
    "WARD",
    "LATITUDE",
    "LONGITUDE",
]

DATE_FIELDS = {
    "ADDDATE",
    "RESOLUTIONDATE",
    "SERVICEDUEDATE",
    "SERVICEORDERDATE",
    "INSPECTIONDATE",
    "CREATED",
    "EDITED",
}

PAGE_SIZE = 500
DC_TZ = ZoneInfo("America/New_York")
SLOW_PAGE_SEC = 5.0


def log(msg: str) -> None:
    print(msg, flush=True)


def format_duration(seconds: float) -> str:
    """Human-readable duration for status lines."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes, secs = divmod(int(seconds), 60)
    if minutes < 60:
        return f"{minutes}m {secs}s"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes}m {secs}s"


def format_eta(elapsed: float, done: int, total: int) -> str:
    """Rough ETA from records fetched so far."""
    if done <= 0 or total <= done:
        return '-'
    rate = done / elapsed
    remaining = (total - done) / rate
    return format_duration(remaining)


def write_checkpoint(path: Path, payload: dict) -> None:
    """Persist pull state so a stalled run is diagnosable."""
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def rolling_window_bounds(days: int) -> tuple[datetime, datetime]:
    """Inclusive start, exclusive end at today's midnight in DC."""
    now_dc = datetime.now(DC_TZ)
    end_dc = now_dc.replace(hour=0, minute=0, second=0, microsecond=0)
    start_dc = end_dc - timedelta(days=days)
    return start_dc, end_dc


def count_records(layer_id: int, where: str) -> int:
    """Return ArcGIS feature count for a layer and WHERE clause."""
    url = BASE_URL.format(layer_id=layer_id)
    resp = requests.get(
        url,
        params={"where": where, "returnCountOnly": "true", "f": "json"},
        timeout=60,
    )
    resp.raise_for_status()
    body = resp.json()
    if "error" in body:
        raise RuntimeError(f"Count query failed: {body['error']}")
    return int(body.get("count", 0))


def layer_for_year(year: int) -> int:
    """Map calendar year to ArcGIS layer id.

    Raises:
        KeyError: If the year is not in YEAR_LAYERS. Add the new year's layer ID
            by checking the FeatureServer index URL in the YEAR_LAYERS comment above.
    """
    if year not in YEAR_LAYERS:
        raise KeyError(
            f"No ArcGIS layer configured for year {year}. "
            f"Add it to YEAR_LAYERS (see comment above). "
            f"Known years: {sorted(YEAR_LAYERS)}"
        )
    return YEAR_LAYERS[year]


def date_range_where(start_dc: datetime, end_dc: datetime) -> str:
    """ArcGIS WHERE clause for ADDDATE in [start, end)."""
    start_str = start_dc.strftime("%Y-%m-%d %H:%M:%S")
    end_str = end_dc.strftime("%Y-%m-%d %H:%M:%S")
    return f"ADDDATE >= DATE '{start_str}' AND ADDDATE < DATE '{end_str}'"


def rolling_window_where(days: int) -> str:
    """ArcGIS WHERE clause for ADDDATE in [start, end)."""
    start_dc, end_dc = rolling_window_bounds(days)
    return date_range_where(start_dc, end_dc)


def epoch_ms_to_dt(ms):
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime(
        "%Y-%m-%d %H:%M:%S UTC"
    )


def fetch_all(
    layer_id: int,
    where: str,
    *,
    checkpoint_path: Path | None = None,
    checkpoint_every_pages: int = 10,
    layer_label: str = "",
) -> list[dict]:
    """Paginate through all records matching `where` on `layer_id`."""
    url = BASE_URL.format(layer_id=layer_id)
    records: list[dict] = []
    offset = 0
    layer_started = time.monotonic()
    page_num = 0
    slow_pages = 0

    log(f"  [{layer_label}] Counting records…")
    count_started = time.monotonic()
    count_resp = requests.get(
        url,
        params={
            "where": where,
            "returnCountOnly": "true",
            "f": "json",
        },
        timeout=60,
    )
    count_resp.raise_for_status()
    count_body = count_resp.json()
    if "error" in count_body:
        raise RuntimeError(f"Count query failed: {count_body['error']}")
    total = count_body.get("count", 0)
    count_elapsed = time.monotonic() - count_started
    log(
        f"  [{layer_label}] Total records: {total:,} "
        f"(count query {format_duration(count_elapsed)})"
    )

    if checkpoint_path:
        write_checkpoint(checkpoint_path, {
            "phase": "count_complete",
            "layer_id": layer_id,
            "layer_label": layer_label,
            "where": where,
            "total": total,
            "offset": 0,
            "records_fetched": 0,
            "elapsed_sec": round(time.monotonic() - layer_started, 1),
        })

    if total == 0:
        return []

    total_pages = (total + PAGE_SIZE - 1) // PAGE_SIZE
    log(
        f"  [{layer_label}] Fetching {total_pages:,} pages "
        f"({PAGE_SIZE} records/page)…"
    )

    while offset < total:
        page_num += 1
        page_started = time.monotonic()
        resp = requests.get(
            url,
            params={
                "where": where,
                "outFields": ",".join(FIELDS),
                "returnGeometry": "false",
                "resultRecordCount": PAGE_SIZE,
                "resultOffset": offset,
                "orderByFields": "ADDDATE DESC",
                "f": "json",
            },
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            raise RuntimeError(
                f"Page {page_num} failed at offset {offset}: {data['error']}"
            )

        features = data.get("features", [])
        if not features:
            log(f"  [{layer_label}] Empty page at offset {offset}; stopping early.")
            break

        for feature in features:
            attrs = feature["attributes"]
            for field in DATE_FIELDS:
                if field in attrs:
                    attrs[field] = epoch_ms_to_dt(attrs.get(field))
            records.append(attrs)

        offset += len(features)
        page_elapsed = time.monotonic() - page_started
        layer_elapsed = time.monotonic() - layer_started
        if page_elapsed >= SLOW_PAGE_SEC:
            slow_pages += 1

        should_log = (
            page_num == 1
            or page_num % checkpoint_every_pages == 0
            or offset >= total
        )
        if should_log:
            pct = (offset / total) * 100 if total else 100.0
            rate = offset / layer_elapsed if layer_elapsed > 0 else 0.0
            log(
                f"  [{layer_label}] Page {page_num}/{total_pages} | "
                f"{offset:,}/{total:,} ({pct:.1f}%) | "
                f"page {page_elapsed:.2f}s | "
                f"elapsed {format_duration(layer_elapsed)} | "
                f"ETA {format_eta(layer_elapsed, offset, total)} | "
                f"{rate:.0f} rec/s"
            )
            if page_elapsed >= SLOW_PAGE_SEC:
                log(
                    f"  [{layer_label}] ⚠ slow page ({page_elapsed:.1f}s) "
                    f"at offset {offset - len(features):,}"
                )

        if checkpoint_path and should_log:
            write_checkpoint(checkpoint_path, {
                "phase": "fetching",
                "layer_id": layer_id,
                "layer_label": layer_label,
                "where": where,
                "total": total,
                "offset": offset,
                "page": page_num,
                "total_pages": total_pages,
                "records_fetched": len(records),
                "elapsed_sec": round(layer_elapsed, 1),
                "records_per_sec": round(rate, 1),
                "slow_pages": slow_pages,
                "last_page_sec": round(page_elapsed, 2),
            })

    layer_elapsed = time.monotonic() - layer_started
    rate = len(records) / layer_elapsed if layer_elapsed > 0 else 0.0
    log(
        f"  [{layer_label}] Done: {len(records):,} records in "
        f"{format_duration(layer_elapsed)} ({rate:.0f} rec/s, "
        f"{slow_pages} slow pages)"
    )

    if checkpoint_path:
        write_checkpoint(checkpoint_path, {
            "phase": "layer_complete",
            "layer_id": layer_id,
            "layer_label": layer_label,
            "total": total,
            "records_fetched": len(records),
            "elapsed_sec": round(layer_elapsed, 1),
            "records_per_sec": round(rate, 1),
            "slow_pages": slow_pages,
        })

    return records


def save_csv(records: list[dict], filename: str) -> pd.DataFrame:
    """Write final CSV and report size."""
    started = time.monotonic()
    df = pd.DataFrame(records, columns=FIELDS)
    output_path = DATA_DIR / filename
    df.to_csv(output_path, index=False)
    elapsed = time.monotonic() - started
    size_mb = output_path.stat().st_size / (1024 * 1024)
    log(
        f"  Saved {len(df):,} rows → {output_path} "
        f"({size_mb:.1f} MB, {format_duration(elapsed)})"
    )
    return df


def fetch_year_range(
    days: int,
    *,
    checkpoint_path: Path,
    checkpoint_every_pages: int,
) -> list[dict]:
    """Pull a rolling window from per-year ArcGIS layers."""
    start_dc, end_dc = rolling_window_bounds(days)
    where = rolling_window_where(days)
    log(
        f"  Window: {start_dc:%Y-%m-%d %H:%M %Z} → "
        f"{end_dc:%Y-%m-%d %H:%M %Z} (exclusive end)"
    )

    seen: set[str] = set()
    records: list[dict] = []
    dupes = 0
    range_started = time.monotonic()

    for year, layer_id in sorted(YEAR_LAYERS.items()):
        layer_label = f"layer {layer_id} ({year})"
        log(f"\n  ── {layer_label} ──")
        log(f"  where: {where}")
        year_records = fetch_all(
            layer_id,
            where=where,
            checkpoint_path=checkpoint_path,
            checkpoint_every_pages=checkpoint_every_pages,
            layer_label=layer_label,
        )
        layer_new = 0
        for row in year_records:
            req_id = row.get("SERVICEREQUESTID")
            if req_id in seen:
                dupes += 1
                continue
            seen.add(req_id)
            records.append(row)
            layer_new += 1
        log(
            f"  [{layer_label}] Added {layer_new:,} unique rows "
            f"({dupes:,} cross-layer dupes skipped so far)"
        )

    range_elapsed = time.monotonic() - range_started
    log(
        f"\n  Year layers merged: {len(records):,} unique rows in "
        f"{format_duration(range_elapsed)} ({dupes:,} dupes removed)"
    )
    write_checkpoint(checkpoint_path, {
        "phase": "merge_complete",
        "unique_records": len(records),
        "duplicates_skipped": dupes,
        "elapsed_sec": round(range_elapsed, 1),
    })
    return records


def main():
    parser = argparse.ArgumentParser(description="Pull DC 311 service requests from ArcGIS")
    parser.add_argument(
        "--days",
        type=int,
        default=90,
        help="Rolling window in days (90=layer 13, 365=year layers)",
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=10,
        help="Log and write checkpoint every N pages (default: 10)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output CSV filename under data/raw (default: service_requests_{days}days_raw.csv)",
    )
    parser.add_argument(
        "--checkpoint",
        type=str,
        default=None,
        help="Checkpoint JSON filename under data/raw (default: pull_checkpoint_{days}d.json)",
    )
    args = parser.parse_args()

    run_started = time.monotonic()
    checkpoint_path = DATA_DIR / (args.checkpoint or f"pull_checkpoint_{args.days}d.json")
    filename = args.output or f"service_requests_{args.days}days_raw.csv"

    log("=" * 60)
    if args.days <= 90:
        log(f"DC 311 Dataset Pull: Last {args.days} Days (Layer 13)")
    else:
        log(f"DC 311 Dataset Pull: Last {args.days} Days (Year Layers)")
    log(f"Checkpoint file: {checkpoint_path}")
    log(f"Status updates every {args.checkpoint_every} pages")
    log("=" * 60)

    write_checkpoint(checkpoint_path, {
        "phase": "started",
        "days": args.days,
        "filename": filename,
        "page_size": PAGE_SIZE,
        "checkpoint_every_pages": args.checkpoint_every,
    })

    if args.days <= 90:
        log("\n[1/2] Pulling service requests from layer 13…")
        all_records = fetch_all(
            LAYER_LAST_90_DAYS,
            where="1=1",
            checkpoint_path=checkpoint_path,
            checkpoint_every_pages=args.checkpoint_every,
            layer_label="layer 13 (90-day)",
        )
    else:
        log("\n[1/2] Pulling service requests from year layers…")
        all_records = fetch_year_range(
            args.days,
            checkpoint_path=checkpoint_path,
            checkpoint_every_pages=args.checkpoint_every,
        )

    log("\n[2/2] Writing CSV…")
    write_checkpoint(checkpoint_path, {
        "phase": "saving_csv",
        "records": len(all_records),
    })
    df = save_csv(all_records, filename)

    if not df.empty:
        log("\n  Service type breakdown (top 10):")
        log(
            df["SERVICECODEDESCRIPTION"]
            .value_counts()
            .head(10)
            .rename_axis("Service Type")
            .reset_index(name="Count")
            .to_string(index=False)
        )
        log("\n  Ward breakdown:")
        log(
            df["WARD"]
            .value_counts()
            .rename_axis("Ward")
            .reset_index(name="Count")
            .to_string(index=False)
        )
        log("\n  5 most recent records:")
        log(
            df[["SERVICEREQUESTID", "ADDDATE", "SERVICECODEDESCRIPTION", "STREETADDRESS", "WARD"]]
            .head(5)
            .to_string(index=False)
        )

    total_elapsed = time.monotonic() - run_started
    write_checkpoint(checkpoint_path, {
        "phase": "complete",
        "records": len(df),
        "output": str(DATA_DIR / filename),
        "total_elapsed_sec": round(total_elapsed, 1),
    })

    log("\n" + "=" * 60)
    log(f"Done in {format_duration(total_elapsed)}")
    log(f"Output: {DATA_DIR / filename}")
    log(f"Checkpoint: {checkpoint_path}")
    log("=" * 60)


if __name__ == "__main__":
    main()
