# Specora Roadmap

## Released

### v0.2 — App Ecosystem (2026-04-23)
- [x] **App Shell Platform** — IndexedDB registry, app-to-app messaging bus, multi-mode rendering (canvas/window), dormancy, dock v2 with drag-reorder
- [x] **Specora Arc** — Two-tier app marketplace:
  - **Specora Native** — Built-in apps signed by Specora (Service Map, CMDB Explorer, Discovery, Settings, Arc)
  - **Arc Applications** — External marketplace apps with install/uninstall, admin review queue, permission-filtered ShellAPI, dynamic ESM loader with iframe fallback
- [x] **Window Mode v2** — Draggable, resizable, position/size persisted to localStorage, click-to-front z-index stacking
- [x] **Settings** — Theme toggle, API endpoint config, profile management, danger zone
- [x] **Discovery Dashboard** — Jobs/sources tabs, ingestion status, file browser
- [x] **CMDB Explorer** — Search, filters, paginated table, detail panel with cross-app navigation
- [x] **Service Map** — Dynamic root CI selector, React Flow graph, dagre layout, relationship CRUD
- [x] **Right-side Chat Panel** — Resizable workspace panel, dock toggle, `Ctrl+/` shortcut
- [x] **Marketplace Backend** — PostgreSQL schema, GraphQL CRUD with admin role enforcement

### v0.1 — Foundation
- [x] Fastify/GraphQL Yoga API with JWT auth
- [x] Neo4j CSDMv5 schema with seeded data
- [x] Next.js 14 App Router with dark-first Tailwind UI
- [x] Python 3.12 asyncio gRPC worker for discovery
- [x] Chat integration with Provara + OpenAI fallback
- [x] File upload → worker ingest → Neo4j pipeline

---

## Released

### v0.3 — Graph Power (2026-04-24)
- [x] **Graph Filtering** — Class/environment/relationship filter panel with custom dark-theme checkboxes, server-side Cypher filtering
- [x] **Path Tracing** — Two-click source→target selection, `shortestPath()` query, gold highlight with dimmed non-path elements
- [x] **Expand/Collapse** — "Expand" context menu fetches 1-hop neighbors via `neighbors` GraphQL query
- [x] **Add Existing CI** — Search modal to pull any CMDB node into the current graph view
- [x] **Edge Hover Highlighting** — Stroke width boost + glow drop-shadow on hover
- [x] **Saved Views** — `saved_views` PostgreSQL table, GraphQL CRUD, Save/Load/Delete UI in Service Map toolbar
- [x] **GraphQL Enhancements** — `neighbors`, `dependencyPath`, filter params on `serviceMap`

### v0.1 — Foundation
- [x] Fastify/GraphQL Yoga API with JWT auth
- [x] Neo4j CSDMv5 schema with seeded data
- [x] Next.js 14 App Router with dark-first Tailwind UI
- [x] Python 3.12 asyncio gRPC worker for discovery
- [x] Chat integration with Provara + OpenAI fallback
- [x] File upload → worker ingest → Neo4j pipeline

---

## Released

### v0.4 — AI Layer / Specora Arc Orchestrator (2026-04-24)
- [x] **Chat Tool Registry** — Apps declare `chatTools` in manifest; AI dynamically loads them into system prompt
- [x] **Event Bus** — In-memory pub/sub + PostgreSQL persistence; `ci.created/updated/deleted`, `relationship.created/updated/deleted`, `discovery.completed`
- [x] **ITSM App Ecosystem** — 3 non-core built-in apps registered in Arc marketplace:
  - **Change Manager** — RFC workflow (`draft` → `pending_approval` → `approved` → `implemented` → `closed`), PostgreSQL-backed, chat tools for CRUD
  - **Discovery Insights** — Coverage gap analysis, scan recommendations, chat tools
  - **Health Monitor** — Anomaly detection (orphaned, stale, cycles), health scoring, chat tools
- [x] **AI Multi-Tool Orchestration** — Chat routes tool calls to core Neo4j queries or app-specific handlers via unified registry
- [x] **Synthetic Completeness** — Hybrid approach:
  - **Hardcoded rules** — 8 deterministic CSDMv5 structural validations (Cypher)
  - **AI Rule Generator** — LLM analyzes graph topology, suggests new Cypher queries, safety-guarded execution
- [x] **App Manifest v2** — Added `chatTools`, `events` arrays to `AppManifest`
- [x] **App Tool REST API** — `GET /api/apps/:id/tools`, `POST /api/apps/:id/tools/:tool` with JWT auth

## Released

### v0.5 — Scale & Ops (2026-04-24)
- [x] **Audit log** — Every graph mutation tracked with who/when/why via Event Bus
- [x] **RBAC** — Role-based access (viewer, operator, admin, security_admin, change_manager, approver) enforced in GraphQL resolvers and app tool routes
- [x] **Worker queue** — PostgreSQL-backed job queue for large ingestion batches
- [x] **Chat proactive suggestions** — Capability accordion in chat overlay with built-in app shortcuts

## Next Up

### v0.5 — Remaining
- [ ] **Real-time events** — WebSocket pub/sub for event bus + SSE chat streaming (in progress)

### v0.6 — Intelligence
1. **NL CI Search standalone UI** — Global search bar with LLM→Cypher translation
2. **Impact analysis** — Blast radius calculation before changes
3. **Auto-remediation** — Suggest fixes for anomalies (create missing relationships)

### v0.6 — Intelligence
1. **NL CI Search standalone UI** — Global search bar with LLM→Cypher translation
2. **Impact analysis** — Blast radius calculation before changes
3. **Auto-remediation** — Suggest fixes for anomalies (create missing relationships)

---

## Technical Debt
- [ ] Web dev server crashes with `ELIFECYCLE` when run via `turbo run dev` — use `node ./node_modules/next/dist/bin/next dev` instead
- [ ] Vitest coverage parser can't parse TSX (Rolldown error on `import type`, JSX) — non-blocking, tests pass
- [ ] `GraphExplorer.tsx` still in `components/` but unused — safe to delete after migration confirmation
- [ ] Provara chat fallback to OpenAI if `PROVARA_URL` not set — verify fallback path works end-to-end

---

## Decisions Log
- **IndexedDB over backend registry** — Client-side discovery, zero-config installs, works offline
- **Dormant apps in `display: none`** — Preserves React state without DOM overhead
- **Chat as right-side panel (not overlay)** — First-class workspace utility, parallel with canvas
- **Tailwind arbitrary values avoided** — Use standard utilities to prevent JIT generation misses
- **Provara URL normalization** — Strip trailing `/v1` before appending API path for flexibility
- **CMDB Explorer is built-in** — Core platform feature, not marketplace add-on
