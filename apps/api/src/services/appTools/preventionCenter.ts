import { FastifyInstance } from "fastify";
import { registerTool } from "@specora/sdk";
import { emit } from "../eventBus";
import { assignRecordNumberToRow } from "../numberSequences";

export function registerPreventionCenterTools() {
function preventionPriority(recurrence: number, impact: number) {
  if (impact >= 80 || recurrence >= 5) return 1;
  if (impact >= 50 || recurrence >= 3) return 2;
  if (impact >= 25 || recurrence >= 2) return 3;
  return 4;
}

registerTool<FastifyInstance>("prevention-center", {
  name: "detect_candidates",
  description: "Detect prevention candidates from recurring incidents, related changes, CI health issues, and knowledge gaps.",
  parameters: {
    type: "object",
    properties: {
      windowDays: { type: "integer" },
      minRecurrence: { type: "integer" },
    },
  },
}, async (args, fastify) => {
  const { windowDays = 30, minRecurrence = 2, _userId } = args as any;
  const result = await fastify.pg.query(
    `SELECT COALESCE(service, ci_id, 'unmapped') as cluster_key,
            MAX(service) as service,
            MAX(ci_id) as ci_id,
            COUNT(*)::int as recurrence_count,
            MAX(severity) as max_severity,
            STRING_AGG(title, '; ' ORDER BY created_at DESC) as examples
     FROM incidents
     WHERE created_at > NOW() - ($1::int * INTERVAL '1 day')
       AND status NOT IN ('closed')
     GROUP BY COALESCE(service, ci_id, 'unmapped')
     HAVING COUNT(*) >= $2
     ORDER BY COUNT(*) DESC
     LIMIT 20`,
    [windowDays, minRecurrence]
  );
  const created = [];
  for (const row of result.rows) {
    const impact = row.recurrence_count * (row.max_severity === "critical" ? 30 : row.max_severity === "high" ? 20 : 10);
    const title = `Prevent recurring incidents for ${row.cluster_key}`;
    const record = await fastify.pg.query(
      `INSERT INTO prevention_records (title, description, category, priority, service, ci_id, recurrence_count, impact_score, confidence, estimated_hours_saved, owner_id)
       VALUES ($1, $2, 'recurring_incident', $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [title, row.examples, preventionPriority(row.recurrence_count, impact), row.service || null, row.ci_id || null, row.recurrence_count, impact, Math.min(0.95, 0.45 + row.recurrence_count * 0.1), row.recurrence_count * 1.5, _userId || null]
    );
    created.push(record.rows[0]);
    await fastify.pg.query(
      `INSERT INTO prevention_events (prevention_id, type, message, actor_id, metadata) VALUES ($1, 'detected', $2, $3, $4)`,
      [record.rows[0].id, `Detected ${row.recurrence_count} recurring incident signals`, _userId || null, JSON.stringify({ windowDays })]
    );
  }
  emit("prevention.candidates_detected", { count: created.length, windowDays });
  return { candidates: created, count: created.length };
});

registerTool<FastifyInstance>("prevention-center", {
  name: "create_candidate",
  description: "Create a prevention candidate manually or from an external reliability workflow.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      category: { type: "string" },
      service: { type: "string" },
      ciId: { type: "string" },
      recurrenceCount: { type: "integer" },
      impactScore: { type: "number" },
      evidence: { type: "array", items: { type: "object", properties: {} } },
    },
    required: ["title"],
  },
}, async (args, fastify) => {
  const { title, description, category = "manual", service, ciId, recurrenceCount = 0, impactScore = 0, evidence, _userId } = args as any;
  const record = await fastify.pg.query(
    `INSERT INTO prevention_records (title, description, category, priority, service, ci_id, recurrence_count, impact_score, confidence, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [title, description || null, category, preventionPriority(Number(recurrenceCount), Number(impactScore)), service || null, ciId || null, recurrenceCount, impactScore, 0.55, _userId || null]
  );
  const item = await assignRecordNumberToRow(fastify, "prevention_records", record.rows[0]);
  if (Array.isArray(evidence)) {
    for (const ev of evidence) {
      if (!ev?.sourceType || !ev?.sourceId) continue;
      await fastify.pg.query(
        `INSERT INTO prevention_evidence (prevention_id, source_type, source_id, summary, weight) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [item.id, ev.sourceType, ev.sourceId, ev.summary || null, ev.weight || 1]
      );
    }
  }
  await fastify.pg.query(`INSERT INTO prevention_events (prevention_id, type, message, actor_id) VALUES ($1, 'created', 'Prevention candidate created', $2)`, [item.id, _userId || null]);
  emit("prevention.created", { preventionId: item.id, title });
  return item;
});

registerTool<FastifyInstance>("prevention-center", {
  name: "list_candidates",
  description: "List prevention records with optional status, category, service, or CI filters.",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string" },
      category: { type: "string" },
      service: { type: "string" },
      ciId: { type: "string" },
      limit: { type: "integer" },
    },
  },
}, async (args, fastify) => {
  const { status, category, service, ciId, limit = 100 } = args as any;
  const params: any[] = [];
  let sql = `SELECT * FROM prevention_records WHERE 1=1`;
  if (status) {
    params.push(status);
    sql += ` AND status = $${params.length}`;
  }
  if (category) {
    params.push(category);
    sql += ` AND category = $${params.length}`;
  }
  if (service) {
    params.push(service);
    sql += ` AND service = $${params.length}`;
  }
  if (ciId) {
    params.push(ciId);
    sql += ` AND ci_id = $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 100, 250));
  sql += ` ORDER BY status = 'candidate' DESC, priority ASC, impact_score DESC, updated_at DESC LIMIT $${params.length}`;
  const result = await fastify.pg.query(sql, params);
  return result.rows;
});

registerTool<FastifyInstance>("prevention-center", {
  name: "get_candidate_details",
  description: "Get a prevention record with evidence, proposed actions, lifecycle events, and linked known error knowledge.",
  parameters: {
    type: "object",
    properties: {
      preventionId: { type: "string" },
    },
    required: ["preventionId"],
  },
}, async (args, fastify) => {
  const { preventionId } = args as any;
  const record = await fastify.pg.query(`SELECT * FROM prevention_records WHERE id = $1`, [preventionId]);
  if (!record.rows.length) return { error: "Prevention record not found" };
  const [evidence, actions, events, knownError] = await Promise.all([
    fastify.pg.query(`SELECT * FROM prevention_evidence WHERE prevention_id = $1 ORDER BY weight DESC, created_at DESC`, [preventionId]),
    fastify.pg.query(`SELECT * FROM prevention_actions WHERE prevention_id = $1 ORDER BY created_at DESC`, [preventionId]),
    fastify.pg.query(`SELECT e.*, u.name as actor FROM prevention_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.prevention_id = $1 ORDER BY e.created_at ASC`, [preventionId]),
    record.rows[0].known_error_id ? fastify.pg.query(`SELECT id, title, status, health_score, trust_score FROM knowledge_items WHERE id = $1`, [record.rows[0].known_error_id]) : Promise.resolve({ rows: [] }),
  ]);
  return { ...record.rows[0], evidence: evidence.rows, actions: actions.rows, events: events.rows, knownError: knownError.rows[0] || null };
});

registerTool<FastifyInstance>("prevention-center", {
  name: "propose_actions",
  description: "Propose corrective actions for a prevention candidate across Knowledge, Change, Health, Discovery, and automation.",
  parameters: {
    type: "object",
    properties: {
      preventionId: { type: "string" },
    },
    required: ["preventionId"],
  },
}, async (args, fastify) => {
  const { preventionId, _userId } = args as any;
  const details = await (await import("@specora/sdk")).executeTool("prevention-center_get_candidate_details", { preventionId }, fastify) as any;
  if (details.error) return details;
  const proposals = [
    { type: "known_error", title: "Create or update known error knowledge", targetApp: "knowledge-core" },
    { type: "health_rule", title: "Add proactive health rule or remediation", targetApp: "health-monitor" },
    { type: "change", title: "Plan corrective change with rollback guardrails", targetApp: "change-manager" },
    { type: "automation", title: "Codify prevention as a safe automated runbook", targetApp: "knowledge-core" },
  ];
  const rows = [];
  for (const proposal of proposals) {
    const result = await fastify.pg.query(
      `INSERT INTO prevention_actions (prevention_id, type, title, target_app) VALUES ($1, $2, $3, $4) RETURNING *`,
      [preventionId, proposal.type, proposal.title, proposal.targetApp]
    );
    rows.push(result.rows[0]);
  }
  await fastify.pg.query(`INSERT INTO prevention_events (prevention_id, type, message, actor_id, metadata) VALUES ($1, 'actions.proposed', $2, $3, $4)`, [
    preventionId,
    `${rows.length} corrective actions proposed`,
    _userId || null,
    JSON.stringify({ actionIds: rows.map((row: any) => row.id) }),
  ]);
  emit("prevention.actions_proposed", { preventionId, count: rows.length });
  return { preventionId, actions: rows };
});

registerTool<FastifyInstance>("prevention-center", {
  name: "create_known_error",
  description: "Create a Knowledge Core known-error article from a prevention record and link it back.",
  parameters: {
    type: "object",
    properties: {
      preventionId: { type: "string" },
    },
    required: ["preventionId"],
  },
}, async (args, fastify) => {
  const { preventionId, _userId } = args as any;
  const details = await (await import("@specora/sdk")).executeTool("prevention-center_get_candidate_details", { preventionId }, fastify) as any;
  if (details.error) return details;
  const knownError = await (await import("@specora/sdk")).executeTool("knowledge-core_create_knowledge", {
    title: `Known error: ${details.title}`,
    summary: details.description || `Recurring issue with ${details.service || details.ci_id || "an operational service"}`,
    content: `Symptoms\n${details.description || details.title}\n\nCause\nRoot cause pending validation.\n\nWorkaround\nDocument the safest current workaround.\n\nPermanent Fix\nTrack corrective actions in Prevention Center ${preventionId}.`,
    type: "known_error",
    status: "draft",
    source: "prevention",
    sourceRef: preventionId,
    service: details.service,
    ciId: details.ci_id,
    tags: ["known-error", "prevention"],
    links: [{ targetType: "prevention", targetId: preventionId, relationship: "known_error_for" }],
    _userId,
  }, fastify) as any;
  if (knownError.id) {
    await fastify.pg.query(`UPDATE prevention_records SET known_error_id = $1, updated_at = NOW() WHERE id = $2`, [knownError.id, preventionId]);
    await fastify.pg.query(`INSERT INTO prevention_events (prevention_id, type, message, actor_id, metadata) VALUES ($1, 'known_error.created', $2, $3, $4)`, [
      preventionId,
      `Known error draft created: ${knownError.title}`,
      _userId || null,
      JSON.stringify({ knowledgeId: knownError.id }),
    ]);
    emit("prevention.known_error_created", { preventionId, knowledgeId: knownError.id });
  }
  return knownError;
});

registerTool<FastifyInstance>("prevention-center", {
  name: "transition_candidate",
  description: "Transition a prevention record and record governance evidence.",
  parameters: {
    type: "object",
    properties: {
      preventionId: { type: "string" },
      status: { type: "string", enum: ["candidate", "investigating", "known_error", "fix_planned", "fix_in_progress", "monitoring", "prevented", "closed"] },
      note: { type: "string" },
      verifiedReductionPct: { type: "number" },
    },
    required: ["preventionId", "status"],
  },
}, async (args, fastify) => {
  const { preventionId, status, note, verifiedReductionPct, _userId } = args as any;
  const result = await fastify.pg.query(
    `UPDATE prevention_records SET status = $1,
       verified_reduction_pct = COALESCE($2, verified_reduction_pct),
       resolved_at = CASE WHEN $1 IN ('prevented', 'closed') THEN NOW() ELSE resolved_at END,
       updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [status, verifiedReductionPct ?? null, preventionId]
  );
  if (!result.rows.length) return { error: "Prevention record not found" };
  await fastify.pg.query(`INSERT INTO prevention_events (prevention_id, type, message, actor_id, metadata) VALUES ($1, 'status.changed', $2, $3, $4)`, [
    preventionId,
    note || `Status changed to ${status}`,
    _userId || null,
    JSON.stringify({ status, verifiedReductionPct }),
  ]);
  emit("prevention.status_changed", { preventionId, status });
  return result.rows[0];
});
}
