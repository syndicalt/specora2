# Development Roadmap

**Status:** Working roadmap for upcoming development sprints
**Last updated:** 2026-04-26

Specora is currently a strong beta-quality platform with several high-value native applications, a coherent graph-first architecture, and enough demo depth to tell the product story. The next sprints should shift from broad feature creation toward polish, test depth, operability, and the few platform primitives needed before serious external demos.

## Current State

What is working well:

- Native app ecosystem is established across API registry, web shell, permissions, and app loading.
- Core ITSM suite is represented: Change, Incident, Knowledge, Prevention, Asset, Tables, Health, CMDB Explorer, Service Map, Discovery, and Admin Console.
- Provara is back as the primary LLM router with tool-call support.
- CSDMv5-aligned seed data provides a connected 5,000-CI CMDB narrative.
- API route coverage is improving and currently passes at 333 tests.
- Optional premium app primitives exist, with IT Visibility DCIM as the first package-style example.
- DCIM now has persisted floorplans, racks, facility objects, and React Flow connection edges.

Known gaps:

- Browser E2E coverage now covers the demo spine and one DCIM floorplan write path; more critical write journeys are still needed.
- Several apps are demo/beta hybrids and need interaction polish before production claims.
- DCIM has enough concept depth to demo, but needs a dedicated polish pass for resize, connection editing, object deletion, floorplan controls, and richer physical inventory.
- Discovery is still an impressive concept but not yet a complete operational ETL system.
- Admin RBAC is improving but lacks field-level and conditional policy enforcement.
- Package installation now has an authoritative server-side installation state and completed provisioning job audit trail; production entitlement/payment/rollback depth is still backlog work.
- The Next build cache/worker issue recurs and should be investigated separately from product work.

## Sprint 1: Stabilize the Demo Spine

Goal: make the current platform reliable enough for repeated demos without manual repair.

Implemented:

- Added `pnpm validate:seed` for Neo4j/Postgres seed validation.
- Added `pnpm demo:ready` for the consolidated demo-readiness check.
- Added Playwright smoke coverage for launcher behavior and app-open surfaces across CMDB Explorer, Tables, Incident, Knowledge, and DCIM.
- Added a DCIM floorplan E2E path for create, edit, refresh verification, and cleanup.

Priority work:

- Expand Playwright smoke tests from app-open checks into one happy write path for Tables.
- Fix or document the recurring Next `.next` build artifact issue so production builds are repeatable.
- Extend seed validation as new package apps add required demo data.
- Keep `pnpm demo:ready` current as the canonical demo readiness command.
- Review app launcher/dock behavior on common screen sizes.

Exit criteria:

- A fresh local stack can be started, seeded, and smoke-tested with one documented flow.
- No known page blocks normal navigation to primary apps.
- Demo scripts do not depend on hidden manual DB repair.

## Sprint 2: DCIM and IT Visibility Polish

Goal: turn DCIM from a strong concept demo into a credible product slice.

Priority work:

- Add rack detail drill-in from floorplan to RU layout, assets, events, and power paths.
- Add higher-fidelity physical inventory views for power chains, cooling zones, network cabling, and device placement.
- Add richer connection semantics for power A/B, network copper/fiber, cooling influence, and monitoring/sensor dependencies.
- Add floorplan object resize handles and rotation controls directly on canvas, not only in the inspector.
- Add route/UI coverage for rack creation, object movement, connection creation, and delete workflows.

Implemented:

- Added floorplan object resize and rotation persistence through the inspector.
- Added create/update/delete APIs for facility floorplan objects.
- Added edit/delete workflows for floorplan connections.
- Added object palette for rack, UPS/PDU, CRAC, patch panel, sensor, and aisle markers.
- Added typed connection visual semantics for power, network, cooling, and monitoring edges.
- Added focused DCIM route tests for object and connection create/update/delete paths.
- Added browser E2E coverage for creating, editing, refreshing, verifying, and cleaning up a DCIM floorplan object.
- Add RBAC denial tests for new DCIM object and connection mutation routes.

Exit criteria:

- A user can create and maintain a basic room layout without needing seed-only objects.
- Cabling/power relationships can be created, edited, and removed.
- The floorplan feels deliberately designed, not like a generic graph canvas.

## Sprint 3: Discovery Builder Depth

Goal: make Discovery operationally useful instead of mostly a demo page.

Priority work:

- Add rollback records and rollback UI for committed discovery jobs.
- Move heavier connector execution to the worker when real connectors arrive.
- Add credential vault integration instead of placeholder credential refs.
- Add saved mapping profiles independent from individual pipelines.
- Add richer AI mapping explanations and per-field rationale drilldowns.

Implemented:

- Added pipeline versioning, published definitions, last-published timestamps, and last-run tracking.
- Connected source configuration to builder execution with type-aware CSV/manual source forms and placeholder API/database/cloud config.
- Added source health primitives: test source, last tested time, last status, and last error.
- Added publish semantics so scheduled/manual runs can use a stable published definition.
- Added staged record approval and skip actions before commit.
- Added source-to-preview-to-publish-to-stage-to-commit E2E coverage.
- Added focused API tests for publish, delete, source health, approve-safe, and skip status paths.

Exit criteria:

- A user can configure a source, build a transform, preview records, and stage/commit records through a coherent path.
- Discovery failures surface actionable errors instead of generic toasts.

