# Technical Debt Roadmap

Last reviewed: 2026-04-28.

This roadmap tracks engineering debt that materially affects product reliability, delivery speed, and UAT quality. It is intentionally separate from feature roadmap work.

## Current Coverage Baseline

Fresh baseline from the last sweep:

| Package | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `@specora/api` | 70.30% | 54.05% | 81.67% | 74.22% |
| `@specora/web` configured lib scope | 90.47% | 82.81% | 100% | 98.79% |

The web number is intentionally called out as configured scope because current Vitest coverage includes `src/lib/**/*.ts`, not the full app/shell TSX surface.

## Completed In This Debt Sprint

- Added this technical debt roadmap and raised API/web coverage thresholds to the current passing baselines.
- Moved transient per-tab UI state from shared `localStorage` to `sessionStorage` for CMDB Explorer, Service Map, chat panel, and app container launch/window state.
- Extracted GraphQL relationship-type validation and mapping helpers from the monolithic resolver module.
- Extracted Tables route definitions and static registrations from the Tables route handler.
- Shared the reference typeahead component between Tables and Service Mapping, then added direct component behavior tests.

## P0 — Structural Risk Reduction

### Split the highest-risk large files

Problem: Several files now own too many responsibilities, making regressions likely and reviews slow.

Current largest hotspots:

- `apps/web/src/apps/admin-console/index.tsx`
- `apps/api/src/routes/admin.ts`
- `apps/web/src/apps/discovery/index.tsx`
- `apps/web/src/apps/tables/index.tsx`
- `apps/api/src/routes/tables.ts`
- `apps/api/src/graphql/resolvers.ts`
- `apps/web/src/apps/service-map/index.tsx`

Initial progress:

- `apps/api/src/graphql/relationshipTypes.ts` now owns relationship-type validation/mapping helpers.
- `apps/api/src/routes/tableDefinitions.ts` now owns table metadata types and static table registrations.
- `apps/web/src/components/ReferenceTypeahead.tsx` now owns the shared reference-field typeahead UI.

Plan:

1. Extract pure helpers first, with tests.
2. Split route registration from business services on API modules.
3. Split app shells from panels/forms/hooks on web modules.
4. Preserve behavior with focused tests before moving UI structure.

Acceptance criteria:

- No listed file remains above 1,500 lines, except where generated or intentionally aggregate.
- New helpers/services have direct unit tests.
- Public route and GraphQL behavior remains compatible.

### Modularize GraphQL schema and resolvers

Problem: CMDB, discovery, marketplace, preferences, CI classes, and relationship-type logic are centralized in one resolver module.

Plan:

1. Introduce domain resolver modules: `cmdb`, `ciClasses`, `discovery`, `preferences`, `marketplace`, `relationshipTypes`, `audit`.
2. Compose `typeDefs` and resolver maps in the GraphQL entrypoint.
3. Keep shared helpers for Neo4j parsing, permission checks, and relationship validation.

Acceptance criteria:

- `resolvers.ts` becomes composition/bootstrap glue.
- Domain modules can be tested independently.
- Permission behavior remains centralized and visible.

## P0 — Coverage Hardening

### Raise API coverage to 80%

Current biggest misses:

- `apps/api/src/routes/admin.ts`
- `apps/api/src/graphql/resolvers.ts`
- `apps/api/src/routes/tables.ts`
- `apps/api/src/services/appTools/changeManager.ts`
- `apps/api/src/services/chat.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/routes/discovery.ts`

Plan:

1. Backfill Admin route tests for user management, RBAC, environments, number sequences, credentials, and edge enrollment.
2. Split GraphQL resolvers by domain, then test domain modules directly.
3. Add Tables route tests for reference fields, import staging, audit, field RBAC, and typed values.
4. Add app-tool tests for incident, knowledge, prevention, and change manager branches.
5. Add chat service tests around Provara/OpenAI fallback errors, tool-call parsing, and streaming finalization.

Acceptance criteria:

- API statements, branches, functions, and lines all at or above 80%.
- Coverage thresholds ratchet upward with each sprint.
- Critical auth/discovery/tables/admin routes have negative-path tests.

### Expand web coverage beyond utility modules

Problem: Web coverage is high only because the configured scope is currently `src/lib/**/*.ts`.

Plan:

1. Add component tests for Settings, AppDock, AppLauncher, and ChatPanel.
2. Continue focused app tests for Service Map edit modal and CI Class Manager field editing.
3. Expand coverage include patterns once the first component test layer is stable.

Acceptance criteria:

- Web coverage includes `src/shell`, `src/components`, and selected critical apps.
- Settings, Dock, Service Map edit modal, and CI Class Manager field editing have regression tests.
- Coverage thresholds remain at or above 80 after scope expansion.

## P1 — Type Safety

### Reduce unsafe `any` usage

Problem: The codebase has broad `any` use in API routes, GraphQL resolvers, web app records, and app tools. This weakens strict TypeScript and lets schema/UI mismatches through.

Plan:

1. Define shared DTOs for CI class attributes, table definitions, reference options, discovery profiles, and app-tool payloads.
2. Replace `Record<string, any>` in touched modules with narrower types.
3. Add parser/normalizer functions at API boundaries instead of casting request bodies inline.

Acceptance criteria:

- New route modules do not introduce new `any` request/response shapes.
- Existing high-churn modules reduce unsafe casts as they are split.
- CI class and table field metadata use shared types across API and web.

## P1 — Browser State Isolation

### Move transient tab state out of `localStorage`

Problem: Some per-tab UI defaults are stored in shared browser storage, creating mild cross-tab context bleed.

Candidates:

- Service Map last root.
- Window geometry.
- Chat panel open/width.
- CMDB Explorer recent IDs.

Plan:

1. Keep auth, theme, and dock order global.
2. Move transient navigation/context state to `sessionStorage`.
3. Use explicit server preferences only for state users intentionally want shared across tabs.

Acceptance criteria:

- Opening Specora in multiple tabs does not cross-pollinate current map root, transient launch context, or active workspace defaults.
- Durable preferences remain shared.

## P1 — Planning Hygiene

### Keep roadmap debt current

Problem: Stale completed items in the roadmap make the backlog less trustworthy.

Plan:

1. Keep completed debt in `CHANGELOG.md` or sprint summaries, not active debt.
2. Review this document after every technical debt sprint.
3. Keep `ROADMAP.md` as summary; keep detailed debt work here.

Acceptance criteria:

- Active debt list contains only actionable unresolved work.
- Completed items have commit/release references.

## P2 — Platform Packaging and Generated Code

### Clarify experimental package primitives

Problem: Some package/entitlement primitives are seeded as placeholders.

Plan:

1. Mark experimental package tables and app surfaces clearly.
2. Decide whether package provisioning is a near-term platform primitive or later enterprise packaging work.

Acceptance criteria:

- Placeholder rows are either removed from production seed paths or documented as experimental.

### Document generated proto boundaries

Problem: Generated gRPC Python stubs appear in debt scans with default `NotImplemented` methods.

Plan:

1. Document generated files and regeneration command.
2. Exclude generated stubs from ad hoc debt scans and coverage expectations.

Acceptance criteria:

- Generated files are clearly marked in docs and tooling.
