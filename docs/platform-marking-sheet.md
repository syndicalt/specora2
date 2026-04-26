# Platform Marking Sheet

**Status:** Assessment rubric and current scorecard
**Last updated:** 2026-04-26

This marking sheet evaluates Specora as a platform and evaluates each native application. Scores are intentionally conservative. A high score should mean the feature is not only impressive in demo form, but coherent, tested, secure, documented, and ready to sustain real users.

## Scoring Scale

| Score | Meaning |
| ---: | --- |
| 0 | Not present |
| 1 | Concept only |
| 2 | Prototype |
| 3 | Usable alpha |
| 4 | Strong beta |
| 5 | Production-grade |

## Platform Rubric

| Area | Weight | Current score | Weighted mark | Notes |
| --- | ---: | ---: | ---: | --- |
| Product coherence | 10 | 4 | 8.0 | Clear AI-native ITSM thesis; apps increasingly reinforce each other |
| Architecture | 10 | 4 | 8.0 | Strong graph/API/app-shell split; app tools still too monolithic |
| CSDM alignment | 10 | 3.5 | 7.0 | Strong service/infrastructure subset; broader foundation/portfolio needed |
| Data model quality | 10 | 4 | 8.0 | Neo4j + Postgres split is sound; deterministic demo data added |
| Security and RBAC | 10 | 3.7 | 7.4 | Server checks, route gates, Access Analyzer, and audit coverage improving; field-level rules pending |
| AI/tool orchestration | 10 | 4 | 8.0 | Provara primary, tool calls, app tools, chat panel; more guardrails needed |
| User experience | 10 | 4 | 8.0 | Strong command-center direction; several apps need stress UX passes |
| Test coverage | 10 | 4.0 | 8.0 | DB at 100%; API improving with focused audit route coverage; browser E2E covers Tables, Admin/RBAC, Arc provisioning, Discovery, and DCIM write paths |
| Extensibility | 10 | 3.7 | 7.4 | Arc, ShellAPI, dynamic native imports, server-owned optional package state; iframe bridge, entitlement checks, and tool modularity pending |
| Operability | 10 | 3.8 | 7.6 | Docker local stack, eventing, queues, deployment docs, backup/restore docs, audit contract, and PostgreSQL migration runner; production health checks and restore rehearsals still needed |

Overall platform mark: **78.0 / 100**.

Interpretation: Specora is a strong beta platform with unusually coherent product direction. The biggest gaps are production hardening, tool modularity, restore rehearsal/release automation, complete audit coverage across every native mutation, and deeper CSDM breadth.

## Application Rubric

Each application is marked across:

- **Purpose clarity:** The app has a clear reason to exist.
- **Workflow depth:** The app supports real end-user workflows, not just display.
- **Data integration:** The app uses platform data correctly.
- **AI integration:** Chat/tool support adds genuine value.
- **UX quality:** The app is legible, efficient, and dock-aware.
- **Endpoint quality:** Server routes/tools exist where needed.
- **Test coverage:** Meaningful tests exist for risky behavior.
- **Maturity:** Overall readiness.

## Application Scorecard

| Application | Purpose | Workflow | Data | AI | UX | Endpoints | Tests | Maturity | Mark |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Admin Console | 4 | 3 | 3 | 1 | 3 | 4 | 3 | 3 | 60 |
| Asset Command Center | 5 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 83 |
| Audit Log | 4 | 3 | 4 | 1 | 3 | 4 | 4 | 3 | 65 |
| Change Manager | 5 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | 85 |
| CI Class Manager | 5 | 4 | 4 | 1 | 4 | 4 | 4 | 4 | 75 |
| CMDB Explorer | 5 | 5 | 5 | 3 | 4 | 4 | 3 | 4 | 83 |
| Data Foundations | 5 | 3 | 4 | 2 | 3 | 3 | 3 | 3 | 65 |
| Discovery | 5 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | 85 |
| Discovery Insights | 4 | 3 | 4 | 3 | 3 | 3 | 3 | 3 | 65 |
| Health Monitor | 5 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 83 |
| Hello World | 3 | 2 | 1 | 0 | 3 | 1 | 2 | 2 | 35 |
| Incident Command Center | 5 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 88 |
| IT Visibility DCIM | 5 | 3 | 4 | 2 | 4 | 4 | 4 | 3 | 73 |
| Knowledge Core | 5 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 88 |
| Prevention Center | 5 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 83 |
| Service Map | 5 | 4 | 5 | 2 | 4 | 4 | 3 | 4 | 78 |
| Settings | 3 | 2 | 2 | 0 | 3 | 2 | 2 | 2 | 40 |
| Specora Arc | 5 | 3 | 4 | 2 | 4 | 4 | 3 | 3 | 70 |
| Tables | 5 | 4 | 5 | 1 | 4 | 5 | 4 | 4 | 80 |

## Application Notes

### Highest-Maturity Apps

- Incident Command Center
- Knowledge Core
- Change Manager
- Asset Command Center
- Health Monitor
- CMDB Explorer
- Prevention Center
- Tables

These apps best express the platform thesis: they combine data, workflow, AI/tooling, and useful UI.

### Apps Needing the Most Product Depth

- Hello World: should remain a sample, not be judged as a product app.
- Settings: useful but intentionally narrow.
- Audit Log: now has a documented server-side event contract and broader mutation coverage; needs filtering, drilldown, export, and AI summarization.
- Data Foundations: needs edit flows, stewardship queues, and CSDM validation rules.
- Discovery Insights: needs clearer killer workflows beyond summary analysis.
- IT Visibility DCIM: strong demo concept with real floorplan/cabling persistence, object palette, inspector edits, connection maintenance, and initial E2E coverage; needs richer physical inventory, direct canvas resize controls, and deeper rack/connection workflows.

## Platform Quality Gates

Before calling the platform production-grade:

- Browser E2E tests exist for critical journeys.
- API route and tool coverage materially improves.
- App tools are split per application.
- Long-running jobs move to worker/queue.
- RBAC is covered for every native app route.
- Field-level and condition-based record ACLs are designed, enforced server-side, and explainable through Access Analyzer.
- CSDM validation reports are generated by Data Foundations.
- Deployment, backup, restore, and scaling docs exist and are rehearsed against a restored environment.
- External app iframe bridge is implemented or explicitly deprecated.
- Audit log records AI tool execution, package provisioning, admin mutations, automation outcomes, and user identity consistently.
- Premium/package installation uses server-side provisioning jobs with entitlement checks, progress, audit, rollback, and explicit data retention choices.

## Per-App Promotion Criteria

An app can be marked production-grade only when:

- It has a documented user workflow.
- It has RBAC-aware server endpoints for all writes.
- It has seed data or test fixtures.
- It has route/tool tests for success, denial, and failure paths.
- It behaves well in docked shell layouts.
- It has useful empty/loading/error states.
- Its chat integrations can be explained in one sentence and tested.
- Its icon is unique enough to identify it in the launcher and dock.

## Reassessment Cadence

Reassess after:

- Major data model changes
- New native apps
- New AI tool surfaces
- CSDM model expansion
- UX redesigns
- Coverage threshold changes
- Production deployment work

Recommended cadence: once per milestone or before external demo.
