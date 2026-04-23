# Specora Roadmap

## Completed

### App Shell Platform
- [x] **AppShell** — Root orchestrator with IndexedDB registry initialization
- [x] **AppContext** — Shell state reducer (OPEN_APP, ACTIVATE_APP, MINIMIZE_APP, CLOSE_APP, PIN/UNPIN_DOCK, TOGGLE_LAUNCHER, notifications)
- [x] **AppDock** — Bottom-centered floating macOS-style pill with active/dormant indicators
- [x] **UserProfileBadge** — Gradient avatar with logout dropdown
- [x] **AppLauncher** — "All Apps" modal with install/uninstall
- [x] **CanvasArea / DormantApps / WindowLayer** — Multi-mode rendering (canvas vs window, dormancy preserves React state)
- [x] **App-to-app messaging bus** — React Context-based pub/sub for cross-app communication
- [x] **SDK** — IndexedDB registry with `installApp`, `uninstallApp`, `getRegistry`, `seedBuiltInApps`

### Service Map (First Built-in App)
- [x] Dynamic root CI selector with search autocomplete (debounced GraphQL)
- [x] Floating centered search pill with CI name left, search right
- [x] Dark glassmorphism styling matching platform theme
- [x] React Flow graph visualization with CSDMv5 nodes and edges

### Discovery Pipeline
- [x] File upload → worker ingest → Neo4j persist with idempotency
- [x] Fixed multipart registration, absolute paths, JSONB serialization, constraint handling
- [x] `servers.csv` sample data ingestion verified (12 servers)

### Chat Integration
- [x] Provara integration with URL normalization (strips trailing `/v1`)
- [x] Tenant header support, second-completion routing
- [x] Global Ctrl+K overlay (not a docked app)

### Auth
- [x] JWT login/register with bcrypt
- [x] Seeded demo user (`alice@specora.dev` / `secret123`)

### Tests
- [x] API: 79 tests passing
- [x] Web: 3 tests passing
- [x] DB: 19 tests passing
- [x] Core: 18 tests passing

---

## In Progress
- [ ] **Dock width** — Currently `min-w-[240px]`; will scale dynamically with more apps
- [ ] **Window mode** — Fixed centered panels; needs drag/resize for v2
- [ ] **More built-in apps** — CMDB Explorer, Discovery, Settings placeholders

---

## Next Up

### v0.2 — App Ecosystem
1. **CMDB Explorer** — List/search all CIs with filtering by class, environment, owner
2. **Discovery Dashboard** — Upload history, ingestion status, file browser
3. **Settings** — Theme toggle, API endpoint config, profile management
4. **App Marketplace** — External app installation via URL or npm package

### v0.3 — Graph Power
1. **Interactive Service Map** — Click nodes to expand/collapse, edge highlighting on hover
2. **Path tracing** — "Show me the dependency path from X to Y"
3. **Graph filtering** — Hide by class, environment, relationship type
4. **Saved views** — Bookmark graph configurations per user

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
- **Chat as global overlay** — Always available via Ctrl+K, never competes for dock space
- **Tailwind arbitrary values avoided** — Use standard utilities to prevent JIT generation misses
- **Provara URL normalization** — Strip trailing `/v1` before appending API path for flexibility
