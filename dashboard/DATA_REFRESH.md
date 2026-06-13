# Dashboard Data Refresh

## Manual refresh

```bash
# Pull last 7 days, audit monthly gaps over the rolling year, backfill missing data
python3 data_refresh.py

# Post-process into dashboard JSON shards + production build
cd dashboard && npm run build
```

`data_refresh.py` maintains `data/raw/service_requests_365days_raw.csv` as the canonical rolling-year store:

1. **Incremental**: fetches recent records (default: 7-day overlap) from year ArcGIS layers and upserts by `SERVICEREQUESTID`
2. **Audit**: compares local vs ArcGIS record counts for each month in the last 365 days
3. **Backfill**: re-pulls any month where local count is missing or below 98% of ArcGIS
4. **Trim**: drops rows older than 365 days and saves the canonical CSV

State is tracked in `data/raw/refresh_state.json`.

### Options

```bash
python3 data_refresh.py --incremental-days 7      # overlap window (default)
python3 data_refresh.py --audit-only              # gap report only, no pulls
python3 data_refresh.py --skip-backfill           # incremental only
python3 data_refresh.py --bootstrap               # force full rolling-year pull
```

On first run, or when the canonical CSV is missing or empty, the script runs a full year-layer pull.

## One-shot pulls

For a full pull without the incremental gap audit:

```bash
python3 query_service_requests.py --days 90
python3 query_service_requests.py --days 365
```

## CI

`.github/workflows/build-and-deploy.yml` deploys to GitHub Pages on push to `main` and on a nightly schedule.

CI runs `query_service_requests.py --days 365` to pull a fresh CSV from ArcGIS, then `npm run build` post-processes it into JSON shards and deploys. The raw CSV is cached daily so repeated pushes within the same day skip the ArcGIS fetch.

CI does **not** run `data_refresh.py`. That script is for local incremental maintenance (gap audit, backfill, rolling-window trim). Use it locally to keep the canonical CSV current; CI always rebuilds from a clean full pull.

## Data availability

See [DATA_AVAILABILITY.md](./DATA_AVAILABILITY.md) for ArcGIS layer details.
