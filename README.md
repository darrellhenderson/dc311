# 311: DC's To-Do List

DC assigns a deadline to every 311 service request it receives. This project measures how often the city meets those deadlines, across ~465,000 requests filed over twelve months.

The citywide compliance rate tells one story. Break it down by category, ward, and service type and the picture changes: most categories sit short of the 99% target, and a handful slip below 95% — where failure becomes perceptible enough that residents start to notice. Ward-level resolution spreads are wide enough that a citywide average hides real geographic inequity.

Built from DC Open Data (ArcGIS) and refreshed nightly via GitHub Actions.

## Quick start

JSON shards are not committed; build them first from the ArcGIS source, then start the dev server.

```bash
pip install -r requirements.txt
python3 query_service_requests.py --days 365  # ~5–10 minutes; pulls ~465K rows
cd dashboard
npm install
npm run dev
```

Open http://localhost:3000

The `npm run dev` prebuild step (`scripts/prebuild_data.py`) detects the CSV and generates `dashboard/public/data/` automatically. For subsequent dev sessions, shards are already on disk; skip the Python steps.

## Data pipeline

The Python pipeline pulls 311 requests from DC's ArcGIS endpoint, groups them into categories, audits for gaps in the rolling year, and rebuilds compact JSON shards and rollups for the browser.

```bash
python3 data_refresh.py
cd dashboard && npm run build
```

See [dashboard/DATA_REFRESH.md](dashboard/DATA_REFRESH.md) for details.

## Project layout

| Path | Purpose |
|------|---------|
| `data_refresh.py` | Pull from ArcGIS, gap audit, backfill |
| `query_service_requests.py` | One-shot ArcGIS pulls (90-day or full year) |
| `category_rules.py` | Category and status classification rules |
| `data/raw/` | Canonical CSV and refresh state |
| `dashboard/` | React app (Vite + TypeScript + Plotly) |
| `dashboard/scripts/prebuild_data.py` | npm pre-build/dev hook: rebuild shards if CSV is newer |
| `dashboard/scripts/build_data.py` | CSV → JSON shards + rollups |
| `dashboard/public/data/` | Runtime data loaded by the browser |

## Deploy

GitHub Actions (`.github/workflows/build-and-deploy.yml`) builds and deploys to GitHub Pages on push to `main`. Set repository variables `VITE_BASE_PATH` and `VITE_GITHUB_REPO_URL` as needed.

```bash
cd dashboard
npm run build
```

Output is in `dashboard/dist/`.

## Data

**Source:** [DC Open Data: 311 City Service Requests](https://opendata.dc.gov/datasets/DCGIS::all-311-city-service-requests-last-30-days/about)  
**Provider:** District of Columbia, Office of the Chief Technology Officer (OCTO)  
**License:** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)

The source data has been filtered (by ward and service type), categorized, and aggregated into compact monthly shards for this analysis. No original records are redistributed; the raw CSV is excluded from this repository via `.gitignore`.

## Contributing

Open an issue before submitting a PR. Keep changes focused. Run `npm test` from the `dashboard/` directory before committing.
