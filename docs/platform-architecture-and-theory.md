# Specora Platform Architecture and Theory

**Status:** Current platform guide
**Audience:** Engineers, product owners, implementers, architects, and LLM coding agents
**Last updated:** 2026-04-26

Specora is an AI-native ITSM and operations platform built around a graph CMDB, native applications, RBAC-aware automation endpoints, and a conversational control plane. The core architectural thesis is that ITSM should not be a set of disconnected ticket queues. It should be an operating system for service reliability, where data, relationships, automation, and human decision points share the same model.

## Product Thesis

Specora is built on five ideas:

1. The CMDB is a graph, not a spreadsheet.
2. Service management workflows should be driven by context, not form completion.
3. AI should do bounded operational work through explicit tools, not free-form hidden actions.
4. Native applications should be first-class platform capabilities, installed server-side and controlled through RBAC.
5. The data model should make prevention and self-healing easier than escalation.

The product goal is not to clone existing ITSM suites. The goal is to reduce the amount of human attention required to keep services healthy, while giving operators better command surfaces when a human decision is required.

## North-Star Operating Philosophy

### Low-Friction Engineering, Not Low-Code Sprawl

Specora should not become a generic low-code/no-code platform. Broad low-code/no-code systems often create opaque business logic, hidden runtime scripts, unreviewed table mutations, and per-customer snowflake behavior that is difficult to test, govern, and troubleshoot.

The platform direction is code-first for serious extension and configuration-first for bounded administration:

- Native applications are React/TypeScript platform modules.
- External applications integrate through manifests, explicit permissions, APIs, events, and chat tools.
- Common administrative behavior should be represented as declarative, versionable artifacts where possible.
- AI can help scaffold and modify real code, but production behavior should remain reviewable, testable, observable, and auditable.
- Declarative builders are appropriate when the domain is narrow and governed, such as Discovery mappings, state machines, RBAC grants, table views, data quality rules, dashboards, and notifications.

Specora should be low-friction engineering, not visual-programming sprawl.

### Conversation-First And Evidence-First, Not Form-First

Specora should reduce reliance on blank-form creation, but it should not eliminate structured forms or tables.

The preferred workflow is:

1. Evidence creates records.
2. AI explains context and drafts structured proposals.
3. Humans govern deltas by approving, rejecting, editing, merging, assigning, or escalating.
4. Forms act as precise fallback editors for corrections and exceptions.
5. Tables act as stewardship surfaces for visibility, filtering, bulk review, governance, and audit.

This means users should not normally start important work by filling out blank forms. Incidents should be created from alerts, conversations, events, or integrations. Changes should be drafted from deployments and affected CIs. Knowledge should be produced from resolutions and evidence. Discovery should stage normalized observations before mutating the CMDB.

Forms remain necessary for accessibility, auditability, exception handling, data stewardship, regulated workflows, and users who need precise structured control. Tables remain strategically important because administrators and operators need to inspect truth at scale.

The Tables application should therefore evolve into a universal stewardship cockpit with saved views, advanced filters, column sets, inline edit, bulk actions, audit diffs, validation state, export/import, relationship-aware filtering, and AI-assisted explanation or cleanup. This supports the evidence-first philosophy without forcing the platform back into a form-first model.

## System Overview

```text
Browser / Next.js Shell
  |
  | GraphQL, REST app tools, WebSocket events
  v
Fastify API
  |             |
  | Cypher      | SQL
  v             v
Neo4j CMDB     PostgreSQL Operations Store
  |
  | gRPC jobs / ingestion
  v
Python Worker

LLM Routing:
Browser chat -> API chat route -> Provara primary / OpenAI fallback -> tool calls
```

## Major Components

### Web Shell

The web shell is a Next.js 14 App Router application. It provides:

- App dock and launcher
- Canvas and window rendering modes
- Dormant app state preservation
- Permission-filtered `ShellAPI`
- Cross-app message bus
- Right-side chat panel
- WebSocket event consumption
- Built-in and external app loading

Native apps are loaded through dynamic imports in `apps/web/src/shell/AppContainers.tsx`. External apps can be loaded through ESM URLs, with iframe fallback for non-native delivery models.

