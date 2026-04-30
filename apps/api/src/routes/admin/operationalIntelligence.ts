import { FastifyInstance } from "fastify";
import { requirePermission } from "../../services/rbac";

function n(value: any) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  return Number(value) || 0;
}

function pct(value: any) {
  const score = n(value);
  if (score <= 1) return Math.round(score * 100);
  return Math.round(score);
}

function scoreFromRisks(risks: number[]) {
  const score = Math.max(0, Math.min(100, Math.round(100 - risks.reduce((sum, risk) => sum + risk, 0))));
  if (score >= 85) return { score, posture: "healthy" };
  if (score >= 65) return { score, posture: "watch" };
  return { score, posture: "attention" };
}

async function loadCmdbStats(fastify: FastifyInstance) {
  if (!(fastify as any).neo4j?.session) return null;
  const session = (fastify as any).neo4j.session();
  try {
    const result = await session.run(
      `MATCH (n:ConfigurationItem)
       WITH count(n) AS ciCount
       OPTIONAL MATCH ()-[r]-()
       RETURN ciCount, count(r) AS relationshipCount`
    );
    const row = result.records[0];
    return {
      ciCount: row?.get("ciCount")?.toNumber?.() ?? n(row?.get("ciCount")),
      relationshipCount: row?.get("relationshipCount")?.toNumber?.() ?? n(row?.get("relationshipCount")),
    };
  } catch (err: any) {
    fastify.log.warn({ err: err.message }, "Failed to load CMDB operational intelligence stats");
    return null;
  } finally {
    await session.close();
  }
}

