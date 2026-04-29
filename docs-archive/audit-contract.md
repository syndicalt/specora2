# Audit Contract

**Status:** Implemented platform contract for server-side mutation audit events and tamper-evident audit integrity
**Last updated:** 2026-04-27

Specora audit records exist to answer five operational questions:

- Who initiated a change?
- What changed?
- Which platform surface performed it?
- Did the operation succeed, fail, queue, or get denied?
- Which entity should an admin or automation workflow inspect next?

The audit log is not a replacement for application events, job records, or telemetry. It is the durable accountability trail for security-sensitive and operationally meaningful mutations.

## Storage

Audit events are stored in PostgreSQL `audit_log`.

| Column | Meaning |
| --- | --- |
| `id` | Audit row UUID |
| `actor_id` | User UUID when known and valid; `null` for system or non-UUID actors |
| `action` | Canonical action name |
| `entity_type` | Stable target type, for example `ConfigurationItem`, `AppInstallation`, `Incident` |
| `entity_id` | Target record or object identifier |
| `old_values` | JSON snapshot before the mutation when available |
| `new_values` | JSON snapshot after the mutation, queued job, or result summary |
| `metadata` | JSON context: source route, app, tool, result, transport, provider, job ID |
| `previous_hash` | Previous hashed audit entry in the integrity chain |
| `entry_hash` | SHA-256 hash of the canonical audit payload |
| `integrity_version` | Integrity algorithm version |
| `created_at` | Server timestamp |

Indexes exist for entity lookup, actor lookup, action lookup, and time-based review.

## Integrity Model

Audit rows are append-only at the database layer. Migration `045_audit_integrity.sql` adds no-update and no-delete triggers for `audit_log`, plus hash-chain columns.

New audit rows are written through a serialized PostgreSQL advisory-lock transaction. This prevents concurrent writers from creating competing chain heads. Each row hashes:

- Previous entry hash
- Actor ID
- Action
- Entity type and ID
- Old and new values
- Metadata
- Created timestamp

The Admin API exposes `GET /api/admin/audit-log/integrity` to verify the current chain and report checked rows, legacy rows, head hash, and failures. Pre-hardening rows without `entry_hash` are treated as legacy baseline rows rather than tamper failures.

Admins can anchor the verified head hash through:

- `POST /api/admin/audit-log/anchors`
- `GET /api/admin/audit-log/anchors`

Anchor records persist the head hash, checked row count, legacy row count, provider label, optional external reference, canonical payload, and payload digest. Use `provider` and `externalRef` to record where the same payload was written outside the primary database, for example immutable object storage, a transparency log, or a KMS/HSM-signed evidence register.

CSV exports from `GET /api/admin/audit-log?format=csv` include integrity fields and return signed export headers:

- `x-specora-export-digest`
- `x-specora-export-signature`
- `x-specora-export-algorithm`

## API Helper

New route code should call `recordAuditEvent()` from `apps/api/src/services/auditLog.ts`.

```ts
await recordAuditEvent(fastify, {
  actorId: request.user?.id,
  action: "domain.object.verb",
  entityType: "DomainObject",
  entityId: objectId,
  oldValues: previousRecord,
  newValues: updatedRecord,
  metadata: {
    source: "api.route-name",
    surface: "admin-console",
  },
});
```

`recordAuditEvent()` adds `metadata.result = "success"` by default. Callers can override `result` for denied, failed, queued, or partial outcomes. Actor IDs are normalized before insert because `audit_log.actor_id` is a UUID foreign key; non-UUID development/test actors become `null` rather than breaking the audited operation.

## Naming Rules

Use lowercase dot-separated actions:

- `noun.created`, `noun.updated`, `noun.deleted` for direct entity mutations
- `domain.object.verb` for application workflows
- `app_tool.executed`, `app_tool.queued`, `app_tool.denied`, `app_tool.failed` for tool execution

Keep action names under the current `VARCHAR(50)` schema limit.

Use stable entity types:

- `ConfigurationItem`
- `Relationship`
- `DiscoveryJob`
- `AppInstallation`
- `AppPermission`
- `NumberSequence`
- `AppTool`
- `Incident`
- table IDs for generic Tables records, for example `pg.incidents`

## Required Metadata

Every new high-value route should include:

- `source`: route or service boundary, for example `api.tables`
- `surface`: user or integration surface when meaningful, for example `admin-console`, `arc`, `external-signal`
- `result`: `success`, `queued`, `denied`, `error`, or a specific lifecycle state

Recommended metadata:

- `appId`
- `toolName`
- `resource`
- `requestedAction`
- `transport`
- `provider`
- `tableName`
- `className`
- `jobId`
- `packageId`

## Current Coverage

Implemented audit sources:

- CMDB CI and relationship event-bus mutations
- Discovery completion events
- Generic Tables create, update, and delete paths for Postgres and CMDB-backed tables
- Arc app install and uninstall provisioning jobs
- Admin number sequence create and update
- Admin RBAC permission create and delete
- Admin system property and state-machine configuration create, update, and delete paths
- App tool execute, queue, denied, and failed outcomes
- Incident automation signal ingestion, incident creation, remediation recommendation, remediation execution, and resolution
- Change automation request creation, gate evaluation, gate preview, and lifecycle transition endpoints
- Knowledge automation answer, item creation, draft-from-record, publish, and feedback endpoints
- Asset automation procurement, contract, scan, software usage, and SAM reconciliation endpoints
- Prevention automation detection, candidate creation, action proposal, known-error creation, and lifecycle transition endpoints
- Discovery pipeline create, update, delete, publish, source test, schedule update, run staging, staged record approval/status changes, commit, and upload queue endpoints
- Data Foundations foundation-record stewardship updates
- IT Visibility DCIM floorplan object, connection, rack, rack-assignment, and event mutation endpoints
- RBAC policy drift, searchable audit review, CSV export, and chain verification surfaces

## Current Limits

- Some CMDB-backed generic table updates do not yet include `old_values`.
- Audit review now supports search, export, and integrity status. It still needs richer drilldown, diff rendering, retention management, and AI summarization.
- Auth, chat session, generic job queue, and non-persisting health-rule execution/generation routes are outside the native app mutation audit scope.
- Package provisioning edge cases such as entitlement failure, rollback, and validation-state transitions should be audited when those workflows become real provisioning jobs.
- Audit rows are inserted inline today to preserve accountability and chain ordering. If audit volume becomes material, move persistence behind a queue only with strict per-origin ordering and durable retry semantics.
- For high-compliance environments, periodically anchor the head hash and store the anchor payload outside the primary database, then save that external reference back to Specora.
