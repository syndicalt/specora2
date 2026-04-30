import { FastifyInstance } from "fastify";
import { registerTool } from "@specora/sdk";
import { emit } from "../eventBus";
import { assignRecordNumberToRow } from "../numberSequences";

export function registerIncidentManagerTools() {
type IncidentToolArgs = Record<string, unknown> & {
  incidentId: string;
  title: string;
  description?: string;
  severity?: string;
  source?: string;
  externalRef?: string;
  service?: string;
  ciId?: string;
  affectedCiIds?: string[];
  autoRemediationAllowed?: boolean;
  requesterId?: string;
  ownerId?: string;
  status?: string;
  limit?: number;
  confidence?: number;
  actionId: string;
  result?: string;
  note?: string;
  type?: string;
  message: string;
  metadata?: Record<string, unknown>;
  _userId?: string;
};

type CiContextSummary = { id: string; name: string; class: string; environment: string };
type CiHealthSummary = { overall: number; relationshipCount: number };
type RelationshipSummary = { sourceId: string; targetId: string; type: string };
type IncidentCiRow = { ci_id: string; role?: string; distance?: number };
type IncidentDetails = Record<string, unknown> & {
  error?: string;
  affectedCis?: unknown[];
  relatedChanges?: Array<{ status?: string }>;
  ciHealth?: Record<string, CiHealthSummary>;
  ci_id?: string;
  auto_remediation_allowed?: boolean;
  severity?: string;
  status?: string;
  title?: string;
  service?: string;
  ai_summary?: string;
  ai_next_action?: string;
};

function toolArgs(args: unknown): IncidentToolArgs {
  return args && typeof args === "object" ? args as IncidentToolArgs : {} as IncidentToolArgs;
}

async function incidentDetails(incidentId: string, fastify: FastifyInstance): Promise<IncidentDetails> {
  return (await (await import("@specora/sdk")).executeTool("incident-manager_get_incident_details", { incidentId }, fastify)) as IncidentDetails;
}

function incidentPriority(severity?: string): number {
  if (severity === "critical") return 1;
  if (severity === "high") return 2;
  if (severity === "low") return 4;
  return 3;
}

function incidentDecision(input: { severity?: string; confidence?: number; actionRisk?: string; autoAllowed?: boolean }) {
  const confidence = input.confidence ?? 0;
  const risky = input.severity === "critical" || input.actionRisk === "high" || input.actionRisk === "critical";
  if (input.autoAllowed && confidence >= 0.82 && !risky) return "auto-remediate";
  if (confidence >= 0.62) return "request-approval";
  return "escalate-human";
}

async function lookupCiContext(fastify: FastifyInstance, ciIds: string[]): Promise<{
  names: Record<string, CiContextSummary>;
  health: Record<string, CiHealthSummary>;
  relationships: RelationshipSummary[];
}> {
  if (ciIds.length === 0) return { names: {}, health: {}, relationships: [] };
  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `MATCH (n:ConfigurationItem) WHERE n.id IN $ids
       OPTIONAL MATCH (n)-[r]-(m:ConfigurationItem)
       RETURN n.id as id, n.name as name, n.class as class, n.environment as environment,
              n.healthOverall as health, count(r) as relCount`,
      { ids: ciIds }
    );
    const names: Record<string, CiContextSummary> = {};
    const health: Record<string, CiHealthSummary> = {};
    for (const record of result.records) {
      const id = record.get("id");
      names[id] = {
        id,
        name: record.get("name") || id,
        class: record.get("class") || "Unknown",
        environment: record.get("environment") || "Unknown",
      };
      health[id] = {
        overall: Number(record.get("health") ?? 1),
        relationshipCount: record.get("relCount")?.toNumber?.() ?? Number(record.get("relCount") || 0),
      };
    }
    const relResult = await session.run(
      `MATCH (a:ConfigurationItem)-[r]-(b:ConfigurationItem)
       WHERE a.id IN $ids AND b.id IN $ids
       RETURN a.id as sourceId, b.id as targetId, type(r) as type
       LIMIT 100`,
      { ids: ciIds }
    );
    return {
      names,
      health,
      relationships: relResult.records.map((record) => ({
        sourceId: record.get("sourceId"),
        targetId: record.get("targetId"),
        type: record.get("type"),
      })),
    };
  } finally {
    await session.close();
  }
}