async function buildOperationalIntelligence(fastify: FastifyInstance) {
  const [
    incident,
    change,
    knowledge,
    request,
    asset,
    discovery,
    governance,
    cmdb,
  ] = await Promise.all([
    fastify.pg.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::int AS open,
         COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed') AND severity IN ('critical', 'high'))::int AS high_open,
         COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed') AND ai_state IN ('queued', 'analyzing'))::int AS ai_pending,
         AVG(ai_confidence)::float AS avg_ai_confidence
       FROM incidents`
    ),
    fastify.pg.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'pending_approval')::int AS pending_approval,
         COUNT(*) FILTER (WHERE status NOT IN ('closed', 'rejected', 'rolled_back') AND COALESCE(risk_score, 0) >= 60)::int AS high_risk_active,
         COUNT(*) FILTER (WHERE status NOT IN ('closed', 'rejected', 'rolled_back') AND COALESCE(planned_start_at, scheduled_at) BETWEEN NOW() AND NOW() + INTERVAL '7 days')::int AS upcoming,
         COUNT(*) FILTER (WHERE status = 'pending_approval' AND NOT EXISTS (
           SELECT 1 FROM change_cab_brief_snapshots s WHERE s.change_request_id = change_requests.id
         ))::int AS pending_without_brief
       FROM change_requests`
    ),
    fastify.pg.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'published')::int AS published,
         COUNT(*) FILTER (WHERE status = 'published' AND (last_validated_at IS NULL OR last_validated_at < NOW() - INTERVAL '90 days'))::int AS stale,
         COALESCE(AVG(health_score), 0)::float AS avg_health,
         (SELECT COUNT(*)::int FROM knowledge_gaps WHERE status = 'open') AS open_gaps
       FROM knowledge_items`
    ),
    fastify.pg.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status NOT IN ('fulfilled', 'cancelled', 'closed'))::int AS open,
         COUNT(*) FILTER (WHERE status NOT IN ('fulfilled', 'cancelled', 'closed') AND priority <= 2)::int AS high_priority,
         (SELECT COUNT(*)::int FROM support_handoffs WHERE status NOT IN ('completed', 'cancelled', 'closed')) AS active_handoffs
       FROM catalog_requests`
    ),
    fastify.pg.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE lifecycle_state NOT IN ('retired', 'disposed'))::int AS active,
         COUNT(*) FILTER (WHERE evidence_score < 0.5)::int AS weak_evidence,
         (SELECT COUNT(*)::int FROM asset_exceptions WHERE status = 'open') AS open_exceptions,
         (SELECT COALESCE(SUM(GREATEST(consumed - quantity, 0)), 0)::float FROM software_entitlements WHERE status = 'active') AS entitlement_overage
       FROM asset_records`
    ),
    fastify.pg.query(
      `SELECT
         (SELECT COUNT(*)::int FROM discovery_pipelines) AS pipelines,
         (SELECT COUNT(*)::int FROM discovery_pipelines WHERE published_definition IS NOT NULL) AS published_pipelines,
         (SELECT COUNT(*)::int FROM discovery_sources WHERE COALESCE(last_status, 'unknown') NOT IN ('ok', 'healthy', 'success')) AS unhealthy_sources,
         (SELECT COUNT(*)::int FROM discovery_jobs WHERE status IN ('failed', 'error') AND created_at > NOW() - INTERVAL '7 days') AS failed_jobs_7d,
         (SELECT COUNT(*)::int FROM discovery_staged_records WHERE status = 'staged') AS staged_records`
    ),
    fastify.pg.query(
      `SELECT
         (SELECT COUNT(*)::int FROM app_permissions) AS permission_grants,
         (SELECT COUNT(*)::int FROM number_sequences WHERE enabled = true) AS active_sequences,
         (SELECT COUNT(*)::int FROM audit_log WHERE created_at > NOW() - INTERVAL '24 hours') AS audit_events_24h,
         (SELECT COUNT(*)::int FROM app_provisioning_jobs WHERE status NOT IN ('completed', 'cancelled')) AS active_package_jobs`
    ),
    loadCmdbStats(fastify),
  ]);

  const incidentRow = incident.rows[0] || {};
  const changeRow = change.rows[0] || {};
  const knowledgeRow = knowledge.rows[0] || {};
  const requestRow = request.rows[0] || {};
  const assetRow = asset.rows[0] || {};
  const discoveryRow = discovery.rows[0] || {};
  const governanceRow = governance.rows[0] || {};

  const domains = [
    {
      id: "incidents",
      label: "Incident Autonomy",
      score: scoreFromRisks([n(incidentRow.high_open) * 15, n(incidentRow.ai_pending) * 3]).score,
      posture: scoreFromRisks([n(incidentRow.high_open) * 15, n(incidentRow.ai_pending) * 3]).posture,
      metrics: [
        { label: "Open", value: n(incidentRow.open) },
        { label: "High severity", value: n(incidentRow.high_open) },
        { label: "AI pending", value: n(incidentRow.ai_pending) },
        { label: "Avg AI confidence", value: `${pct(incidentRow.avg_ai_confidence)}%` },
      ],
    },
    {
      id: "change",
      label: "Change Risk",
      score: scoreFromRisks([n(changeRow.high_risk_active) * 12, n(changeRow.pending_without_brief) * 8]).score,
      posture: scoreFromRisks([n(changeRow.high_risk_active) * 12, n(changeRow.pending_without_brief) * 8]).posture,
      metrics: [
        { label: "Pending CAB", value: n(changeRow.pending_approval) },
        { label: "High-risk active", value: n(changeRow.high_risk_active) },
        { label: "Upcoming", value: n(changeRow.upcoming) },
        { label: "Pending without brief", value: n(changeRow.pending_without_brief) },
      ],
    },
    {
      id: "knowledge",
      label: "Knowledge Health",
      score: scoreFromRisks([n(knowledgeRow.stale) * 4, n(knowledgeRow.open_gaps) * 6, Math.max(0, 80 - pct(knowledgeRow.avg_health)) / 2]).score,
      posture: scoreFromRisks([n(knowledgeRow.stale) * 4, n(knowledgeRow.open_gaps) * 6, Math.max(0, 80 - pct(knowledgeRow.avg_health)) / 2]).posture,
      metrics: [
        { label: "Published", value: n(knowledgeRow.published) },
        { label: "Stale", value: n(knowledgeRow.stale) },
        { label: "Open gaps", value: n(knowledgeRow.open_gaps) },
        { label: "Avg health", value: `${pct(knowledgeRow.avg_health)}%` },
      ],
    },
    {
      id: "engage",
      label: "Engage Flow",
      score: scoreFromRisks([n(requestRow.high_priority) * 8, n(requestRow.active_handoffs) * 4]).score,
      posture: scoreFromRisks([n(requestRow.high_priority) * 8, n(requestRow.active_handoffs) * 4]).posture,
      metrics: [
        { label: "Open requests", value: n(requestRow.open) },
        { label: "High priority", value: n(requestRow.high_priority) },
        { label: "Active handoffs", value: n(requestRow.active_handoffs) },
        { label: "Total requests", value: n(requestRow.total) },
      ],
    },
    {
      id: "asset",
      label: "Asset Trust",
      score: scoreFromRisks([n(assetRow.open_exceptions) * 7, n(assetRow.weak_evidence) * 3, n(assetRow.entitlement_overage) * 2]).score,
      posture: scoreFromRisks([n(assetRow.open_exceptions) * 7, n(assetRow.weak_evidence) * 3, n(assetRow.entitlement_overage) * 2]).posture,
      metrics: [
        { label: "Active assets", value: n(assetRow.active) },
        { label: "Open exceptions", value: n(assetRow.open_exceptions) },
        { label: "Weak evidence", value: n(assetRow.weak_evidence) },
        { label: "Entitlement overage", value: n(assetRow.entitlement_overage) },
      ],
    },
    {
      id: "discovery",
      label: "Discovery Readiness",
      score: scoreFromRisks([n(discoveryRow.unhealthy_sources) * 10, n(discoveryRow.failed_jobs_7d) * 8, n(discoveryRow.staged_records) > 0 ? 8 : 0]).score,
      posture: scoreFromRisks([n(discoveryRow.unhealthy_sources) * 10, n(discoveryRow.failed_jobs_7d) * 8, n(discoveryRow.staged_records) > 0 ? 8 : 0]).posture,
      metrics: [
        { label: "Pipelines", value: n(discoveryRow.pipelines) },
        { label: "Published", value: n(discoveryRow.published_pipelines) },
        { label: "Unhealthy sources", value: n(discoveryRow.unhealthy_sources) },
        { label: "Failed jobs 7d", value: n(discoveryRow.failed_jobs_7d) },
      ],
    },
  ];

  const signals = [
    n(incidentRow.high_open) > 0 && {
      severity: "critical",
      title: "High-severity incidents are open",
      detail: `${n(incidentRow.high_open)} high or critical incident${n(incidentRow.high_open) === 1 ? "" : "s"} need command attention.`,
      action: "Open Incident Command Center",
      appId: "incident-manager",
    },
    n(changeRow.pending_without_brief) > 0 && {
      severity: "warning",
      title: "CAB items missing persisted briefs",
      detail: `${n(changeRow.pending_without_brief)} pending change${n(changeRow.pending_without_brief) === 1 ? "" : "s"} should have a CAB snapshot before approval.`,
      action: "Open Change Manager",
      appId: "change-manager",
    },
    n(knowledgeRow.open_gaps) > 0 && {
      severity: "warning",
      title: "Knowledge gaps are accumulating",
      detail: `${n(knowledgeRow.open_gaps)} open knowledge gap${n(knowledgeRow.open_gaps) === 1 ? "" : "s"} reduce portal deflection and agent speed.`,
      action: "Open Knowledge Orchestrator",
      appId: "knowledge-core",
    },
    n(assetRow.open_exceptions) > 0 && {
      severity: "warning",
      title: "Asset exceptions need reconciliation",
      detail: `${n(assetRow.open_exceptions)} open ITAM exception${n(assetRow.open_exceptions) === 1 ? "" : "s"} can affect financial and compliance confidence.`,
      action: "Open Asset Command Center",
      appId: "asset-command",
    },
    n(discoveryRow.unhealthy_sources) > 0 && {
      severity: "warning",
      title: "Discovery sources are unhealthy",
      detail: `${n(discoveryRow.unhealthy_sources)} source${n(discoveryRow.unhealthy_sources) === 1 ? "" : "s"} failed or have not proven health.`,
      action: "Open Discovery",
      appId: "discovery",
    },
  ].filter(Boolean);

  const overall = Math.round(domains.reduce((sum, domain) => sum + domain.score, 0) / Math.max(1, domains.length));
  return {
    generatedAt: new Date().toISOString(),
    overall: {
      score: overall,
      posture: overall >= 85 ? "healthy" : overall >= 65 ? "watch" : "attention",
      summary: overall >= 85
        ? "Operational posture is demo-ready with no major cross-module risks."
        : overall >= 65
          ? "Operational posture is credible, with focused follow-up needed before enterprise review."
          : "Operational posture needs attention before strong enterprise positioning claims.",
    },
    domains,
    signals,
    governance: {
      permissionGrants: n(governanceRow.permission_grants),
      activeSequences: n(governanceRow.active_sequences),
      auditEvents24h: n(governanceRow.audit_events_24h),
      activePackageJobs: n(governanceRow.active_package_jobs),
    },
    cmdb: cmdb || { ciCount: null, relationshipCount: null },
  };
}

export function registerAdminOperationalIntelligenceRoutes(fastify: FastifyInstance) {
  fastify.get("/api/admin/operational-intelligence", { onRequest: [fastify.authenticate, requirePermission("system-properties", "read")] }, async (_request, reply) => {
    try {
      return await buildOperationalIntelligence(fastify);
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to build operational intelligence" });
    }
  });
}
