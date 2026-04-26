# Native Application Catalog

**Status:** Current built-in app inventory
**Last updated:** 2026-04-26

Specora applications are native platform modules registered through the server app registry and mirrored to the web shell registry. Native apps are installed with the platform and exposed to users through RBAC.

## Application Pattern

Every native app should have:

- Stable `id`
- Human-readable `name`
- Icon from the shared app icon map
- Declared permissions
- Default render mode: `canvas` or `window`
- Optional chat capabilities
- Optional app tools
- Optional event subscriptions
- RBAC-aware API routes when it owns workflow state

## Core Platform Apps

### Specora Arc

Purpose: marketplace and app ecosystem management.

Current capabilities:

- View installed apps
- Discover server-visible optional packages
- Review marketplace submissions
- Install approved external apps
- Install and uninstall optional package apps through server provisioning endpoints
- Use shared icon map

Architecture role:

- Demonstrates the platform-as-app-ecosystem model.
- Owns app discovery and marketplace UX.
- Uses the API catalog as the authoritative source for package install state.

Maturity: beta.

### Admin Console

Purpose: platform administration.

Current capabilities:

- RBAC management
- Access Analyzer for RBAC troubleshooting
- Number sequence registry
- System properties
- Change Manager state-machine panel integration
- Package provisioning job visibility

Architecture role:

- Centralizes privileged configuration.
- Exposes server-governed administrative capabilities.
- Gives admins a single teachable surface for platform registries and operational controls.

Maturity: beta.

### Audit Log

Purpose: inspect platform mutation history.

Current capabilities:

- View CMDB mutation audit trail
- Track operational changes emitted by server routes
- Track package provisioning, admin mutations including RBAC and system properties, app tool execution outcomes, generic Tables writes, native app mutation routes, and automation actions across ITSM/ITAM/Discovery/DCIM

Architecture role:

- Supports accountability and AI/tool-call auditability.

Maturity: alpha/beta.

### Settings

Purpose: user profile and workspace preferences.

Current capabilities:

- User preference management
- Dock and shell preference support

Architecture role:

- Keeps shell behavior user-specific without making every app own preference storage.

Maturity: basic.

### Hello World

Purpose: native app template and installation smoke test.

Current capabilities:

- Minimal installed app behavior
- Useful for validating native app loading

Architecture role:

- Developer reference app.

Maturity: sample.

## CMDB and Data Apps

### Service Map

Purpose: visual dependency mapping.

Current capabilities:

- React Flow graph visualization
- Service and CI expansion
- View/edit CI details
- Collision-aware layout improvements
- Save and restore graph views
- Cross-app launch from CMDB Explorer

Architecture role:

- The primary graph visualization surface.
- Demonstrates why CMDB data belongs in Neo4j.

Maturity: strong beta.

### CMDB Explorer

Purpose: high-utility CMDB investigation workspace.

Current capabilities:

- Search and filter CIs
- Inspect health, relationships, attributes, and activity
- Launch related Service Map and Tables workflows
- Dock-aware detail layout
- Styled scroll surfaces

Architecture role:

- Default pinned app candidate.
- Provides the investigative surface for incident, change, health, and data quality workflows.

Maturity: strong beta.

### CI Class Manager

Purpose: manage CI class definitions and attributes.

Current capabilities:

- Define CI classes
- Define class attributes
- Store display names, icons, colors, and health-relevant attributes
- Feed Tables and CMDB views

Architecture role:

- Makes the CMDB schema evolvable without code-only class creation.

Maturity: beta.

### Tables

Purpose: RBAC-aware table workbench.

Current capabilities:

- Lists CMDB class tables and allowlisted Postgres operational tables
- Buildable filters
- Column picker
- CRUD for CMDB class records
- CRUD for registered Postgres operational records

Architecture role:

- General-purpose data steward workbench.
- Complements specialized apps without replacing them.

Maturity: beta.

### Data Foundations

Purpose: foundation data quality and CSDM readiness.

Current capabilities:

- Summarizes foundation tables
- Highlights completeness and stewardship gaps
- Links toward Tables for editing

Architecture role:

- Encourages CSDM discipline before workflow data becomes unreliable.

Maturity: alpha/beta.

## ITSM Apps

### Change Manager

Purpose: Change Command Center.

Current capabilities:

- RFC creation, editing, deletion, approval, rejection
- CAB workbench concepts
- Risk score and blast radius
- Planned change windows
- Conflict detection
- Critical path and impact summary
- Automation endpoints for CI/CD and external workflows
- Chat tools for change planning

Architecture role:

- Demonstrates graph-aware change management.
- Connects CMDB dependency context to approval decisions.

Maturity: strong beta.

### Incident Command Center

Purpose: AI-first incident management.

Current capabilities:

- External signal ingestion
- Incident creation and triage
- AI confidence, summary, next action, and decision tracking
- Remediation recommendations
- Approval and execution workflow
- Postmortem generation
- Related CIs and changes
- Automation endpoints for external processes

Architecture role:

- Shows the product thesis that human incident handling should be a last resort, not the default.

Maturity: strong beta.

### Knowledge Core

Purpose: AI-governed knowledge orchestrator.

Current capabilities:

- Knowledge items, runbooks, known errors, decisions, and service guides
- Answer endpoint with citations and confidence
- Knowledge gap capture
- Drafting from operational records
- Feedback and lifecycle events
- Governance signals

Architecture role:

- Turns solved work into reusable platform memory.
- Connects Incident, Change, Prevention, and Chat.