registerTool<FastifyInstance>("incident-manager", {
  name: "create_incident",
  description: "Create or upsert an incident from a human report, alert, pipeline, monitor, or external incident process.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
      source: { type: "string", description: "manual, alert, ci_cd, health-monitor, discovery, external" },
      externalRef: { type: "string", description: "External alert, ticket, deployment, or monitor id" },
      service: { type: "string" },
      ciId: { type: "string" },
      affectedCiIds: { type: "array", items: { type: "string" } },
      autoRemediationAllowed: { type: "boolean" },
      requesterId: { type: "string" },
      ownerId: { type: "string" },
    },
    required: ["title"],
  },
}, async (args, fastify) => {
  const { title, description, severity = "medium", source = "manual", externalRef, service, ciId, affectedCiIds, autoRemediationAllowed = false, requesterId, ownerId, _userId } = toolArgs(args);
  const affected = Array.isArray(affectedCiIds) ? affectedCiIds : [];
  const allCiIds = Array.from(new Set([ciId, ...affected].filter(Boolean)));
  const inferredRequesterId = requesterId || (source === "customer-portal" ? _userId : null);
  const result = await fastify.pg.query(
    `INSERT INTO incidents (title, description, severity, priority, source, external_ref, service, ci_id, auto_remediation_allowed, requester_id, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (source, external_ref) DO UPDATE SET
       title = EXCLUDED.title,
       description = COALESCE(EXCLUDED.description, incidents.description),
       severity = EXCLUDED.severity,
       priority = EXCLUDED.priority,
       requester_id = COALESCE(EXCLUDED.requester_id, incidents.requester_id),
       updated_at = NOW()
     RETURNING *`,
    [title, description || null, severity, incidentPriority(severity), source, externalRef || null, service || null, ciId || null, !!autoRemediationAllowed, inferredRequesterId, ownerId || null]
  );
  const incident = await assignRecordNumberToRow(fastify, "incidents", result.rows[0]);
  for (const id of allCiIds) {
    await fastify.pg.query(
      `INSERT INTO incident_cis (incident_id, ci_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [incident.id, id, id === ciId ? "primary" : "affected"]
    );
  }
  await fastify.pg.query(
    `INSERT INTO incident_events (incident_id, type, message, actor_id, metadata) VALUES ($1, 'created', $2, $3, $4)`,
    [incident.id, `Incident created from ${source}`, _userId || null, JSON.stringify({ externalRef, ciIds: allCiIds })]
  );
  emit("incident.created", { incidentId: incident.id, title, severity, source, ciId });
  return incident;
});

registerTool<FastifyInstance>("incident-manager", {
  name: "list_incidents",
  description: "List incidents, optionally filtered by status, severity, or CI.",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string" },
      severity: { type: "string" },
      ciId: { type: "string" },
      limit: { type: "integer" },
    },
  },
}, async (args, fastify) => {
  const { status, severity, ciId, limit = 75 } = toolArgs(args);
  const params: unknown[] = [];
  let query = `SELECT i.*,
                 requester.name AS requester_name, requester.email AS requester_email,
                 owner.name AS owner_name, owner.email AS owner_email,
                 commander.name AS commander_name, commander.email AS commander_email
               FROM incidents i
               LEFT JOIN users requester ON requester.id = i.requester_id
               LEFT JOIN users owner ON owner.id = i.owner_id
               LEFT JOIN users commander ON commander.id = i.commander_id
               WHERE 1=1`;
  if (status) {
    params.push(status);
    query += ` AND i.status = $${params.length}`;
  }
  if (severity) {
    params.push(severity);
    query += ` AND i.severity = $${params.length}`;
  }
  if (ciId) {
    params.push(ciId);
    query += ` AND (i.ci_id = $${params.length} OR EXISTS (SELECT 1 FROM incident_cis ic WHERE ic.incident_id = i.id AND ic.ci_id = $${params.length}))`;
  }
  params.push(Math.min(Number(limit) || 75, 200));
  query += ` ORDER BY i.priority ASC, i.created_at DESC LIMIT $${params.length}`;
  const result = await fastify.pg.query(query, params);
  return Promise.all((result.rows as Record<string, unknown>[]).map(async (row) => {
    const incident = await assignRecordNumberToRow(fastify, "incidents", row);
    return {
      ...incident,
      requester: incident.requester_id ? { id: incident.requester_id, name: incident.requester_name, email: incident.requester_email } : null,
      owner: incident.owner_id ? { id: incident.owner_id, name: incident.owner_name, email: incident.owner_email } : null,
      commander: incident.commander_id ? { id: incident.commander_id, name: incident.commander_name, email: incident.commander_email } : null,
    };
  }));
});

registerTool<FastifyInstance>("incident-manager", {
  name: "get_incident_details",
  description: "Get full incident state, affected CIs, timeline, actions, roles, and postmortem drafts.",
  parameters: {
    type: "object",
    properties: {
      incidentId: { type: "string" },
    },
    required: ["incidentId"],
  },
}, async (args, fastify) => {
  const { incidentId } = toolArgs(args);
  const incidentResult = await fastify.pg.query(
    `SELECT i.*,
            requester.name AS requester_name, requester.email AS requester_email,
            owner.name AS owner_name, owner.email AS owner_email,
            commander.name AS commander_name, commander.email AS commander_email
     FROM incidents i
     LEFT JOIN users requester ON requester.id = i.requester_id
     LEFT JOIN users owner ON owner.id = i.owner_id
     LEFT JOIN users commander ON commander.id = i.commander_id
     WHERE i.id = $1`,
    [incidentId]
  );
  if (!incidentResult.rows.length) return { error: "Incident not found" };
  const incident = await assignRecordNumberToRow(fastify, "incidents", incidentResult.rows[0]);
  const ciResult = await fastify.pg.query(`SELECT ci_id, role, distance FROM incident_cis WHERE incident_id = $1`, [incidentId]);
  const ciRows = ciResult.rows as IncidentCiRow[];
  const ciIds = ciRows.map((row) => row.ci_id);
  const [events, actions, roles, postmortems, changes] = await Promise.all([
    fastify.pg.query(`SELECT e.*, u.name as actor FROM incident_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.incident_id = $1 ORDER BY e.created_at ASC`, [incidentId]),
    fastify.pg.query(`SELECT * FROM incident_actions WHERE incident_id = $1 ORDER BY created_at DESC`, [incidentId]),
    fastify.pg.query(`SELECT r.*, u.name, u.email FROM incident_roles r JOIN users u ON u.id = r.user_id WHERE r.incident_id = $1`, [incidentId]),
    fastify.pg.query(`SELECT * FROM incident_postmortems WHERE incident_id = $1 ORDER BY created_at DESC`, [incidentId]),
    ciIds.length
      ? fastify.pg.query(
          `SELECT id, title, status, priority, planned_start_at
           FROM (
             SELECT DISTINCT cr.id, cr.title, cr.status, cr.priority,
                    COALESCE(cr.planned_start_at, cr.scheduled_at) as planned_start_at,
                    COALESCE(cr.planned_start_at, cr.scheduled_at, cr.created_at) as sort_at
             FROM change_requests cr
             LEFT JOIN change_request_cis crc ON crc.change_request_id = cr.id
             WHERE cr.ci_id = ANY($1) OR crc.ci_id = ANY($1)
           ) related_changes
           ORDER BY sort_at DESC
           LIMIT 10`,
          [ciIds]
        )
      : Promise.resolve({ rows: [] }),
  ]);
  const ciContext = await lookupCiContext(fastify, ciIds);
  return {
    ...incident,
    requester: incident.requester_id ? { id: incident.requester_id, name: incident.requester_name, email: incident.requester_email } : null,
    owner: incident.owner_id ? { id: incident.owner_id, name: incident.owner_name, email: incident.owner_email } : null,
    commander: incident.commander_id ? { id: incident.commander_id, name: incident.commander_name, email: incident.commander_email } : null,
    affectedCis: ciRows.map((row) => ({ ...row, ...(ciContext.names[row.ci_id] || { id: row.ci_id, name: row.ci_id }) })),
    ciHealth: ciContext.health,
    edges: ciContext.relationships,
    events: events.rows,
    actions: actions.rows,
    roles: roles.rows,
    postmortems: postmortems.rows,
    relatedChanges: changes.rows,
  };
});

registerTool<FastifyInstance>("incident-manager", {
  name: "triage_incident",
  description: "Run AI-oriented incident triage using CMDB context, recent changes, health signals, and source metadata.",
  parameters: {
    type: "object",
    properties: {
      incidentId: { type: "string" },
      confidence: { type: "number", description: "Optional externally supplied confidence from an AI/monitoring pipeline" },
    },
    required: ["incidentId"],
  },
}, async (args, fastify) => {
  const { incidentId, confidence } = toolArgs(args);
  const details = await incidentDetails(incidentId, fastify);
  if (details.error) return details;
  const ciCount = details.affectedCis?.length || 0;
  const relatedChangeCount = details.relatedChanges?.length || 0;
  const healthValues = Object.values(details.ciHealth || {});
  const unhealthyCount = healthValues.filter((h) => Number(h.overall ?? 1) < 0.7 || Number(h.relationshipCount ?? 0) === 0).length;
  const inferredConfidence = confidence ?? Math.min(0.96, 0.45 + (details.ci_id ? 0.18 : 0) + (ciCount ? 0.12 : 0) + (relatedChangeCount ? 0.12 : 0) + (unhealthyCount ? 0.09 : 0));
  const summary = [
    relatedChangeCount ? `${relatedChangeCount} related change${relatedChangeCount === 1 ? "" : "s"} found` : "No recent related changes found",
    ciCount ? `${ciCount} affected CI${ciCount === 1 ? "" : "s"} mapped` : "No affected CIs mapped",
    unhealthyCount ? `${unhealthyCount} CI health warning${unhealthyCount === 1 ? "" : "s"}` : "No CI health blockers detected",
  ].join(". ");
  const decision = incidentDecision({ severity: details.severity, confidence: inferredConfidence, autoAllowed: details.auto_remediation_allowed });
  const nextAction = decision === "auto-remediate"
    ? "Execute the safest approved remediation and verify recovery."
    : decision === "request-approval"
      ? "Request approval for a low-risk remediation action."
      : "Escalate to a human incident commander with AI context.";
  await fastify.pg.query(
    `UPDATE incidents SET status = CASE WHEN status = 'new' THEN 'triaging' ELSE status END,
       ai_state = 'triaged', ai_confidence = $1, ai_summary = $2, ai_next_action = $3, ai_decision = $4, updated_at = NOW()
     WHERE id = $5`,
    [inferredConfidence, summary, nextAction, decision, incidentId]
  );
  await fastify.pg.query(
    `INSERT INTO incident_events (incident_id, type, message, metadata) VALUES ($1, 'ai.triage', $2, $3)`,
    [incidentId, summary, JSON.stringify({ confidence: inferredConfidence, decision, relatedChangeCount, unhealthyCount })]
  );
  emit("incident.triaged", { incidentId, confidence: inferredConfidence, decision });
  return { incidentId, confidence: inferredConfidence, decision, summary, nextAction, relatedChangeCount, unhealthyCount };
});

registerTool<FastifyInstance>("incident-manager", {
  name: "recommend_remediation",
  description: "Propose safe remediation actions for an incident. High-risk actions require approval.",
  parameters: {
    type: "object",
    properties: {
      incidentId: { type: "string" },
    },
    required: ["incidentId"],
  },
}, async (args, fastify) => {
  const { incidentId } = toolArgs(args);
  const details = await incidentDetails(incidentId, fastify);
  if (details.error) return details;
  const hasRecentChange = (details.relatedChanges || []).some((change) => ["approved", "implemented"].includes(change.status || ""));
  const lowHealth = Object.values(details.ciHealth || {}).some((health) => Number(health.overall ?? 1) < 0.7);
  const proposals = [
    hasRecentChange
      ? { name: "Review and roll back the most recent related change", kind: "rollback", risk: "high", confidence: 0.72, approval: true }
      : { name: "Capture diagnostics and compare against known healthy baseline", kind: "diagnostic", risk: "low", confidence: 0.76, approval: false },
    lowHealth
      ? { name: "Run CI health remediation for stale or incomplete dependency data", kind: "cmdb-health", risk: "low", confidence: 0.68, approval: false }
      : { name: "Restart impacted service process after confirming redundancy", kind: "restart", risk: details.severity === "critical" ? "medium" : "low", confidence: 0.64, approval: details.severity === "critical" },
  ];
  const rows = [];
  for (const proposal of proposals) {
    const result = await fastify.pg.query(
      `INSERT INTO incident_actions (incident_id, name, kind, risk_level, confidence, requires_approval)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [incidentId, proposal.name, proposal.kind, proposal.risk, proposal.confidence, proposal.approval]
    );
    rows.push(result.rows[0]);
  }
  await fastify.pg.query(`INSERT INTO incident_events (incident_id, type, message, metadata) VALUES ($1, 'ai.remediation_recommended', $2, $3)`, [
    incidentId,
    `${rows.length} remediation actions proposed`,
    JSON.stringify({ actionIds: (rows as Array<{ id: string }>).map((row) => row.id) }),
  ]);
  emit("incident.actions_proposed", { incidentId, count: rows.length });
  return { incidentId, actions: rows };
});

