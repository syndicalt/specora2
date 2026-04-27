# Deployment and Operations Guide

**Status:** Production-readiness guide for current implementation
**Last updated:** 2026-04-27

This document explains how Specora runs, which services must be healthy, how configuration is expected to work, and what is still development-grade. It is intentionally explicit about current limitations so operators and reviewers can distinguish implemented behavior from roadmap intent.

## Runtime Topology

Specora runs as three application services plus two primary data services:

| Service | Default port | Role |
| --- | --- | --- |
| Web | `3000` | Next.js shell, native app UI, app launcher, chat panel |
| API | `4000` | Fastify, GraphQL Yoga, REST app routes, RBAC, app tools, WebSocket events |
| Worker | `50051` | Python asyncio gRPC worker for ingestion/background jobs |
| Neo4j | `7474`, `7687` | CMDB graph system of record |
| PostgreSQL | `5432` | Users, permissions, app registry, audit/events, ITSM/ITAM/DCIM/discovery workflow data |

Redis is optional in the current local stack. The API defaults to `redis://localhost:6379` for multi-instance pub/sub, but `docker-compose.yml` does not currently start Redis. For a multi-API deployment, provide Redis and set `REDIS_URL`.

## Data Ownership

Neo4j owns graph topology:

- Configuration Items
- CI class labels on nodes
- Service, dependency, ownership, hosting, management, and location relationships
- CSDMv5 graph traversal use cases

PostgreSQL owns operational state:

- Users, preferences, permissions, system properties
- App marketplace, installed app state, package provisioning jobs
- Saved views, audit log, events, queue data
- Change, incident, knowledge, prevention, asset, discovery, and DCIM records

The stable bridge between stores is the CI ID. Operational records reference CIs by ID rather than copying graph topology into PostgreSQL.

## Configuration

Required for API:

| Variable | Purpose |
| --- | --- |
| `NEO4J_URI` | Neo4j Bolt URI |
| `NEO4J_USER` | Neo4j user |
| `NEO4J_PASSWORD` | Neo4j password |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing key |
| `ACCESS_TOKEN_EXPIRES_IN` | Access token lifetime, default `15m` |
| `ACCESS_TOKEN_EXPIRES_IN_SECONDS` | Browser-facing token lifetime in seconds, default `900` |
| `REFRESH_TOKEN_DAYS` | Refresh-session lifetime, default `30` |
| `WORKER_GRPC_HOST` | Worker gRPC target, usually `worker:50051` in Docker |

Required for Web:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | GraphQL endpoint, for example `http://localhost:4000/graphql` |
| `NEXT_PUBLIC_WS_URL` | WebSocket endpoint when enabled, for example `ws://localhost:4000/graphql` |

Required for Worker:

| Variable | Purpose |
| --- | --- |
| `NEO4J_URI` | Neo4j Bolt URI |
| `NEO4J_USER` | Neo4j user |
| `NEO4J_PASSWORD` | Neo4j password |
| `DATABASE_URL` | PostgreSQL connection string |
| `GRPC_PORT` | Worker gRPC listen port |

AI routing:

| Variable | Purpose |
| --- | --- |
| `PROVARA_URL` | Primary Provara router endpoint |
| `PROVARA_API_KEY` | Provara key |
| `PROVARA_TENANT_ID` | Optional Provara tenant |
| `PROVARA_MODEL` | Optional default Provara model/router |
| `OPENAI_API_KEY` | Direct OpenAI fallback key |
| `OPENAI_MODEL` | Optional direct OpenAI fallback model |
| `DISCOVERY_PROVARA_MODEL` | Optional Discovery transform model override through Provara |
| `DISCOVERY_OPENAI_MODEL` | Optional Discovery direct fallback model |
| `DISCOVERY_AI_TIMEOUT_MS` | Discovery transform timeout before deterministic fallback |

Operational extras:

| Variable | Purpose |
| --- | --- |
| `REDIS_URL` | Redis pub/sub for multi-instance event propagation |
| `UPLOAD_DIR` | Discovery upload directory, default `./uploads` |
| `PATHLIGHT_URL` | Optional worker trace collector |

## Local Stack

Start databases:

```bash
docker compose up -d neo4j postgres
```

Seed Neo4j:

```bash
pnpm --filter @specora/db seed
```

Run all services:

```bash
pnpm dev
```

Or run individual services:

```bash
pnpm --filter @specora/api dev
pnpm --filter @specora/web dev
python -m src.main
```

The web dev server caveat still applies: if Next crashes under Turbo, run the direct Next command from the web app context:

```bash
node ./node_modules/next/dist/bin/next dev
```

## Health Checks

API health:

```bash
curl -I http://localhost:4000/health
```

Expected response is HTTP 200. The route returns `{ "status": "ok" }`.

API readiness:

```bash
curl http://localhost:4000/ready
curl http://localhost:4000/api/health/ready
```

Expected response is HTTP 200 when required runtime dependencies are available. The readiness payload reports PostgreSQL, Neo4j, Redis, worker configuration, and LLM configuration. PostgreSQL or Neo4j failure returns HTTP 503. Redis, worker, or LLM gaps are reported as degraded/warn conditions because the API can still serve non-dependent requests.

Configuration audit:

```bash
curl http://localhost:4000/api/health/config
```

This authenticated route reports required and recommended environment variables without returning secret values. It fails missing required production configuration and weak/default `JWT_SECRET` values.

Web health:

```bash
curl -I http://localhost:3000
```

PostgreSQL:

```bash
docker compose exec postgres pg_isready -U specora -d specora
```

Neo4j:

```bash
docker compose exec neo4j cypher-shell -u neo4j -p specora123 "RETURN 1"
```

Worker:

The worker currently exposes gRPC, not an HTTP health endpoint. For production, add a gRPC health service or sidecar health check. Until then, operational checks should verify the process is running and that API-to-worker calls succeed.

## Job Queue Operations

The API exposes authenticated queue inspection endpoints:

```bash
curl http://localhost:4000/api/jobs/summary
curl http://localhost:4000/api/jobs/dead-letter
curl http://localhost:4000/api/jobs?status=failed
```

`/api/jobs/summary` returns counts by status, stale running jobs, and dead-letter jobs. A stale job is a `running` job whose `updated_at` is older than the configured threshold, defaulting to 30 minutes.

Requeue stale running jobs:

```bash
curl -X POST http://localhost:4000/api/jobs/requeue-stale \
  -H "Content-Type: application/json" \
  -d '{"staleAfterMinutes":30,"limit":100}'
```

This increments retry count and moves stale running jobs back to `pending` unless the retry would exceed `max_retries`, in which case the job becomes `failed`. Dead-letter jobs are failed jobs with `retries >= max_retries`.

Operational expectations:

- Investigate dead-letter jobs before replaying them.
- Keep job payloads bounded and structured; large binary inputs should live in object storage or upload directories, not directly in the queue.
- Long-running connector execution should heartbeat or update job state before production scale claims.

## Startup Order

Start dependencies first:

1. PostgreSQL
2. Neo4j
3. Redis, if using multi-instance API event propagation
4. Worker
5. API
6. Web

The API needs PostgreSQL and Neo4j available at startup. Worker-backed ingestion requires the worker to be reachable at `WORKER_GRPC_HOST`.

## Migrations

PostgreSQL migrations live in `packages/db/migrations/` and are applied by the `@specora/db` migration runner. The runner creates `schema_migrations`, records filename/checksum/status/duration/error, applies pending and previously failed migrations in lexical order, and fails the release if an already-applied migration checksum no longer matches the local file.

Check migration state before each deployment:

```bash
pnpm migrate:status
pnpm migrate:dry-run
```

Apply pending migrations:

```bash
pnpm migrate
```

Existing databases created before the migration runner will not have `schema_migrations`, even though many SQL files may already have been applied by Docker initialization or manual `psql` commands. For those environments, take a backup, verify the schema/data, then baseline once:

```bash
pnpm migrate:baseline
pnpm migrate:status
```

Baselining records the current migration files as applied without executing their SQL. After a baseline, future deployments should use `pnpm migrate`. Do not edit an applied migration file; add a new migration instead.

Neo4j class and demo graph data are seeded by `@specora/db`:

```bash
pnpm --filter @specora/db seed
```

The seed command is appropriate for demo/dev environments. Production graph imports should be handled through Discovery or controlled migration/import jobs, not by replaying demo seed data.

## Build and Verification

Release-readiness gate:

```bash
pnpm release:check
```

`release:check` runs the fast local gate: artifact cleanup, migration status, migration dry-run, API typecheck, web typecheck, database tests, and API tests. It intentionally skips slower or environment-heavy checks unless requested.

Full production-readiness gate:

```bash
pnpm prod:ready
```

`prod:ready` runs the full gate: fast checks plus web unit tests, API/web production builds, seed validation, and browser E2E. Use this before release candidates or external demo branches.

Useful flags:

- `ALLOW_DIRTY=0 pnpm release:check` fails if the worktree has uncommitted changes.
- `RUN_BUILDS=1 pnpm release:check` adds API and web builds to fast mode.
- `RUN_SEED_VALIDATION=1 pnpm release:check` adds demo seed validation.
- `RUN_E2E=1 pnpm release:check` adds browser E2E against already-running servers.
- `E2E_START_SERVERS=1 RUN_E2E=1 pnpm release:check` lets Playwright manage servers.
- `CLEAN_NEXT=1 pnpm release:check` removes the Next build cache before checks.

