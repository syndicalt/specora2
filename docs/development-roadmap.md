# Development Roadmap

**Status:** Working roadmap for upcoming development sprints
**Last updated:** 2026-04-27

Specora is currently a strong beta-quality platform with several high-value native applications, a coherent graph-first architecture, and enough demo depth to tell the product story. The next sprints should shift from broad feature creation toward polish, test depth, operability, and the few platform primitives needed before serious external demos.

## Current State

What is working well:

- Native app ecosystem is established across API registry, web shell, permissions, and app loading.
- Core ITSM suite is represented: Change, Incident, Knowledge, Prevention, Asset, Tables, Health, CMDB Explorer, Service Map, Discovery, and Admin Console.
- Customer Portal now provides the core self-service front door with catalog requests, AI intent resolution, and contextual support handoff primitives.
- Provara is back as the primary LLM router with tool-call support.
- CSDMv5-aligned seed data provides a connected 5,000-CI CMDB narrative.
- API route coverage is improving and currently passes at 375 tests.
- Optional premium app primitives exist, with IT Visibility DCIM as the first package-style example.
- DCIM now has persisted floorplans, racks, facility objects, and React Flow connection edges.

Known gaps:

- Browser E2E coverage now covers the demo spine and one DCIM floorplan write path; more critical write journeys are still needed.
- Several apps are demo/beta hybrids and need interaction polish before production claims.
- DCIM has enough concept depth to demo, but needs a dedicated polish pass for resize, connection editing, object deletion, floorplan controls, and richer physical inventory.
- Discovery is still an impressive concept but not yet a complete operational ETL system.
- Admin RBAC now has server-side field read/write enforcement for Tables, field restriction management, app/tool/table access explainers, drift detection, bulk grants, and searchable/exportable audit evidence.
- Package installation now has an authoritative server-side installation state and completed provisioning job audit trail; production entitlement/payment/rollback depth is still backlog work.
- The Next build cache/worker issue recurs and should be investigated separately from product work.
- Reporting is now API-first with governed datasets, RBAC-aware query/export endpoints, saved definitions, signed CSV exports, and audit events. KPI depth and BI integration examples remain roadmap work.
- Operability now includes runtime readiness, configuration audit, job queue summary/dead-letter/requeue endpoints, and supporting queue indexes. Worker heartbeat semantics, HA/DR drills, and release automation remain roadmap work.
- Release readiness now has `pnpm release:check` and `pnpm prod:ready` gates. Authentication now uses short-lived access tokens, rotating refresh sessions, OAuth provider hooks, and SSO discovery primitives.

## Sprint 1: Stabilize the Demo Spine

Goal: make the current platform reliable enough for repeated demos without manual repair.

Implemented:

- Added `pnpm validate:seed` for Neo4j/Postgres seed validation.
- Added `pnpm demo:ready` for the consolidated demo-readiness check.
- Added Playwright smoke coverage for launcher behavior and app-open surfaces across CMDB Explorer, Tables, Incident, Knowledge, and DCIM.
- Added a DCIM floorplan E2E path for create, edit, refresh verification, and cleanup.
- Added a recoverable bootstrap loading state with phase diagnostics and E2E coverage for authenticated home startup.

Priority work:

- Expand Playwright smoke tests from app-open checks into one happy write path for Tables.
- Fix or document the recurring Next stale dev-server artifact issue so production builds and E2E runs are repeatable.
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
- Added RBAC denial tests for new DCIM object and connection mutation routes.

Exit criteria:

- A user can create and maintain a basic room layout without needing seed-only objects.
- Cabling/power relationships can be created, edited, and removed.
- The floorplan feels deliberately designed, not like a generic graph canvas.

## Sprint 3: Discovery Builder Depth

Goal: make Discovery operationally useful instead of mostly a demo page.

RC boundary: Discovery remains beta/demo until this sprint's exit criteria are met. It should be shown as a promising builder-linker workflow, not represented as release-candidate operational discovery.

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

Implemented:

- Added app, tool, generic permission, and table/field access explainers.
- Added server-side field-level RBAC for Tables with `field:<tableId>.<fieldName>` read/write grants.
- Added Admin field restriction management for registered table fields.
- Added scoped grant catalog with descriptions, source, risk, and duplicate detection.
- Added bulk grant workflows for high-volume permission administration.
- Added policy drift detection comparing registered app/tool requirements against current grants.
- Added searchable audit review and signed CSV export from Admin Console.

Earlier implemented:

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
- Field-level RBAC is enforced server-side and explainable in Admin Console.
- Remaining package provisioning work is scoped as entitlement/progress/rollback depth, not app visibility architecture.

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
- Added audit integrity hardening: append-only audit triggers, SHA-256 hash chaining, serialized audit writes with PostgreSQL advisory locks, chain verification endpoint, Admin Console integrity status, and signed CSV export metadata.

Exit criteria:

- The repo can explain how to run, test, seed, deploy, back up, and operate the platform.
- External reviewers can distinguish implemented behavior from roadmap intent.

