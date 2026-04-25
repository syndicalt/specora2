# Changelog

## [0.6.0] — Intelligence

### Added

#### Impact Analysis — Blast Radius Scoring
- **Deterministic risk scoring engine** (`impactScoring.ts`) — computes a 0-100 risk score for every RFC based on CMDB topology.
  - Base criticality from primary CI class + environment multiplier
  - Weighted contribution per affected CI (class × env × decay × direction)
  - Downstream CIs score 1.5×, upstream 0.8×
  - Health penalty: up to +20 for unhealthy CIs
  - Conflict penalty: up to +15 for overlapping RFCs
- **Auto-computed on RFC creation** — `create_rfc` triggers async scoring, stores `risk_score`, `blast_radius`, `priority` in Postgres.
- **Recalculated on edit** — `edit_rfc` with changed affected CIs recomputes the score.
- **Per-CI impact metadata** — `distance`, `direction`, `contribution` stored in `change_request_cis`.

#### What If Preview Mode
- **`preview_impact` chat tool** — preview the risk score for a proposed change WITHOUT creating an RFC.
- Perfect for planning: "What if I include the cache cluster?"

#### Dependency-Aware Conflict Detection
- Enhanced `check_change_conflicts`:
  - **Direct conflicts** — other RFCs affecting the same CI (existing behavior)
  - **Dependency conflicts** — RFCs on different CIs within 3 hops in the Neo4j graph
- Returns separate counts: `directConflicts` and `dependencyConflicts`.

#### Critical Path Highlighting
- **`find_critical_path` chat tool** — traces the highest-weight path from primary CI to a downstream BusinessService.
- Returns every node in the path + total weight. Frontend can highlight "the one thing that breaks everything."

#### Risk Score History
- Migration 023: `change_request_risk_history` table with indexes.
- Every computed score stored with timestamp and actor.
- **`get_rfc_risk_history` chat tool** — returns history + trend delta.

#### Frontend Impact Analysis UI
- **Risk Summary card** on RFC detail view — score badge, blast radius, affected count, downstream count.
- **Priority badges** (critical/high/medium/low) on RFC list cards.
- **Affected CIs list** shows hop distance and direction.

### Changed
- `get_rfc_details` now returns `riskScore`, `blastRadius`, `priority`, and enhanced `affectedCis` with `distance`, `direction`, `contribution`.
- `list_rfcs` includes `risk_score` and `priority`.
- `grade_change_rfc` returns stored computed scores instead of raw count.

---

## [0.3.0] — Graph Power

### Added

#### Service Map — Interactive Graph
- **Graph filtering** — Collapsible panel with checkbox groups for class, environment, and relationship type. Filters applied server-side via Neo4j Cypher.
- **Path tracing** — Two-click mode: click source node, click target node, shortest path highlights in gold with non-path elements dimmed to 30%.
- **Expand/collapse** — "Expand" context menu action fetches 1-hop neighbors via `neighbors` GraphQL query and merges them into the React Flow state.
- **Add Existing CI** — Right-click canvas → "Add Existing CI" opens search modal to pull any CMDB node into the current graph view.
- **Edge hover highlighting** — Hovering an edge boosts stroke width and adds a glow drop-shadow.
- **Custom React Flow node** — `ServiceMapNode` with top/bottom `Handle` components for proper edge attachment.

#### GraphQL API
- **`neighbors(nodeId, types, limit)`** — 1-hop adjacency query for incremental graph expansion.
- **`dependencyPath(fromId, toId, maxHops)`** — `shortestPath()` query between two CIs using structural relationship types.
- **Filter params on `serviceMap`** — `classFilter`, `environmentFilter`, `relationshipFilter` for server-side graph filtering.

#### Saved Views
- **`saved_views` PostgreSQL table** — Per-user bookmarks storing root CI, active filters, and camera position.
- **GraphQL CRUD** — `savedViews`, `createSavedView`, `updateSavedView`, `deleteSavedView` with user-scoped authorization.
- **Service Map UI** — "Save View" / "Load View" buttons in the toolbar with dropdown listing, delete action.

### Fixed
- **PostgreSQL column alias case sensitivity** — All resolvers now use explicit field mapping (`row.react_version` → `reactVersion`) instead of relying on `AS` aliases, which PostgreSQL lowercases.
- **Cypher query whitespace** — `serviceMap` filter query builder uses explicit string concatenation to avoid blank-line syntax errors.