## Sprint 4: Admin, RBAC, and Package Provisioning

Goal: make platform administration teachable and troubleshootable.

Priority work:

- Expand Access Analyzer to explain app, route, table, record, and planned field decisions.
- Design and document field-level restriction primitives.
- Add registry views for apps, tables, record types, number sequences, admin panels, chat tools, and package hooks.
- Add rollback hooks, entitlement checks, and long-running package validation states when real paid package distribution arrives.

Implemented:

- Added `app_installations` and `app_provisioning_jobs` as the server-side source of truth for optional package installation state.
- Updated the server app registry so core native apps remain always installed while optional/package apps require an installed server row.
- Added RBAC-protected package catalog, install, uninstall, and provisioning-job endpoints.
- Updated Arc to read the server catalog and perform optional package install/uninstall through API calls instead of local-only toggles.
- Added an Admin Console Package Provisioning panel showing recent install/uninstall jobs.
- Seeded IT Visibility DCIM as an installed optional package so current demos keep working.
- Added route tests for catalog status, install job creation, and blocking uninstall of core platform apps.

Exit criteria:

- Admins can understand why a user can or cannot access an app/action.
- Optional packages no longer rely on local-only install state.
- Roadmap ACL primitives are designed clearly enough to implement.

## Sprint 5: Quality, Operability, and Documentation Hardening

Goal: prepare the platform for external technical review.

Priority work:

- Raise API coverage by targeting high-risk routes and app tools, not by low-value line chasing.
- Add deployment, backup, restore, and scaling docs.
- Expand audit consistency beyond current high-value coverage to every native mutation route.
- Split app tool handlers by application where the current monolithic surfaces are hard to reason about.
- Add production configuration guidance for Redis, Provara, OpenAI fallback, Neo4j, Postgres, and worker.
- Reassess the platform marking sheet after E2E and operability work.

Implemented:

- Added browser E2E coverage for the Tables CMDB write path: select table, choose columns, create a Location record, filter/search it, edit it, verify updated attributes, and delete it.
- Added browser E2E coverage for the Admin Access Analyzer: open Admin Console, analyze `security_admin` access to `rbac:read`, and verify the decision trace.
- Improved Admin Console select controls with associated labels so the RBAC analyzer is easier to operate and test.
- Added browser E2E coverage for optional package provisioning: uninstall IT Visibility DCIM through Arc, reinstall it through Discover, and verify install/uninstall jobs in Admin Console.
- Added deployment/operations documentation covering runtime topology, environment variables, health checks, startup order, migration caveats, scaling notes, and production gaps.
- Added backup/restore documentation covering PostgreSQL, Neo4j, discovery uploads, configuration restore, consistency limits, and restore validation.
- Added a platform audit contract and `recordAuditEvent()` helper for consistent server-side mutation audit events.
- Added audit coverage for Arc package provisioning, Admin RBAC/number-sequence changes, generic Tables writes, app tool execution/queue/denial/failure outcomes, and Incident automation workflows.
- Added focused API tests for the new audit coverage on high-risk route surfaces.
- Extracted app-tool authorization and audit construction into a dedicated policy module so REST, queued, and future chat execution paths share the same resource/action/result semantics.
- Added audit coverage for Admin system property and state-machine configuration mutations.
- Added remaining native app mutation audit coverage across Change, Knowledge, Asset, Prevention, Discovery, Data Foundations, and IT Visibility DCIM server routes.
- Added a PostgreSQL migration runner with `schema_migrations` tracking, checksum enforcement, dry-run/status commands, and one-time baseline support for existing environments.
- Added root migration scripts so deployment operators can run `pnpm migrate:status`, `pnpm migrate:dry-run`, `pnpm migrate`, and `pnpm migrate:baseline` without knowing package internals.

Exit criteria:

- The repo can explain how to run, test, seed, deploy, back up, and operate the platform.
- External reviewers can distinguish implemented behavior from roadmap intent.

## Backlog Themes

Important but not next-sprint critical:

- Upgrade `reactflow` v11 to current `@xyflow/react` and standardize graph components across Service Map, Discovery, Impact Graph, and DCIM.
- Replace the DCIM floorplan prototype with a dedicated spatial canvas engine when DCIM becomes an active sprint again; React Flow should remain for topology/relationship diagrams, not CAD-like floorplan editing.
- Add iframe bridge or explicitly deprecate iframe fallback for external apps.
- Add mobile primitives for ITAM scanning and future DCIM field work.
- Expand CSDMv5 foundation classes: company, department, business unit, cost center, product model, contracts, offerings, SLAs.
- Add knowledge freshness automation that turns stale articles into stewarded tasks.
- Add incident prevention automation that opens prevention candidates from repeated incident patterns.
- Add advanced DCIM facility modeling only when needed: imported floorplan images, CAD-like walls, zones, elevations, and environmental telemetry overlays.

## Product Direction Guardrails

- Specialized apps should own high-value workflows; Tables should remain the general-purpose fallback.
- AI should act through explicit RBAC-aware tools and leave durable audit trails.
- CSDM alignment should improve workflow quality, not become table-parity theater.
- Demo data should continue to tell cross-app operational stories.
- Production-grade claims require E2E coverage, server-side authorization, useful error states, and documented operational behavior.
