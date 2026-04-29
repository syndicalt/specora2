# Database Performance Audit

**Status:** April 2026 audit complete; PostgreSQL index hardening added in migration `043_enterprise_performance_indexes.sql`.

## Scope

This audit reviewed the live local PostgreSQL schema, migration history, foreign-key coverage, current index coverage, high-traffic API query patterns, and Neo4j CMDB indexes. The local database is intentionally small, so row counts and sequential scan statistics are not representative of enterprise production load. The useful signal came from schema shape, join paths, queue screens, search behavior, and missing foreign-key indexes.

## Implemented Changes

Migration `043_enterprise_performance_indexes.sql` adds:

- Foreign-key indexes that were missing on operational tables.
- Composite queue indexes for Incident, Change, Catalog Requests, Discovery, Knowledge, DCIM, ITAM, Prevention, and app provisioning views.
- Timeline indexes for event tables where the UI loads related history by parent record.
- Trigram indexes for common title/summary/description searches.
- Platform administration indexes for app installations, provisioning jobs, CI class hierarchy, record numbers, and event-bus reads.

The Neo4j seed schema now includes a full-text index over `ConfigurationItem.name`, `ConfigurationItem.class`, and `ConfigurationItem.environment` for CMDB lookup paths. Existing exact-match indexes remain in place for ID, name, class, and environment.

## Findings

PostgreSQL is the correct system of record for users, RBAC, app installation state, operational records, requests, workflow events, audit records, and scheduler metadata. Before this audit, the main gap was missing FK-leading indexes on many recently added native app tables. Those are now covered.

Neo4j remains the correct graph store for CSDMv5 CMDB relationships. It should not be replaced with relational joins for service maps, dependency traversal, or blast-radius analysis. The main gap was text lookup; the added full-text index addresses that without changing the graph model.

The current local dataset is too small to validate planner behavior under realistic cardinality. Enterprise validation needs synthetic load at the table scale expected for production: millions of audit/events/chat rows, hundreds of thousands to millions of operational records, and large CMDB relationship graphs.

Use `pnpm --filter @specora/db seed:enterprise` to create a deterministic enterprise-scale PostgreSQL stress dataset. Start with `ENTERPRISE_SEED_PROFILE=smoke`, then move to `standard` or `enterprise` after confirming disk and memory headroom.

## Offload Guidance

Do not force every workload into PostgreSQL or Neo4j.

- Full-text and semantic search should move to a dedicated search layer when knowledge, catalog, incident, and change content grow beyond demo scale. Good candidates are OpenSearch, Meilisearch, Typesense, or Postgres full-text search as an interim step. Large `knowledge_items.content` search should not rely on a permanent trigram index.
- High-volume append-only telemetry, audit, chat, discovery run logs, and DCIM events should use partitioned PostgreSQL first. If volume becomes analytical or observability-grade, move cold/aggregate reads to ClickHouse, Timescale, or a warehouse while preserving PostgreSQL as the accountable transaction store.
- File-like payloads such as discovery uploads, contract documents, entitlement evidence, and large AI artifacts should live in object storage such as S3 or MinIO. PostgreSQL should store metadata, ownership, retention policy, hash, and processing state.
- Long-running orchestration can start in PostgreSQL-backed job tables, but high-throughput or multi-step durable workflows should move to a workflow engine or queue layer such as Temporal, BullMQ/Redis, or a dedicated worker scheduler.

## Partitioning Candidates

These tables should be partitioned before production-scale ingestion:

- `audit_log`
- `events`
- `chat_messages`
- `incident_events`
- `catalog_request_events`
- `knowledge_events`
- `prevention_events`
- `asset_scan_events`
- `dcim_events`
- `discovery_jobs`
- `discovery_staged_records`
- `discovery_staged_relationships`

Partition by time for append-only history. Partition by tenant first if multi-tenant isolation becomes a hard production requirement.

## Operating Requirements

Production deployments should include:

- Routine `VACUUM` and `ANALYZE` monitoring.
- Autovacuum tuning for write-heavy event and audit tables.
- Slow-query logging and `pg_stat_statements`.
- Index bloat monitoring.
- Backup and restore rehearsal with both PostgreSQL and Neo4j treated as one recovery point.
- Load tests that exercise command-center filters, table filters, search, relationship expansion, discovery staging, and portal routing.

The current migration improves the baseline substantially, but it is not a substitute for production load testing and planner review with realistic data volumes.