---

## [0.2.0] — App Ecosystem

### Added

#### Specora Arc — App Marketplace
- **Two-tier app ecosystem**: Specora Native (built-in, signed by Specora) and Arc Applications (external, community-submitted).
- **Discover tab** — Unified grid showing all available apps:
  - Specora Native apps (Service Map, CMDB Explorer, Discovery, Settings, Arc) with "Native" badge.
  - Marketplace apps fetched from GraphQL with Install/Installed status.
- **Installed tab** — Split into "Specora Native" (permanent, non-uninstallable) and "Arc Applications" (uninstallable with optional data clearing).
- **Submit tab** — Form for developers to submit apps for admin review.
- **Review tab** (admin-only) — Approve/reject pending marketplace submissions.
- **Dynamic ESM loader** — External apps loaded via `import(/* webpackIgnore: true */ url)` with iframe sandbox fallback on failure.
- **Permission-filtered ShellAPI** — Apps only receive `sendMessage`, `onMessage`, `notify`, and `dispatch` capabilities based on their declared `permissions` array.

#### Window Mode v2
- **Draggable windows** — Title bar drag with 60fps direct-DOM positioning, bounded to viewport.
- **Resizable windows** — Bottom-right grip handle with min 300×200 and max viewport constraints.
- **Click-to-front** — Auto-incrementing z-index on focus, open, and activate.
- **Persistence** — Window position and size saved to `localStorage` under `specora_window_state`, restored on reopen.

#### Built-in Apps
- **Settings** — Theme toggle, API endpoint config, profile management, danger zone (clear data).
- **Discovery Dashboard** — Jobs/sources tabs, ingestion status, file browser.
- **CMDB Explorer** — Search, class/environment filters, paginated table, detail panel with cross-app navigation.
- **Service Map** — Dynamic root CI selector, React Flow graph with dagre layout, CRUD relationships, context menus.

#### App Shell Enhancements
- **IndexedDB registry** — Client-side app registry with `installApp`, `uninstallApp`, `getRegistry`, `seedBuiltInApps`.
- **App-to-app messaging bus** — React Context pub/sub for cross-app communication (`sendMessage`, `onMessage`).
- **Dock v2** — macOS-style floating pill with drag-to-reorder, pin/unpin, running unpinned indicators, active/dormant dots.
- **Right-side chat panel** — Resizable workspace panel (default 420px), dock toggle, `Ctrl+/` shortcut.
- **App launcher** — `Ctrl+K` modal with search, install/uninstall, app status indicators.

#### Backend
- **Marketplace PostgreSQL schema** — `marketplace_apps` table with status lifecycle (`pending` → `approved`/`rejected`).
- **GraphQL marketplace API** — `marketplaceApps`, `marketplaceApp` queries; `submitMarketplaceApp`, `approveMarketplaceApp`, `rejectMarketplaceApp` mutations with admin role enforcement.
- **User preferences** — `updatePreferences` mutation with dock order sync, `me` query with role field.

#### Auth & Users
- Seeded demo user (`alice@specora.dev` / `secret123`).
- Admin role support for marketplace app approval.

### Changed
- `AppInstance` now carries `permissions` for permission enforcement at runtime.
- `OPEN_APP` action requires `permissions` payload across all dispatch sites (shell, launcher, dock, chat overlay).
- `RegistryEntry` and `AppManifest` extended with `description`, `publisher`, `url`, `reactVersion`, `clearDataOnUninstall`.

### Fixed
- `request.headers.get("authorization")` used instead of `(request.headers as any).authorization` for Fetch API compatibility.
- `graphql-request` fetch uses `cache: "no-store"` to prevent Next.js caching of mutations.
- `me` and `updatePreferences` fall back to email lookup for old JWT tokens with Neo4j IDs.

---

## [0.1.0] — Foundation

### Added
- Fastify/GraphQL Yoga API with JWT auth (bcrypt).
- Neo4j CSDMv5 schema with seeded sample data.
- Next.js 14 App Router with dark-first Tailwind UI.
- Python 3.12 asyncio gRPC worker for discovery ingestion.
- Docker Compose for Neo4j + PostgreSQL.
- Chat integration with Provara + OpenAI fallback.
- File upload → worker ingest → Neo4j persist pipeline.

