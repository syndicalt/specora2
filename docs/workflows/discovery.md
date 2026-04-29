# Discovery and Edge Collectors

Discovery turns external inventory and edge-collected evidence into governed CMDB updates.

![Discovery pipeline builder](../screenshots/discovery-pipeline-builder.png)

## Concepts

- **Discovery source** - reusable source metadata, such as CSV, REST API, database, or edge collector.
- **Edge collector** - enrolled Specora Edge runtime that sends heartbeat, jobs, uploads, and evidence.
- **Run dataset** - discrete source run that can be selected for testing and pipeline design.
- **Pipeline** - editable workflow for profiling, class routing, mapping, staging, preview, and commit.
- **Staging** - reviewable create/update/link plan before CMDB mutation.
- **Evidence** - uploaded raw or typed observations from edge collection.

## Discovery Sources

Use **Discovery** to create or edit sources.

For non-edge sources:

- Provide source name.
- Select source type.
- Provide endpoint or connection placeholder.
- Select a Discovery-scoped credential when needed.

For edge collector sources:

- Select **Edge collector** as the type.
- Select an enrolled collector.
- No discovery credential is required for the collector itself.
- Endpoint is informational unless the source also uses an external service.

## Edge Enrollment

Administrators create enrollment tokens in **Admin Console > Edge Enrollment**.

Edge enrollment flow:

1. Admin creates an enrollment token.
2. Operator copies the token immediately.
3. Edge posts enrollment to the platform.
4. Platform creates a collector identity.
5. Edge receives runtime identity and fetches runtime configuration.
6. Collector heartbeats appear in Admin Console.

See [Admin Guide: Edge Enrollment](../admin/README.md#edge-enrollment).

## Runtime Configuration

The platform publishes:

- Job signing public key/keyring.
- Collector manifests.
- Capability policies.

Local edge operators still control:

- Filesystem placement.
- Enablement.
- Collector package installation.
- Local service runtime.

## Pipeline Builder

Pipeline nodes may include:

- Source.
- Profile.
- Class router.
- AI draft transform.
- Transform mapping.
- Stage.
- Preview.
- Commit.

Discovery admins should review and edit pipeline behavior before committing.

## AI-Assisted Mapping

AI assists with:

- Entity type detection.
- Class routing.
- Field mapping.
- Reconciliation key suggestions.
- Relationship rule suggestions.

Admins remain responsible for approving pipeline logic. Use right-click node editing when available to inspect full node configuration.

## Preview and Commit

Before commit, review:

- Create/update/link actions.
- Required field warnings.
- Missing relationship targets.
- Reconciliation confidence.
- Blocked or unsafe changes.

Commit only after the preview represents the intended CMDB changes.

## Troubleshooting

If no evidence appears:

- Confirm edge enrollment is healthy.
- Confirm runtime config is bootstrapped.
- Confirm jobs were queued for the collector.
- Confirm jobs pass signature verification.
- Confirm uploads complete.
- Confirm evidence ingestion wrote observations.

If mapping misses fields:

- Confirm the selected dataset/run contains the fields.
- Refresh profiling.
- Review class router and transform node settings.
- Ensure preview samples include each entity type.

Related:

- [CMDB and Service Mapping](cmdb-and-service-mapping.md)
- [Admin Guide](../admin/README.md)
