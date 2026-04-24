# Changelog

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

