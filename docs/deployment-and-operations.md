# Deployment and Operations Guide

**Status:** Production-readiness guide for current implementation
**Last updated:** 2026-04-26

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

- Stateless JWT allows multiple API instances.
- Use Redis for multi-instance WebSocket/event propagation.
- Ensure all API instances share the same `JWT_SECRET`.
- API instances must share PostgreSQL and Neo4j.

Web:

- Next.js can be scaled horizontally behind a load balancer.
- `NEXT_PUBLIC_API_URL` must point at the reachable API endpoint for the browser.

Worker:

- Current worker behavior is gRPC based and not yet a full distributed worker pool.
- Long-running Discovery connectors and remediation jobs should move toward queue-backed execution before production scale claims.

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

The canonical audit contract is documented in [Audit Contract](audit-contract.md). Current server-side coverage includes CMDB event-bus mutations, Discovery completion events, generic Tables create/update/delete paths, Arc app install/uninstall provisioning, Admin number sequence, RBAC permission, system property, and state-machine changes, app tool execution/queue/denial/failure outcomes, Incident automation workflows, and native app mutation routes for Change, Knowledge, Asset, Prevention, Discovery, Data Foundations, and IT Visibility DCIM.

Audit is intentionally stored separately from app-specific event tables. Event tables explain workflow history inside an app; `audit_log` explains accountable platform mutations across apps and integration surfaces.

## Production Gaps

Known gaps before production claims:

- PostgreSQL has a migration runner, but restore drills and release automation still need rehearsal in a production-like environment.
- Worker does not expose a standard health endpoint.
- Redis is documented and supported by API code but not included in local compose.
- Package provisioning jobs complete immediately; entitlement checks, rollback, and install progress are roadmap work.
- Field-level and conditional ACLs are roadmap items.
- Backup/restore procedures are documented separately but should be rehearsed and automated.
- Secrets should be supplied by a secret manager, not committed `.env` files or compose defaults.
