# ArcGIS Layer Reference

ArcGIS FeatureServer: `DCGIS_DATA/ServiceRequests/FeatureServer`

| Layer | Name | Approx. record count |
|-------|------|----------------------|
| 13 | Last 90 Days | ~125,000 |
| 18 | 2025 | ~440,000 |
| 21 | 2026 | ~225,000 |
| 19 | Current Fiscal Year | ~316,000 |

**Layer 13 cannot serve a rolling 365-day window.** A `WHERE ADDDATE >= <epoch>` filter on layer 13 returns 0 records outside the 90-day window baked into that layer.

## Rolling 365-day window strategy

Pull from per-calendar-year layers with date filters:

1. Current year layer (21 for 2026): `ADDDATE >= <365 days ago>`
2. Previous year layer (18 for 2025): `ADDDATE >= <365 days ago>` (tail of prior year only)

`query_service_requests.py --days 365` implements this. Layer IDs for new years must be added to `YEAR_LAYERS` in `query_service_requests.py`; browse the [FeatureServer index](https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/ServiceRequests/FeatureServer) to find the ID for a given calendar year.
