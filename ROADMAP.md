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

## Next Up

### v0.4 — AI Layer
1. **Natural language CI search** — "Find all production databases in us-east-1"
2. **Auto-discovery suggestions** — "You uploaded servers.csv but no network gear; want to scan?"
3. **Anomaly detection** — Orphaned CIs, circular dependencies, missing ownership
4. **Chatops** — "Deploy customer portal" → validates graph, opens change request

### v0.5 — Scale & Ops
1. **Worker queue** — PostgreSQL-backed job queue for large ingestion batches
2. **Change management** — RFC workflow integrated with graph mutations
3. **RBAC** — Role-based access (viewer, operator, admin)
4. **Audit log** — Every graph mutation tracked with who/when/why

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
