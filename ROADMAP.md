# Specora Roadmap

This file is the planning-level view of Specora. Use `CHANGELOG.md` for release details and `TODOS.md` for task-level engineering backlog.

## Released

### v0.1 — Foundation

- Fastify/GraphQL Yoga API with JWT auth.
- Neo4j CSDMv5 schema with seeded data.
- Next.js 14 App Router with dark-first Tailwind UI.
- Python 3.12 asyncio gRPC worker for discovery.
- Provara chat integration with direct OpenAI fallback.
- File upload → worker ingest → Neo4j pipeline.

### v0.2 — App Ecosystem (2026-04-23)

- App shell platform with IndexedDB registry, app-to-app messaging, canvas/window rendering, dormancy, and dock v2.
- Specora Arc marketplace with built-in Specora Native apps and external Arc Applications.
- Dynamic ESM app loading with iframe sandbox fallback.
- Permission-filtered `ShellAPI`.
- Draggable, resizable, persisted window mode.
- Built-in Settings, Discovery Dashboard, CMDB Explorer, Service Map, and Arc apps.
- Marketplace PostgreSQL schema and GraphQL CRUD with admin review.

### v0.3 — Graph Power (2026-04-24)

- Service Map graph filtering by class, environment, and relationship type.
- Source-to-target dependency path tracing.
- Expand/collapse through 1-hop neighbor queries.
- Add Existing CI workflow for pulling CMDB nodes into graph views.
- Edge hover highlighting and custom React Flow nodes.
- Saved views backed by PostgreSQL.
- GraphQL enhancements: `neighbors`, `dependencyPath`, and filter params on `serviceMap`.

### v0.4 — AI Layer / Specora Arc Orchestrator (2026-04-24)

- Chat tool registry loaded from core platform tools and app manifests.
- Event Bus with in-memory pub/sub and PostgreSQL persistence.
- ITSM built-in apps: Change Manager, Discovery Insights, and Health Monitor.
- AI multi-tool orchestration across core Neo4j queries and app-specific handlers.
- Synthetic completeness checks with deterministic Cypher rules and guarded AI-generated rules.
- App Manifest v2 with `chatTools` and `events`.
- App Tool REST API with JWT auth.

### v0.5 — Scale & Ops (2026-04-24)

- Audit logging for graph mutations.
- RBAC roles enforced in GraphQL resolvers and app tool routes.
- PostgreSQL-backed worker queue for large ingestion batches.
- Chat proactive suggestions with built-in app shortcuts.

### v0.6 — Intelligence

- Deterministic impact-analysis risk scoring for RFCs.
- What-if impact preview chat tool.
- Dependency-aware change conflict detection.
- Critical-path tracing.
- Risk score history.
- Frontend impact-analysis UI for change requests.

## Next Up

- **Tables stewardship cockpit** — Saved views, advanced filters, column sets, inline edit, audit diffs, validation state, bulk actions, CSV/XLSX/JSON import with upsert/match preview, export, and AI-assisted cleanup.
- **Reporting API surface** — RBAC-aware operational KPI endpoints and metadata contracts for Grafana, PowerBI, Tableau, and warehouse integration.
- **Discovery RC push** — Rollback records/UI, saved mapping profiles, credential-provider abstraction, richer AI mapping rationale, and edge/collector source integration.
- **Operability and scale hardening** — Restore rehearsal, worker health checks, full SSO validation, build reliability, Redis-backed multi-instance state, and audit-head external anchoring design.
- **Real-time events** — WebSocket pub/sub for event bus and SSE chat streaming.

## Technical Debt

- Web dev server crashes with `ELIFECYCLE` when run via `turbo run dev`; use `node ./node_modules/next/dist/bin/next dev` as the workaround.
- Local Next dev sessions can still get stale after heavy iteration; shell bootstrap now has bounded waits and fallback behavior, but clean alternate-port runs or clearing `.next` remain the reliable local recovery path.
- Vitest coverage parser cannot parse some TSX under the current Rolldown path; tests pass, coverage remains non-blocking.
- `GraphExplorer.tsx` remains in `components/` but appears unused; delete after migration confirmation.
- Keep Provara and OpenAI fallback routing covered by tests as the chat/tool-call path evolves.
- Replace websocket app-layer JSON ping with protocol-level `ping()` / `pong`.
- Add full SAML/OIDC assertion validation and admin-managed enterprise IdP configuration.
- Document and automate audit hash-chain external anchoring for high-compliance deployments.

## Decisions Log

- **Neo4j for CMDB** — Graph topology is the core data model, not a secondary projection.
- **GraphQL for CSDMv5 CRUD** — Centralizes auth, validation, relationship allowlisting, and parsing.
- **Provara as primary LLM router** — Provara supports tool calls and centralizes model routing; direct OpenAI remains the fallback.
- **IndexedDB over backend registry for installed apps** — Enables local discovery, zero-config installs, and offline behavior.
- **Dormant apps use `display: none`** — Preserves React state while keeping inactive app DOM out of view.
- **Chat as right-side panel** — Keeps assistant context available beside the main workspace.
- **Tailwind arbitrary values avoided** — Prefer standard utilities to reduce JIT generation misses.
- **CMDB Explorer is built in** — Core platform capability, not an optional marketplace add-on.
- **Audit integrity is a platform primitive** — Audit records are append-only and hash-chained; future compliance work should anchor the chain head outside the primary database.