registerTool<FastifyInstance>("incident-manager", {
  name: "execute_remediation",
  description: "Execute or simulate an approved remediation action and record the result for auditability.",
  parameters: {
    type: "object",
    properties: {
      actionId: { type: "string" },
      result: { type: "string" },
    },
    required: ["actionId"],
  },
}, async (args, fastify) => {
  const { actionId, result, _userId } = toolArgs(args);
  const actionResult = await fastify.pg.query(`SELECT * FROM incident_actions WHERE id = $1`, [actionId]);
  if (!actionResult.rows.length) return { error: "Action not found" };
  const action = actionResult.rows[0];
  if (action.requires_approval && action.status !== "approved") {
    return { error: "Action requires approval before execution" };
  }
  const executionResult = result || `Executed ${action.kind} action: ${action.name}`;
  const updated = await fastify.pg.query(
    `UPDATE incident_actions SET status = 'executed', result = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [executionResult, actionId]
  );
  await fastify.pg.query(
    `UPDATE incidents SET status = CASE WHEN status IN ('new', 'triaging') THEN 'remediating' ELSE status END, updated_at = NOW() WHERE id = $1`,
    [action.incident_id]
  );
  await fastify.pg.query(
    `INSERT INTO incident_events (incident_id, type, message, actor_id, metadata) VALUES ($1, 'action.executed', $2, $3, $4)`,
    [action.incident_id, executionResult, _userId || null, JSON.stringify({ actionId })]
  );
  emit("incident.action_executed", { incidentId: action.incident_id, actionId });
  return updated.rows[0];
});

registerTool<FastifyInstance>("incident-manager", {
  name: "approve_action",
  description: "Approve a proposed incident remediation action.",
  parameters: {
    type: "object",
    properties: {
      actionId: { type: "string" },
    },
    required: ["actionId"],
  },
}, async (args, fastify) => {
  const { actionId, _userId } = toolArgs(args);
  const result = await fastify.pg.query(
    `UPDATE incident_actions SET status = 'approved', approved_by = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [_userId || null, actionId]
  );
  if (!result.rows.length) return { error: "Action not found" };
  await fastify.pg.query(
    `INSERT INTO incident_events (incident_id, type, message, actor_id, metadata) VALUES ($1, 'action.approved', $2, $3, $4)`,
    [result.rows[0].incident_id, `Approved remediation: ${result.rows[0].name}`, _userId || null, JSON.stringify({ actionId })]
  );
  emit("incident.action_approved", { incidentId: result.rows[0].incident_id, actionId });
  return result.rows[0];
});