### API

The API is a Fastify server with:

- GraphQL Yoga for CMDB CRUD and graph operations
- REST routes for native app automation
- JWT authentication
- RBAC checks
- App registry
- App tool registry
- Event bus
- WebSocket endpoint
- Redis-backed multi-instance event propagation
- PostgreSQL and Neo4j plugins

The API is intentionally the enforcement boundary. Browser apps can present rich workflows, but server routes must own authorization, persistence rules, and safe execution.

### Neo4j

Neo4j stores CSDM-aligned Configuration Items and relationships. This is the system of record for graph topology:

- Configuration items
- Service dependencies
- Ownership
- Hosting
- Management responsibility
- Location relationships

Cypher must use parameters. Relationship types are validated against an allowlist.

### PostgreSQL

PostgreSQL stores operational state that is not graph topology:

- Users and preferences
- App marketplace and registry metadata
- Saved views
- Audit log
- Event persistence
- Job queue
- Change requests
- Incidents
- Knowledge records
- Prevention records
- Asset and SAM records
- Discovery sources and pipelines
- DCIM sites, rooms, racks, assets, floorplans, facility events, power paths, and floorplan connections

This split keeps graph traversal fast and semantically clean while preserving relational integrity for workflow data.

### Worker

The worker is a Python 3.12 asyncio gRPC service. It handles ingestion and background tasks that should not block the API request path. The worker is the natural home for future long-running discovery, enrichment, reconciliation, and remediation jobs.

### AI Layer

Provara is the primary model router. Direct OpenAI access is retained as a fallback. The API exposes tools to the model through a controlled registry.

The LLM is not a database and not an authorization boundary. It can suggest, summarize, transform, and call registered tools. The API decides whether the tool is allowed and what it can change.

## Architectural Theories

### Graph-First CMDB

IT operations questions are often relationship questions:

- What depends on this?
- What changed near this service?
- What is the blast radius?
- Which business services are impacted?
- Which owners and groups are accountable?

Relational schemas can represent these questions, but graph traversal is the natural primitive. Neo4j is used because dependency paths, neighborhoods, impact analysis, and service maps are core product behavior, not secondary reports.

Tradeoff: transactional workflow state is less natural in a graph. Specora uses PostgreSQL for workflow records and keeps graph IDs as references.

### CSDM as the Operating Grammar

CSDM gives the CMDB a shared vocabulary. Specora uses CSDM concepts to avoid arbitrary CI sprawl:

- Business service
- Application service
- Technical service
- Application
- Infrastructure components
- Foundation data

The goal is not to recreate every ServiceNow table. The goal is to preserve the service modeling discipline that makes ITSM workflows useful.

### Native Apps as Platform Modules

Specora Arc treats applications as platform modules. Apps declare:

- Identity
- Permissions
- Default render mode
- Chat capabilities
- Tool surfaces
- Event interests

Native apps are installed with the platform. External apps are supported, but native apps are the default for core ITSM functionality because they require deep integration with RBAC, eventing, automation, and shared data.

### Server-Side Installation and RBAC

Platform apps should be installed server-side and made visible to users through RBAC. Client-side registry caching exists for responsiveness and offline-friendly shell behavior, but the authoritative app list comes from the API.

This matters because apps expose automation and data access. Installed apps are not just UI tiles; they are capability bundles.

### Package Installation Roadmap

Current install behavior is intentionally lightweight but server-owned. For native and package-native apps, the code and migrations are already present in the deployed platform, so install/uninstall primarily changes the authoritative `app_installations` row and records a completed `app_provisioning_jobs` audit row. The browser reads the API catalog and no longer owns optional package state locally.

This is a good development-stage primitive because it proves that app visibility is controlled by the API and RBAC, not by a client-side tile. It is still not the final premium app architecture.

Backlog work for production package installation:

