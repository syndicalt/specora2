# Seeding, E2E, and Coverage Notes

Specora has two seed layers:

- Neo4j CMDB seed: `pnpm --filter @specora/db seed`
- PostgreSQL operations seed: `packages/db/migrations/032_demo_itsm_itam_seed.sql`
- PostgreSQL enterprise stress seed: `pnpm --filter @specora/db seed:enterprise`

The Neo4j seed owns the 5,000 CSDMv5 configuration items and their graph relationships. The Postgres operations seed adds deterministic app data that references those stable CI IDs so the native apps tell one connected story.

## Current Seed Contract

The graph seed loads:

- 5,000 `ConfigurationItem` nodes
- 13,350 demo relationships in the current generated dataset
- Stable CI IDs such as `demo-applicationservice-0001`, `demo-server-0001`, and `demo-database-0001`
- User CIs linked to seeded Postgres users by `userId`

The operations seed loads linked demo data for:

- Discovery sources and completed jobs
- Change requests, affected CIs, approvers, comments, and risk context
- Incidents, incident CIs, timeline events, proposed actions, and postmortem draft
- Knowledge runbooks, known errors, links, feedback, events, and demand gaps
- Prevention candidates, evidence, actions, and events
- Hardware assets, contracts, entitlements, usage, evidence, scans, reconciliation runs, and SAM exceptions
- IT Visibility DCIM sites, rooms, racks, floorplans, power paths, facility events, and floorplan connections

`032_demo_itsm_itam_seed.sql` uses fixed UUIDs and `ON CONFLICT` handlers. It can be re-run against the same database during demos without duplicating the seeded records.

## Enterprise Stress Seed

The enterprise stress seed is separate from migrations and normal demo seeding. It creates deterministic, idempotent synthetic data across every seed-owned public PostgreSQL table except `schema_migrations`. It is meant for planner review, UI pagination testing, index validation, and command-center stress testing.

Profiles:

```bash
ENTERPRISE_SEED_PROFILE=smoke pnpm --filter @specora/db seed:enterprise
ENTERPRISE_SEED_PROFILE=standard pnpm --filter @specora/db seed:enterprise
ENTERPRISE_SEED_PROFILE=enterprise pnpm --filter @specora/db seed:enterprise
```

The default is `standard`. Use `smoke` for quick validation and `enterprise` only when the local machine or test database has enough CPU, memory, and disk headroom.

Useful overrides:

```bash
ENTERPRISE_SEED_CORE_RECORDS=50000 \
ENTERPRISE_SEED_USERS=1000 \
ENTERPRISE_SEED_EVENTS_PER_RECORD=5 \
pnpm --filter @specora/db seed:enterprise
```

The seed intentionally uses stable synthetic IDs and upserts. Re-running the same profile updates existing stress records instead of duplicating them. It does not delete demo data.

## Validation Commands

Run these before demo validation:

```bash
docker compose up -d neo4j postgres
pnpm migrate:status
pnpm migrate
pnpm --filter @specora/db seed
```

For an already-running Postgres container created before the migration runner, back up the database, verify the schema/data, and baseline once before normal demo validation:

```bash
pnpm migrate:baseline
pnpm migrate:status
```

Coverage and build checks:

```bash
pnpm validate:seed
pnpm --filter @specora/db test
pnpm --filter @specora/api test
pnpm --filter @specora/api build
```

Demo-readiness check:

```bash
pnpm demo:ready
```

Use `SKIP_E2E=1 pnpm demo:ready` when validating backend and type safety while the web server is intentionally stopped. Use `E2E_START_SERVERS=1 pnpm demo:ready` when Playwright should start the API and web servers itself.

## Coverage State

Current verified results:

- `@specora/db`: 100% statements, branches, functions, and lines
- `@specora/api`: 329 passing tests across 38 files; 64.77% statements, 51.27% branches, 74.39% functions, 67.68% lines
- `@specora/web`: 14 passing Playwright tests covering login, launcher ordering/search, app-open smoke paths, Tables create/edit/filter/delete, Admin Access Analyzer, Arc package provisioning, Discovery source-to-CMDB commit, and DCIM floorplan object create/edit/persist/delete

The practical target remains 100%, but the API still has broad resolver and app-tool surfaces that need incremental workflow tests. We should not raise thresholds to 100% until the missing behavior is actually covered.

Priority coverage gaps:

- GraphQL resolver workflows, especially error paths and relationship validation
- `services/appTools.ts`, which now contains many native app handlers
- Full app route workflows that exercise RBAC, user context, tool registry execution, and Postgres/Neo4j adapters together
- Browser E2E coverage for dock-aware pages, command center layouts, and table/CMDB workflows beyond the current demo spine

## E2E Direction

The API now has route-level integration coverage for native app tools. These tests go through:

- Built-in tool registration
- `/api/apps/:appId/tools` listing
- RBAC allow and deny paths
- User context injection into tool arguments
- Incident creation, knowledge gap capture, and asset scan workflows

The repository now has an initial Playwright browser smoke suite under `apps/web/e2e`. The suite is intentionally small and demo-oriented. Prefer a small number of high-value journeys instead of brittle screenshot-only checks:

- Login and open default pinned apps
- CMDB Explorer: search, inspect, chat-assisted action
- Tables: filter, column pick, create/edit/delete
- Incident: ingest signal, review AI triage, approve or reject remediation
- Knowledge: answer from governed content and capture a gap
- Asset: ingest contract, review entitlements, scan/update asset
- Discovery: create a source, draft a transform, preview, save, publish, run, approve, commit, and verify cleanup
- DCIM: open floorplan, create rack, move rack, create connection, verify persistence after refresh

Implemented smoke coverage currently validates login, launcher ordering/search, app-open surfaces for CMDB Explorer, Tables, Incident, Knowledge, and DCIM, plus Tables, Discovery, Admin/RBAC, Arc package provisioning, and DCIM write paths. The next E2E increment should add deeper DCIM connection/rack movement coverage and one high-value Incident or Knowledge write workflow.

## Lessons Learned

Seed data should be product narrative, not random rows. The most useful demo data crosses app boundaries: a CI appears in Discovery, Incident, Change, Knowledge, Prevention, and Asset workflows.

Keep graph and ops seeds separate. Neo4j owns CSDMv5 topology; Postgres owns operational workflow state. The bridge is the stable CI ID.

Idempotency matters. Demo and test databases get replayed frequently, so migrations that seed demo records should use fixed identifiers and conflict handlers.

Coverage should follow risk. A literal 100% goal is useful as direction, but low-value line chasing is worse than focused workflow tests that exercise registration, RBAC, persistence, and user-visible behavior.

Native app tests should include the registry boundary. Handler-only tests are fast and useful, but at least one layer must prove that installed native apps expose tools correctly through the platform routes.