registerTool<FastifyInstance>("incident-manager", {
  name: "transition_incident",
  description: "Move an incident through its lifecycle and record an audit event.",
  parameters: {
    type: "object",
    properties: {
      incidentId: { type: "string" },
      status: { type: "string" },
      note: { type: "string" },
    },
    required: ["incidentId", "status"],
  },
}, async (args, fastify) => {
  const { incidentId, status, note, _userId } = toolArgs(args);
  const result = await fastify.pg.query(
    `UPDATE incidents SET status = $1::text,
       acknowledged_at = CASE WHEN $1::text IN ('investigating', 'major', 'remediating') AND acknowledged_at IS NULL THEN NOW() ELSE acknowledged_at END,
       resolved_at = CASE WHEN $1::text IN ('resolved', 'closed') THEN NOW() ELSE resolved_at END,
       updated_at = NOW()
     WHERE id = $2::uuid RETURNING *`,
    [status, incidentId]
  );
  if (!result.rows.length) return { error: "Incident not found" };
  await fastify.pg.query(
    `INSERT INTO incident_events (incident_id, type, message, actor_id) VALUES ($1::uuid, 'status.changed', $2::text, $3::uuid)`,
    [incidentId, note || `Status changed to ${status}`, _userId || null]
  );
  emit("incident.status_changed", { incidentId, status, actorId: _userId });
  return result.rows[0];
});