Maturity: beta.

### Prevention Center

Purpose: reliability prevention engine, replacing low-value Problem Management with measurable prevention work.

Current capabilities:

- Prevention candidates
- Evidence from incidents and knowledge
- Corrective actions
- Status transitions
- Verified reduction and estimated hours saved
- Known-error linkage

Architecture role:

- Makes recurring problems actionable and measurable.

Maturity: beta.

## ITOM, Discovery, Health, and ITAM Apps

### Discovery

Purpose: builder-linker discovery and ETL.

Current capabilities:

- Type-aware source management for CSV/manual samples, plus API/database/cloud placeholders
- Source health tracking with test status, last-tested time, and last error
- Versioned pipeline builder with draft and published definitions
- Transform preview with create/review records, warnings, errors, and relationship candidates
- Class routing and field mapping concepts
- AI-assisted transform direction
- Staged discovery runs with approve-safe, skip, and commit controls
- Scheduler metadata for enabled interval, next run, last run, and last status
- E2E-covered source-to-CMDB commit workflow

Architecture role:

- Entry point for external data into the CMDB.
- Should evolve into a friendly ETL builder for infrastructure and service data.

Maturity: beta.

### Discovery Insights

Purpose: discovery coverage intelligence.

Current capabilities:

- Coverage model
- Blind spots
- Stale CI reporting
- Pipeline context
- Next scan suggestions

Architecture role:

- Turns discovery from ingestion into a continuous coverage program.

Maturity: alpha/beta.

### Health Monitor

Purpose: CMDB and CI health command center.

Current capabilities:

- Health scores
- Findings
- Rule generation
- Remediation actions
- Stale, orphaned, cyclic, and incomplete data signals
- Chat integration through health tools

Architecture role:

- Proactively surfaces or fixes CMDB quality issues.

Maturity: strong beta.

### Asset Command Center

Purpose: AI-first ITAM for HAM and SAM.

Current capabilities:

- Asset records
- Contracts
- Software entitlements
- Software usage
- Contract ingestion
- SAM reconciliation
- Asset scan evidence
- Asset exceptions
- Automation endpoints for procurement and discovery integrations

Architecture role:

- Connects financial/lifecycle asset data to operational CIs.
- Provides the foundation for future mobile scanning and contract AI workflows.

Maturity: beta.

### IT Visibility DCIM

Purpose: optional premium DCIM command center for datacenter visibility, rack planning, facility events, and physical topology.

Current capabilities:

- Optional premium app package metadata and server-side install/uninstall path through Arc
- DCIM sites, rooms, racks, assets, power paths, events, floorplans, and floorplan connections
- React Flow floorplan workspace with racks and facility objects as nodes
- Power, cooling, and network relationships as persisted edges
- Rack creation and rack attribute editing
- Facility object creation through a floorplan palette
- Floorplan object label, footprint, and rotation editing
- Floorplan object removal for non-seed layout maintenance
- Connection inspector for relationship label, type, status, and deletion
- Bounded, snap-grid rack and facility-object movement
- Placement planning for RU, power, weight, and redundancy
- Rack assignment endpoint for deployment or ITAM integrations
- External event ingestion endpoint for PDU, sensor, pipeline, or facility signals

Architecture role:

- Extends the IT Visibility package beyond CMDB topology into physical infrastructure.
- Demonstrates how optional package apps can own data, routes, UI, and premium entitlement metadata without being core-platform bundled.
- Provides the future integration point for ITAM, Event Management, deployment pipelines, mobile scanning, and facility telemetry.

Maturity: demo/beta hybrid.

## App Integration Standards

New native apps should follow these standards:

- Register in the server app registry.
- Register in the web built-in app loader.
- Use a distinct app icon from `APP_ICONS`.
- Declare permissions narrowly.
- Use `shell.fetch`, `shell.query`, or `shell.mutate` instead of direct global auth access where possible.
- Use server routes for workflow state.
- Use GraphQL for CMDB CRUD.
- Emit events for important lifecycle changes.
- Add route tests and tool tests.
- Add seed data if the app needs demo context.

## Current Native App IDs

| App | ID | Primary data |
| --- | --- | --- |
| Admin Console | `admin-console` | PostgreSQL/system properties |
| Asset Command Center | `asset-command` | PostgreSQL + CI references |
| Audit Log | `audit-log` | PostgreSQL |
| Change Manager | `change-manager` | PostgreSQL + CI references |
| CI Class Manager | `ci-class-manager` | PostgreSQL class definitions |
| CMDB Explorer | `cmdb-explorer` | Neo4j |
| Data Foundations | `data-foundations` | PostgreSQL + Neo4j summary |
| Discovery | `discovery` | PostgreSQL + Worker + Neo4j |
| Discovery Insights | `discovery-insights` | PostgreSQL + Neo4j |
| Health Monitor | `health-monitor` | Neo4j + rules |
| Hello World | `hello-world` | None/sample |
| Incident Command Center | `incident-manager` | PostgreSQL + CI references |
| IT Visibility DCIM | `it-visibility-dcim` | PostgreSQL + CI references |
| Knowledge Core | `knowledge-core` | PostgreSQL + CI references |
| Prevention Center | `prevention-center` | PostgreSQL + CI references |
| Service Map | `service-map` | Neo4j + saved views |
| Settings | `settings` | User preferences |
| Specora Arc | `arc` | Marketplace registry |
| Tables | `tables` | Neo4j + PostgreSQL |