## Sprint 6: Tables Stewardship Cockpit

Goal: make Tables the universal operational stewardship surface, not a raw database browser.

Priority work:

- Add sharing scope for saved table views once team-level stewardship workflows are needed.
- Add richer bulk actions for assign owner and tag workflows.
- Add import primitives with clear limits and audit events.
- Add AI-assisted cleanup suggestions that explain evidence, confidence, and required approval.

Implemented:

- Added saved table view sort persistence with `sort_field` and `sort_direction`.
- Added RBAC-aware server-side sorting for CMDB-backed and Postgres-backed table records.
- Added sortable table headers, saved sort state, and paginated record navigation.
- Added loaded-record stewardship posture metrics and per-row validation badges for missing required/health-required data.
- Added authoritative server-side record validation snapshots, including missing required fields, health-required fields, and orphaned CMDB records.
- Added relationship-aware CMDB filters for connected/orphaned records, relationship type, and related CI ID.
- Added readable filter chips for current filters and saved view summaries, with one-click removal from the active filter strip.
- Added low-risk bulk update from selected rows, still routed through existing field-aware, audited record update endpoints.
- Added an audited bulk cleanup review queue for selected records, registered as a platform table for follow-up stewardship work.
- Preserved existing saved filters, column sets, density, inline edit, export, delete, and audit diff behavior.

Exit criteria:

- Tables feels like a serious admin/operator cockpit for stewardship at scale.
- A user can create a saved view, filter records, sort records, paginate results, adjust columns, edit a field, inspect the audit diff, bulk-update a safe field, and export the result.
- Every write remains RBAC-aware, field-aware, audited, and test-covered.

## Sprint 7: Reporting API Surface

Goal: provide enterprise-grade reporting data surfaces without building a weak clone of PowerBI/Tableau/Grafana.

Priority work:

- Define canonical reporting domains: Incident, Change, Request, Knowledge, CMDB health, Discovery, Asset, Audit, RBAC, and Operational Readiness.
- Add RBAC-aware reporting endpoints with stable JSON contracts and CSV export where appropriate.
- Add time-window, grouping, filter, and pagination conventions shared across reports.
- Add operational KPI endpoints for SLA risk, incident deflection, change collision risk, knowledge freshness, request backlog, CMDB completeness, and audit/security posture.
- Add metadata endpoints so external BI tools can discover dimensions, measures, filters, and refresh expectations.
- Add reporting API tests against seeded enterprise data.
- Document Grafana/PowerBI/Tableau integration patterns and recommended dashboards.

Implemented:

- Added `report_saved_definitions` for per-user saved report definitions.
- Added `reporting:read` and `reporting:write` permissions.
- Added canonical API datasets for Incidents, Changes, Catalog Requests, Knowledge, Assets, Discovery Jobs, and Audit Events.
- Added dataset metadata endpoints so clients can discover columns, filterability, groupability, and default grouping.
- Added shared query conventions for time windows, filters, grouping, pagination, JSON response, and CSV export.
- Added signed CSV export headers and audit events for report query/export activity.
- Added saved report create/update/delete endpoints with audit events.
- Added API tests for dataset listing, grouped queries, signed CSV export, saved report definitions, and RBAC denial.

Exit criteria:

- Specora can answer core enterprise reporting questions through APIs.
- External BI tools have stable surfaces to consume without scraping app UIs.
- Reporting remains governed by RBAC and does not bypass field/table restrictions.

## Sprint 8: Discovery RC Push

Goal: graduate Discovery from impressive beta/demo to a credible RC candidate.

Priority work:

- Add rollback records and rollback UI for committed discovery jobs.
- Add saved mapping profiles independent from individual pipelines.
- Add credential vault integration or a documented credential-provider abstraction.
- Add richer AI mapping explanations with per-field rationale, confidence, and deterministic fallback.
- Move heavier connector execution to worker-backed jobs as real connectors arrive.
- Add better reconciliation previews: create/update/skip, relationship orphan handling, ambiguous match handling, and dependency impact.
- Integrate the `specora-edge` source/relay architecture as a first-class Discovery source path when the edge repo matures.

Exit criteria:

- A user can configure a source, map data, preview, stage, approve, commit, and rollback with coherent audit history.
- Discovery errors are actionable and tied to source, transform, credential, or reconciliation stage.
- Discovery can be described as RC-ready for controlled environments, with edge/agent work clearly bounded if still external.

## Sprint 9: Operability And Scale Hardening

Goal: make the platform credible under external technical review and production-readiness discussion.

Priority work:

- Rehearse full backup and restore with Postgres, Neo4j, uploads, migrations, and validation commands.
- Add production health checks for worker and deeper API dependency health.
- Define Redis-backed multi-instance behavior for event subscriptions, RBAC/field restriction cache invalidation, websocket state, and rate-limit state.
- Expand enterprise SSO from discovery/start primitives into full SAML/OIDC assertion validation when an IdP target is selected.
- Investigate and resolve or permanently document the recurring Next `.next` build artifact issue.
- Add release checklist automation: migrate status, seed validation, demo readiness, E2E smoke, and artifact cleanup.
- Document HA/DR topology options and minimum production deployment patterns.
- Add audit-head external anchoring design for high-compliance deployments.

