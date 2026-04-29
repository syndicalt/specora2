# CMDB and Service Mapping

Use CMDB Explorer and Service Map together to investigate configuration items, relationships, risk, and impact.

![CMDB Explorer CI detail](../screenshots/cmdb-explorer-ci-detail.png)

## CMDB Explorer

Open **CMDB Explorer** from the dock or launcher.

Use the left panel to:

- Search by CI name.
- Filter by class.
- Filter by environment.
- View risk, stale, orphaned, and critical queues.

Select a CI to inspect:

- Overall health.
- Relationship count.
- Owner or support group.
- Criticality.
- Investigation summary.
- Relationship intelligence.
- Attributes.
- Quality signals.
- Activity timeline.

## Investigate a CI

1. Open **CMDB Explorer**.
2. Search for the CI.
3. Review **Investigation Summary** for missing required fields, stale discovery, relationship gaps, and health concerns.
4. Review **Relationship Intelligence** for direct relationships and neighborhood context.
5. Review **Attributes** for class fields and discovery-populated fields.
6. Use **Service Map** to open the topology.
7. Use **Edit in Tables** to update governed record fields.

## Service Map

![Service Map overview](../screenshots/service-map-overview.png)

Use **Service Map** to:

- Visualize upstream and downstream relationships.
- Add relationships between nodes.
- Change relationship types.
- Remove incorrect relationships.
- Open CI detail from graph context.

Reference fields and relationship selectors should use typeahead behavior where available.

## Relationship Direction

Relationship direction matters for impact analysis.

- **DEPENDS_ON** - source depends on target.
- **HOSTED_ON** - application/service is hosted on infrastructure.
- **OWNED_BY** - record is owned by a user, department, or group.
- **USED_BY** - CI is used by another record or user.

Administrators can govern relationship type options in [Data Foundations](tables-and-data-foundations.md#relationship-types).

## Required and Health Fields

CI classes define:

- Required fields.
- Health-required fields.
- Reconciliation keys.
- Display fields.
- Reference fields.

Manage class definitions in **CI Class Manager**. See [Tables and Data Foundations](tables-and-data-foundations.md#ci-class-manager).

## Chat-Assisted Investigation

Open chat and ask:

```text
Help me investigate the selected CI and summarize risk, relationships, and recommended next steps.
```

Chat can search CIs, retrieve details, fetch service maps, and return action links.

See [Global Chat and AI Assistance](../ai-chat.md).