- Expand package installation jobs beyond immediate completion into statuses such as pending, validating, provisioning, completed, failed, and rolled back.
- Check package entitlement, tenant eligibility, license limits, and payment/subscription state before provisioning.
- Apply package migrations or activation steps idempotently.
- Register app permissions, counters, admin panels, chat tools, event subscriptions, and automation endpoints as part of installation.
- Support optional seed/demo data during install without forcing demo data into production tenants.
- Emit audit log events for install, uninstall, entitlement changes, provisioning failures, and rollback.
- Expose install progress in Arc for long-running package provisioning.
- Provide rollback/repair operations for partially installed packages.
- Distinguish package uninstall from data removal, with explicit retention/export/delete choices.

The intended model is that package installation becomes an auditable, recoverable provisioning workflow, not a client-side registry mutation.

### Conversational Control Plane

Chat is not a novelty layer. It is a control plane:

- Find data across apps
- Invoke workflows
- Summarize operational context
- Draft knowledge
- Orchestrate CAB work
- Triage incidents
- Explain health and discovery gaps

The right-side chat panel keeps the assistant available beside the work surface instead of forcing users into a separate chatbot product.

### AI With Explicit Tools

Specora avoids hidden autonomous behavior. AI actions happen through named tools with schemas, RBAC checks, and server-side handlers.

This keeps AI useful but auditable:

- The model receives a constrained tool list.
- Tool arguments are structured.
- The API injects user context.
- The route checks permissions.
- Results can emit events and write audit trails.

### Prevention Over Escalation

Traditional ITSM often optimizes ticket routing after failure. Specora optimizes earlier:

- Detect data quality problems.
- Detect recurring incident patterns.
- Recommend safe remediation.
- Capture knowledge gaps automatically.
- Link incidents, changes, knowledge, prevention, and assets.

Humans should see the cases where judgment, approval, or accountability is needed. The platform should handle or surface everything else.

## Data Architecture

### Graph Data

Graph data lives in Neo4j:

- Base label: `ConfigurationItem`
- Class labels: `BusinessService`, `ApplicationService`, `TechnicalService`, `Application`, `Server`, `Database`, `NetworkGear`, `User`, `Group`, `Location`
- Relationship types: `PART_OF`, `DEPENDS_ON`, `HOSTED_ON`, `MANAGED_BY`, `OWNED_BY`, `LOCATED_AT`

Attributes are stored both as queryable node properties and in an `attributes` JSON string for class-manager compatibility.

### Operational Data

Operational records live in PostgreSQL. These records reference graph CIs by stable `ci_id` strings.

Examples:

- `change_requests.ci_id`
- `incidents.ci_id`
- `knowledge_items.ci_id`
- `prevention_records.ci_id`
- `asset_records.ci_id`
- `software_usage.ci_id`

This bridge keeps workflows connected to the CMDB without forcing every workflow state transition into the graph.

### Seed Data

Specora has two seed layers:

- Neo4j CMDB seed: 5,000 CSDM-aligned CIs and 13,350 generated relationships.
- PostgreSQL operations seed: deterministic cross-app records for Discovery, Change, Incident, Knowledge, Prevention, and Asset.

The seed model is intended to tell a product story, not just fill tables.

## Application Architecture

Applications are grouped into:

- Core platform apps: Settings, Admin Console, Audit Log, Specora Arc
- CMDB apps: Service Map, CMDB Explorer, CI Class Manager, Tables, Data Foundations
- ITSM apps: Change Manager, Incident Command Center, Knowledge Core, Prevention Center
- ITOM/ITAM/visibility apps: Discovery, Discovery Insights, Health Monitor, Asset Command Center, IT Visibility DCIM
- Developer demo apps: Hello World

Each app should expose:

- A clear user-facing workflow
- RBAC-aware data access
- Chat capability if it adds real value
- Server-side automation endpoints if it controls workflow state
- Events for important state changes

### Optional Premium Packages

Specora now has placeholder primitives for optional premium apps. IT Visibility DCIM is the first example: it is registered as a package app rather than a core bundled app, can be uninstalled and rediscovered through Arc, and owns its own Postgres data model, routes, and UI surface.

The current behavior is intentionally lightweight for development. Code and migrations are deployed with the platform, and installation primarily controls app availability. The production target remains server-side provisioning jobs with entitlement checks, audit events, rollback, data retention choices, and install progress.

