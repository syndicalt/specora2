# Reporting API

Specora reporting is intentionally API-first. The platform should expose governed, RBAC-aware reporting datasets that external analytics tools can consume, rather than trying to clone Tableau, PowerBI, or Grafana inside the product shell.

## Current Surface

Implemented endpoints:

- `GET /api/reports/datasets` lists reportable datasets visible to the caller.
- `GET /api/reports/datasets/:id` returns metadata for one dataset.
- `GET /api/reports/datasets/:id/query` returns rows for a dataset.
- `GET /api/reports/datasets/:id/query?format=csv` returns signed CSV.
- `GET /api/reports/kpis` returns RBAC-aware KPI summaries for visible reporting domains.
- `GET /api/reports/kpis/:id` returns one KPI summary.
- `GET /api/reports/contracts/:target` returns BI/warehouse integration contracts for `grafana`, `powerbi`, `tableau`, or `warehouse`.
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

## KPI Surface

Implemented KPI IDs:

- `sla_risk`
- `incident_deflection`
- `change_collision_risk`
- `knowledge_freshness`
- `request_backlog`
- `cmdb_completeness`
- `audit_security_posture`

Each KPI response includes `value`, `unit`, `status`, `direction`, `window`, and supporting `details`. KPI visibility is governed by `reporting:read` plus the underlying resource permissions required by that KPI.

## BI Integration Patterns

Recommended external dashboard shape:

- Executive overview: `GET /api/reports/kpis` for SLA risk, deflection, change risk, request backlog, CMDB completeness, and audit posture.
- Incident operations: `incidents` grouped by `status`, `severity`, `priority`, `service`, and `assignment_group`.
- Change governance: `changes` grouped by `status`, `ci_id`, and scheduled windows, paired with `change_collision_risk`.
- Knowledge health: `knowledge` grouped by `status`, `type`, and `service`, paired with `knowledge_freshness`.
- Audit/security: `audit` grouped by `action`, `entity_type`, and `actor_id`, paired with `audit_security_posture`.
- Data quality: `cmdb_completeness` plus `assets`, `discovery`, and future CMDB health datasets.

Grafana should use the `grafana` contract and JSON query endpoints with dashboard time range mapped to `from`/`to`. PowerBI and Tableau should use the `powerbi` or `tableau` contract and prefer signed CSV extracts for scheduled refreshes. Warehouse loaders should use the `warehouse` contract with `limit`/`offset` pagination and `from`/`to` watermarks.

## Native App

Specora includes a lightweight Reporting native app that consumes these APIs directly and focuses on operational visibility, not full BI authoring:

- KPI cards from `/api/reports/kpis`.
- Dataset picker and metadata inspection.
- Saved report list and basic table/chart preview.
- CSV export action.
- BI contract copy/download links for Grafana, PowerBI, Tableau, and warehouse loaders.

Near-term additions:

- CMDB health and CSDM data quality.
- RBAC/security posture.
- Operational readiness.
- CAB effectiveness metrics.
- Knowledge trust and reuse metrics.

## Philosophy

Reports should be stable contracts, not screenshots of UI tables. A dataset should declare dimensions, filterable fields, groupable fields, time semantics, RBAC requirements, and export behavior. This lets Specora support first-party dashboards later while still serving enterprise BI tools immediately.
