# Audit Contract

**Status:** Implemented platform contract for server-side mutation audit events
**Last updated:** 2026-04-26

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
| `created_at` | Server timestamp |

Indexes exist for entity lookup, actor lookup, action lookup, and time-based review.

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

## Current Limits

- Some CMDB-backed generic table updates do not yet include `old_values`.
- Audit Log UI is still alpha/beta and needs filtering, drilldown, export, and AI summarization.
- Auth, chat session, generic job queue, and non-persisting health-rule execution/generation routes are outside the native app mutation audit scope.
- Package provisioning edge cases such as entitlement failure, rollback, and validation-state transitions should be audited when those workflows become real provisioning jobs.
- Audit rows are inserted inline today. If audit volume becomes material, move persistence behind a queue while preserving write ordering for the originating operation.