registerTool<FastifyInstance>("incident-manager", {
  name: "record_incident_event",
  description: "Append a timeline event, work note, stakeholder update, or external process marker to an incident.",
  parameters: {
    type: "object",
    properties: {
      incidentId: { type: "string" },
      type: { type: "string" },
      message: { type: "string" },
      metadata: { type: "object", properties: {} },
    },
    required: ["incidentId", "message"],
  },
}, async (args, fastify) => {
  const { incidentId, type = "note", message, metadata = {}, _userId } = toolArgs(args);
  const result = await fastify.pg.query(
    `INSERT INTO incident_events (incident_id, type, message, actor_id, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [incidentId, type, message, _userId || null, JSON.stringify(metadata)]
  );
  emit("incident.event_recorded", { incidentId, type });
  return result.rows[0];
});

registerTool<FastifyInstance>("incident-manager", {
  name: "draft_stakeholder_update",
  description: "Draft a concise stakeholder update from the current incident state.",
  parameters: {
    type: "object",
    properties: {
      incidentId: { type: "string" },
    },
    required: ["incidentId"],
  },
}, async (args, fastify) => {
  const { incidentId } = toolArgs(args);
  const details = await incidentDetails(incidentId, fastify);
  if (details.error) return details;
  const update = `${details.severity?.toUpperCase?.() || "MEDIUM"} incident: ${details.title}. Current status: ${details.status}. ${details.ai_summary || "Investigation is in progress."} Next: ${details.ai_next_action || "Responder review is underway."}`;
  return { incidentId, update, audience: details.status === "major" ? "executive-and-customer" : "internal" };
});

registerTool<FastifyInstance>("incident-manager", {
  name: "generate_postmortem",
  description: "Create a blameless post-incident review draft with prevention items.",
  parameters: {
    type: "object",
    properties: {
      incidentId: { type: "string" },
    },
    required: ["incidentId"],
  },
}, async (args, fastify) => {
  const { incidentId, _userId } = toolArgs(args);
  const details = await incidentDetails(incidentId, fastify);
  if (details.error) return details;
  const preventionItems = [
    { type: "health", title: "Add or tune proactive health signal", source: "incident-manager" },
    { type: "runbook", title: "Codify successful remediation as an approved action", source: "incident-manager" },
    ...(details.relatedChanges?.length ? [{ type: "change", title: "Review change guardrails for related services", source: "incident-manager" }] : []),
  ];
  const summary = `Incident ${details.title} affected ${details.service || details.ci_id || "an unmapped service"} and reached ${details.status}. ${details.ai_summary || "The timeline should be reviewed for contributing factors."}`;
  const result = await fastify.pg.query(
    `INSERT INTO incident_postmortems (incident_id, summary, root_cause, prevention_items, generated_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [incidentId, summary, "Draft pending human review", JSON.stringify(preventionItems), _userId || null]
  );
  await fastify.pg.query(`INSERT INTO incident_events (incident_id, type, message, actor_id) VALUES ($1, 'postmortem.generated', 'Post-incident review draft generated', $2)`, [incidentId, _userId || null]);
  emit("incident.postmortem_generated", { incidentId });
  return result.rows[0];
});
}
