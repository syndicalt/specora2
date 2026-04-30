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

## Recently Completed

- **Reporting API depth** — CAB evidence datasets and brief coverage metrics, knowledge feedback/gap datasets, knowledge trust/reuse metrics, operational readiness scoring, and CMDB data-quality readiness checks.
- **Discovery RC push** — Rollback records/UI, saved mapping profiles, richer AI mapping rationale, Admin-managed credential references with encrypted managed secrets, edge/collector source registration, source binding, runtime config publishing, evidence upload ingestion, run datasets, and improved edge profiling previews.
- **Operability and scale hardening** — API worker health checks, queue posture, Discovery job health, restore rehearsal command, stable dev launcher, identity provider readiness validation, Redis event/cache support, audit head anchoring, OIDC RS256/JWKS validation, and SAML XML signature validation.
- **Real-time events** — WebSocket pub/sub for platform events with short-lived ticket auth, Redis cross-instance fanout, REST polling fallback, and authenticated SSE fallback for environments where WebSocket upgrades are unavailable.
- **Demo documentation** — Canonical user/admin guides, application screenshots, reusable Playwright screenshot capture, public demo smoke coverage, documentation validation, and Railway release checklist automation.
- **UAT fixes** — App state preservation, chat investigation continuity, CMDB Explorer attribute projection, baseline app access rules for Arc and Customer Portal, executable access-matrix validation for app/chat tool visibility, Customer Portal self-service request polish, Admin Console RBAC access clarity, Specora Arc lifecycle governance polish, and deterministic chat finalization for tool-backed investigations.
- **Platform hardening coverage pass** — Added regression coverage for streaming chat finalization, inherited group grants in Admin RBAC app explanations, AppLauncher role filtering/search/open behavior, and widened web coverage reporting to include tested shell surfaces.
- **Discovery lifecycle polish** — Added collector job/evidence lifecycle summaries, explicit pinned dataset freshness, staged-run discard cleanup, and reconciliation/relationship decision explanations in Discovery review surfaces.
- **Discovery mapping quality hardening** — Normalized edge entity aliases, improved flattened host IP selection, preserved typed host evidence for software/services/interfaces/ports, and covered those cases with transform regression tests.
- **Discovery reconciliation transparency** — Added per-record reconciliation traces with configured keys, actual key values, create/update/block reasoning, and CI identifiers in preview and staged review.
- **Password policy maturity** — Added admin-configurable local-password requirements, shared API enforcement for registration/admin creation/password change, and live requirement checks in Settings, first-login rotation, and Admin user creation.
- **API coverage milestone** — Raised API test coverage past the 80% statement target with focused regression coverage for Tables, Admin routes, app-tool handlers, health tools, and password policy enforcement.

## Next Up

### Release Candidate Readiness

No open RC-readiness blockers are tracked here. Continue using `pnpm docs:check`, `pnpm railway:check`, and `pnpm demo:public` before demo tags.

### Product Polish

No open product-polish blockers are tracked here. Continue capturing UAT feedback as demo users exercise the platform.

### Discovery And Edge

No open Discovery/Edge roadmap items are tracked here. Continue capturing UAT feedback from real edge runs and pipeline authoring.

### Platform Hardening

- **API coverage deepening** — Current full-suite baseline: 80.01% statements, 62.46% branches, 89.85% functions, 84.37% lines. Next targets: GraphQL resolvers, Auth edge cases, Chat edge cases, and remaining low-coverage app-tool service branches.
- **Web coverage expansion** — Current full-suite baseline with lib plus AppLauncher shell coverage: 92.2% statements, 84.78% branches, 95.34% functions, 99.17% lines. Continue widening include scope to AppDock, Settings, ChatPanel, Service Map edit flows, and CI Class Manager as tests land.
- **Large-module split** — Break up Admin Console, Admin API routes, Discovery, Tables, GraphQL resolvers, and Service Map into smaller tested modules.
- **Type-safety tightening** — Reduce broad `any`/unsafe casts in API routes, GraphQL resolvers, Tables, Discovery, and app-tool payloads.
- **Enterprise identity maturity** — Add IdP certificate rotation, metadata refresh automation, and advanced group-to-role mapping.
- **Audit anchoring maturity** — Connect audit chain heads to external immutable stores for high-compliance deployments.

## Technical Debt

Detailed debt planning lives in [`docs-archive/technical-debt-roadmap.md`](docs-archive/technical-debt-roadmap.md).

- **Large-module split** — Break up Admin Console, Admin API routes, Discovery, Tables, GraphQL resolvers, and Service Map into smaller tested modules.
- **API coverage deepening** — Current API coverage is 80.01% statements and 84.37% lines; continue improving branch coverage across GraphQL resolvers, Auth, Chat edge cases, and low-coverage app-tool service branches.
- **Web coverage scope expansion** — Current web coverage includes `src/lib/**/*.ts`, `src/shell/AppAccess.ts`, and `src/shell/AppLauncher.tsx`; continue expanding only as shell/components/app TSX tests are added.
- **Type-safety tightening** — Reduce broad `any`/unsafe casts in API routes, GraphQL resolvers, Tables, Discovery, and app-tool payloads.
- **Web dev stability** — `pnpm dev:stable` remains the supported workaround for local Turbo/Next instability; periodically retest and remove when stable.
- **Enterprise identity maturity** — Add IdP certificate rotation, metadata refresh automation, and advanced group-to-role mapping.
- **Audit anchoring maturity** — Connect audit head anchoring to environment-specific immutable external stores for high-compliance deployments.

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