### IT Visibility and DCIM

The DCIM module extends the graph CMDB with physical infrastructure data stored in PostgreSQL:

- Sites and rooms model facility scope.
- Racks and assets model physical placement, RU usage, weight, power capacity, and operational status.
- Power paths model facility dependencies and redundancy.
- Floorplans and floorplan objects model physical layout.
- Floorplan connections model cabling, power, and cooling relationships as persisted edges.

The UI uses React Flow for the floorplan workspace because racks and facility objects are best treated as nodes, while cabling and physical dependencies are edges. This keeps the interaction model aligned with the rest of Specora's graph-oriented UX while leaving room for future CAD-like floorplan support through a specialized canvas layer if needed.

## Security Model

Security is layered:

- JWT auth on GraphQL and API routes
- RBAC checks in resolvers and app routes
- Permission-filtered app registry
- Permission-filtered `ShellAPI`
- App tool route checks
- Access Analyzer traces in the Admin Console for role/resource/action decisions
- Relationship allowlisting
- Parameterized Cypher and SQL

The browser is not trusted to enforce policy. Client filtering improves UX; server filtering enforces access.

Current RBAC is role/resource/action based. It is strong enough for app, route, table, and automation access, but it is not yet a ServiceNow-style ACL model. Field-level and condition-based record restrictions are roadmap items, and must be implemented server-side before they are treated as a security boundary.

### Security Roadmap

Planned access-control expansion:

- Table-level CRUD policies that are separate from app visibility.
- Record-level rules based on ownership, assignment, state, service, CI, or tenant context.
- Field-level read/write policies for sensitive or workflow-controlled attributes.
- Masking modes for sensitive fields such as hidden, masked, read-only, or privileged-only.
- Policy simulation in the Admin Console before grants are saved.
- Access Analyzer traces that explain app, table, record, and field decisions in one chain.

The intended model is layered: app permission first, then table permission, then record rule, then field rule. Each layer should produce structured allow/deny reasons so administrators can troubleshoot access without reading code or raw policy tables.

## Eventing Model

The event bus supports:

- Local in-memory subscriptions
- WebSocket delivery to the frontend
- Redis pub/sub for multi-instance propagation
- PostgreSQL event persistence

Events let apps stay decoupled while still reacting to platform changes such as CI updates, incident transitions, and asset reconciliation.

## Testing Theory

Testing should follow risk:

- Pure functions get unit tests.
- Route behavior gets Fastify injection tests.
- Tool handlers get direct tests and route-level integration tests.
- Seeds get deterministic contract tests.
- Browser E2E should focus on high-value workflows rather than broad screenshot churn.

The long-term goal is 100% meaningful coverage. The short-term rule is no fake coverage and no threshold changes that hide untested behavior.

## Current Strengths

- Graph-first CMDB with deterministic demo scale.
- Native app ecosystem with server registry and role filtering.
- Strong direction for AI tool orchestration.
- RBAC-aware CRUD surfaces.
- Rich ITSM app set covering core Change, Incident, Knowledge, Prevention, and Asset workflows.
- Cross-app seed data that demonstrates platform-level value.

## Current Architectural Gaps

- App tool registration remains concentrated in one large API service file.
- Browser E2E framework is not yet installed.
- External iframe apps need a full `postMessage` bridge to reach parity with native apps.
- GraphQL resolver coverage is incomplete.
- Field-level and condition-based record ACLs are not yet implemented.
- Some applications are still demo-deep rather than production-complete.
- Worker offloading should expand for long-running actions.

## Source Files

- API entrypoint: `apps/api/src/index.ts`
- GraphQL schema/resolvers: `apps/api/src/graphql/`
- App tools: `apps/api/src/services/appTools.ts`
- Server app registry: `apps/api/src/services/appRegistry.ts`
- Web shell: `apps/web/src/shell/`
- Native apps: `apps/web/src/apps/`
- Graph seed: `packages/db/src/seed.ts`
- Demo data: `packages/db/src/demoData.ts`
- PostgreSQL migrations: `packages/db/migrations/`