Implemented:

- Added `/ready` and `/api/health/ready` readiness endpoints for PostgreSQL, Neo4j, Redis, worker configuration, and LLM configuration.
- Added authenticated `/api/health/config` for production configuration posture without exposing secret values.
- Added queue posture endpoints: `/api/jobs/summary`, `/api/jobs/dead-letter`, and `/api/jobs/requeue-stale`.
- Added bounded job listing limits and safer status filtering.
- Added stale running job requeue behavior with retry/dead-letter transition semantics.
- Added PostgreSQL indexes for job status, stale running jobs, and dead-letter review.
- Updated deployment operations docs with readiness, config audit, and job queue runbooks.
- Added focused API/service tests for readiness, config audit, queue summary, dead-letter, and stale requeue behavior.
- Added `scripts/release-check.sh` with fast/full modes for artifact cleanup, migration status/dry-run, typechecks, tests, builds, seed validation, and browser E2E.
- Added root scripts `pnpm release:check` and `pnpm prod:ready`.
- Documented release-readiness flags for dirty worktree enforcement, builds, seed validation, E2E, managed Playwright servers, and Next cache cleanup.
- Added short-lived access tokens, PostgreSQL-backed refresh sessions with hashed opaque tokens, refresh rotation, logout, session listing, session revocation, invalid/reuse audit events, and browser auto-refresh on 401.
- Added configured Google/GitHub OAuth login primitives plus enterprise SSO domain discovery/start routes.
- Added Identity Provider administration in Admin Console with multi-provider SAML/OIDC configuration, domain discovery, JIT/default-role settings, SSO enforcement, and mutation audit events.
- Hardened auth callbacks with one-time handoff codes, access-token session revocation checks, same-origin return handling, OIDC callback exchange/userinfo retrieval, and SP-initiated SAML login with ACS validation for RelayState, issuer, audience, recipient, assertion timing, JIT policy, and mapped identity/group claims.
- Added identity groups, memberships, group-based RBAC inheritance, inherited access explanations, OIDC group-claim synchronization, SAML metadata XML storage/parsing, and copyable SAML SP ACS/Entity ID values in Admin Console.

Exit criteria:

- A fresh environment can be migrated, restored, validated, and smoke-tested from docs.
- The multi-instance path is clear enough to implement without architectural rework.
- Production-readiness gaps are specific, testable, and visible to operators.

## Backlog Themes

Important but not next-sprint critical:

- Review form-heavy surfaces against the north-star philosophy. Tables, Admin, Discovery, and DCIM should keep precise structured editors, but the primary ITSM flows should favor evidence-created records, AI-drafted proposals, review queues, and stewardship tables over blank-form creation. The current baseline is captured in [Form Surface Review](form-surface-review.md).
- Evolve the Tables application into the universal stewardship cockpit: saved views, advanced filters, column sets, inline edit, bulk actions, audit diffs, validation state, export/import, relationship-aware filtering, and AI-assisted explanation or cleanup.
- Add condition-based record access policies when there is a concrete use case and a testable explain-access model.
- Expand Customer Portal into Specora Engage: multiple portals, audience targeting, per-portal branding/navigation, analytics, campaigns, AI optimization, and advanced support/call-routing adapters.
- Upgrade `reactflow` v11 to current `@xyflow/react` and standardize graph components across Service Map, Discovery, Impact Graph, and DCIM.
- Replace the DCIM floorplan prototype with a dedicated spatial canvas engine when DCIM becomes an active sprint again; React Flow should remain for topology/relationship diagrams, not CAD-like floorplan editing.
- Add iframe bridge or explicitly deprecate iframe fallback for external apps.
- Add mobile primitives for ITAM scanning and future DCIM field work.
- Expand CSDMv5 foundation classes: company, department, business unit, cost center, product model, contracts, offerings, SLAs.
- Add knowledge freshness automation that turns stale articles into stewarded tasks.
- Add incident prevention automation that opens prevention candidates from repeated incident patterns.
- Add advanced DCIM facility modeling only when needed: imported floorplan images, CAD-like walls, zones, elevations, and environmental telemetry overlays.
- Add production-grade SAML XML signature validation with canonicalization and IdP certificate verification, deepen IdP metadata ingestion, add OIDC ID-token/JWKS validation, and add advanced group-to-role mapping.

## Product Direction Guardrails

- Specialized apps should own high-value workflows; Tables should remain the general-purpose fallback.
- AI should act through explicit RBAC-aware tools and leave durable audit trails.
- CSDM alignment should improve workflow quality, not become table-parity theater.
- Demo data should continue to tell cross-app operational stories.
- Production-grade claims require E2E coverage, server-side authorization, useful error states, and documented operational behavior.
