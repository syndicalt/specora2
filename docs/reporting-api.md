# Reporting API

Specora reporting is intentionally API-first. The platform should expose governed, RBAC-aware reporting datasets that external analytics tools can consume, rather than trying to clone Tableau, PowerBI, or Grafana inside the product shell.

## Current Surface

Implemented endpoints:

- `GET /api/reports/datasets` lists reportable datasets visible to the caller.
- `GET /api/reports/datasets/:id` returns metadata for one dataset.
- `GET /api/reports/datasets/:id/query` returns rows for a dataset.
- `GET /api/reports/datasets/:id/query?format=csv` returns signed CSV.
- `GET /api/reports/saved` lists the caller's saved report definitions.
- `POST /api/reports/saved` creates or updates a saved report definition.
- `DELETE /api/reports/saved/:id` deletes a saved report definition owned by the caller.

All endpoints require `reporting:read` or `reporting:write`. Dataset access also requires read permission on the underlying application resource, for example `incident-manager:read` for Incident reporting or `audit-log:read` for Audit reporting.

## Query Contract

Shared query parameters:

- `from`: ISO timestamp lower bound. Defaults to 30 days ago.
- `to`: ISO timestamp upper bound. Defaults to now.
- `groupBy`: comma-separated groupable dimension keys, up to three fields.
- `filters`: JSON array of `{ field, operator, value }`.
- `limit`: page size, max 1000.
- `offset`: row offset, max 10000.
- `format`: `json` or `csv`.

Supported filter operators:

- `equals`
- `notEquals`
- `contains`
- `startsWith`
- `endsWith`
- `empty`
- `notEmpty`
- `gt`
- `gte`
- `lt`
- `lte`

CSV exports include signed evidence headers:

- `x-specora-export-digest`
- `x-specora-export-signature`
- `x-specora-export-algorithm`

Report queries and exports are audited as `report.queried` and `report.exported`. Saved report mutations are audited as `report.saved` and `report.deleted`.

## Initial Datasets

Implemented canonical datasets:

- `incidents`
- `changes`
- `requests`
- `knowledge`
- `assets`
- `discovery`
- `audit`

Near-term additions:

- CMDB health and CSDM data quality.
- RBAC/security posture.
- Operational readiness.
- SLA risk and request backlog KPIs.
- Change collision and CAB effectiveness metrics.
- Knowledge freshness, trust, reuse, and deflection metrics.

## Philosophy

Reports should be stable contracts, not screenshots of UI tables. A dataset should declare dimensions, filterable fields, groupable fields, time semantics, RBAC requirements, and export behavior. This lets Specora support first-party dashboards later while still serving enterprise BI tools immediately.