Type/build checks:

```bash
pnpm --filter @specora/api build
pnpm --filter @specora/web build
```

Tests:

```bash
pnpm --filter @specora/db test
pnpm --filter @specora/api test
pnpm --filter @specora/web e2e:with-servers
```

Demo readiness:

```bash
pnpm demo:ready
```

Backend and seed validation without browser E2E:

```bash
SKIP_E2E=1 pnpm demo:ready
```

## Scaling Notes

API:

- Short-lived JWT access tokens allow stateless API authorization across instances.
- Refresh sessions are stored in PostgreSQL as hashed opaque tokens. Rotation, logout, user revocation, invalid attempts, and reuse detection are audited. Authenticated API requests with access tokens are rejected if the backing session has been revoked or expired.
- Optional Google/GitHub OAuth providers require matching client IDs/secrets and stable `API_PUBLIC_URL` callback configuration.
- OAuth and OIDC callbacks use short-lived, one-time `auth_handoffs` codes rather than placing bearer tokens directly into redirect URLs.
- Just-in-time OAuth-created users default to `OAUTH_DEFAULT_ROLE` or `user`; production deployments should grant access through RBAC after identity proofing.
- Enterprise SSO is configured in Admin Console through `sso_configs`. Multiple SAML/OIDC providers can coexist by domain set. Matching domains can enforce SSO and block password login. OIDC callback exchange is implemented; SAML assertion validation remains the next adapter layer.
- Use Redis for multi-instance WebSocket/event propagation.
- Ensure all API instances share the same `JWT_SECRET`.
- API instances must share PostgreSQL and Neo4j.

Web:

- Next.js can be scaled horizontally behind a load balancer.
- `NEXT_PUBLIC_API_URL` must point at the reachable API endpoint for the browser.

Worker:

- Current worker behavior is gRPC based and not yet a full distributed worker pool.
- Long-running Discovery connectors and remediation jobs should move toward queue-backed execution before production scale claims.
- Stale running jobs can now be detected and requeued through the job queue API, but workers still need explicit heartbeat ownership for richer pool semantics.

PostgreSQL:

- Use managed Postgres or equivalent operational discipline: backups, monitoring, connection limits, point-in-time recovery.
- The API uses `pg`; tune pool settings before high concurrency deployments.

Neo4j:

- Community Edition is used locally.
- Production deployments should evaluate Neo4j Enterprise or a managed graph service for clustering, backups, and operational tooling.

## Logging and Audit

Application logs currently come from each service process/container. Important operational records are stored in PostgreSQL:

- `audit_log`
- `events`
- `chat_traces`
- `app_provisioning_jobs`
- app-specific event tables such as incident, knowledge, prevention, and DCIM events

The canonical audit contract is documented in [Audit Contract](audit-contract.md). Current server-side coverage includes CMDB event-bus mutations, Discovery completion events, generic Tables create/update/delete paths, Arc app install/uninstall provisioning, Admin number sequence, RBAC permission, system property, state-machine changes, app tool execution/queue/denial/failure outcomes, Incident automation workflows, and native app mutation routes for Change, Knowledge, Asset, Prevention, Discovery, Data Foundations, and IT Visibility DCIM.

Audit records are append-only in PostgreSQL and include a tamper-evident hash chain for new rows. Admin users can verify the chain through the Admin Console or `GET /api/admin/audit-log/integrity`. Audit CSV exports include integrity hashes and signed digest headers for evidence handling.

Audit is intentionally stored separately from app-specific event tables. Event tables explain workflow history inside an app; `audit_log` explains accountable platform mutations across apps and integration surfaces.

## Production Gaps

Known gaps before production claims:

- PostgreSQL has a migration runner, runtime readiness, and queue indexes, but restore drills and release automation still need rehearsal in a production-like environment.
- Worker does not expose a standard health endpoint.
- Redis is documented and supported by API code but not included in local compose.
- Package provisioning jobs complete immediately; entitlement checks, rollback, and install progress are roadmap work.
- Field-level RBAC is implemented for Tables and explainable through Admin RBAC utilities. Condition-based record ACLs remain a roadmap item.
- Backup/restore procedures are documented separately but should be rehearsed and automated.
- Secrets should be supplied by a secret manager, not committed `.env` files or compose defaults.
- Audit hash-chain external anchoring is not yet implemented. High-compliance deployments should plan immutable external retention or head-hash anchoring.
