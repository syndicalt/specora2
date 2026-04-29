# Specora Documentation

Specora is an AI-native IT operations platform with a graph CMDB, discovery pipeline, service mapping, ITSM applications, governed data administration, and a conversational workspace.

This directory is the canonical user and administrator documentation set. Older engineering notes were moved to [`../docs-archive`](../docs-archive/).

## Start Here

- [Getting Started](getting-started.md) - sign in, workspace basics, demo path, and first tasks.
- [Workspace and Navigation](workspace.md) - dock, launcher, windows, app switching, keyboard shortcuts, and profile settings.
- [Global Chat and AI Assistance](ai-chat.md) - chat context, tool links, prompts, and safe use.
- [Application Reference](apps/README.md) - every built-in app, what it does, and common workflows.

## Core Workflows

- [CMDB and Service Mapping](workflows/cmdb-and-service-mapping.md) - investigate CIs, inspect topology, edit relationships, and steward CI quality.
- [Discovery and Edge Collectors](workflows/discovery.md) - sources, edge enrollment, runtime configuration, pipeline runs, evidence, staging, and commit.
- [Tables and Data Foundations](workflows/tables-and-data-foundations.md) - table CRUD, reference fields, class tables, environments, departments, and cost centers.
- [ITSM Workflows](workflows/itsm.md) - incidents, changes, knowledge, prevention, assets, customer portal, and agent workspace.
- [Reporting](workflows/reporting.md) - operational dashboards, report previews, exports, and BI handoff.

## Administration

- [Admin Guide](admin/README.md) - user management, RBAC, credentials, edge enrollment, system properties, sequences, environments, and package provisioning.
- [Operations Guide](operations/README.md) - deployment, migrations, backup, restore, LLM routing, and production operations.
- [Screenshot Catalog](screenshots/README.md) - required screenshots and naming conventions.

## Screenshot Policy

Every major guide includes screenshot callouts using relative links under `docs/screenshots/`. Screenshots should be refreshed before tagged releases and when UI flows materially change.

Use this naming pattern:

```text
docs/screenshots/<area>-<screen-or-workflow>.png
```

Example:

```text
docs/screenshots/cmdb-explorer-ci-detail.png
```

## Documentation Standards

- Write for operators, administrators, and evaluators before developers.
- Keep procedures short and action-oriented.
- Crosslink related concepts instead of repeating long explanations.
- Clearly distinguish production behavior from future roadmap.
- Prefer screenshots of real app state over empty screens.
- Avoid implementation details unless they affect user/admin decisions.

## Release Review

Before a demo tag or release candidate, run:

```bash
pnpm docs:check
```

This validates local Markdown links and confirms referenced screenshots exist. Use `pnpm docs:screenshots` to refresh the catalog from a demo-ready environment.
