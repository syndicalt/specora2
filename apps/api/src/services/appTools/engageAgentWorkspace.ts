import { FastifyInstance } from "fastify";
import { registerTool } from "@specora/sdk";
import { emit } from "../eventBus";

function parseJson(value: unknown, fallback: any) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function normalizeRequest(row: any) {
  return {
    ...row,
    answers: parseJson(row.answers, {}),
    ai_resolution: parseJson(row.ai_resolution, {}),
    fulfillment_plan: parseJson(row.fulfillment_plan, []),
  };
}

function generateAgentLinks(request: any) {
  const text = `${request.title || ""} ${request.description || ""} ${request.intent_summary || ""}`.toLowerCase();
  const links = [
    { title: "Microsoft Entra access troubleshooting", url: "https://learn.microsoft.com/en-us/entra/identity/", type: "vendor_reference", reason: "Useful for access and identity fulfillment." },
    { title: "Ubuntu Server documentation", url: "https://documentation.ubuntu.com/server/", type: "vendor_reference", reason: "Useful for Linux workstation or server support." },
    { title: "Cisco support knowledge base", url: "https://www.cisco.com/c/en/us/support/index.html", type: "vendor_reference", reason: "Useful for network, voice, or routing support." },
  ];
  if (/access|permission|role|login|identity/.test(text)) return [links[0]];
  if (/ubuntu|linux|server/.test(text)) return [links[1]];
  if (/phone|call|cisco|network/.test(text)) return [links[2]];
  return links.slice(0, 2);
}

function nextBestAction(request: any) {
  if (request.status === "submitted") return "Triage the request, verify requester intent, and assign an owner.";
  if (request.status === "triaged") return "Confirm required inputs and start the fulfillment plan.";
  if (request.status === "in_progress") return "Work the next fulfillment step or ask the requester for missing information.";
  if (request.status === "blocked") return "Resolve the blocker or escalate with context.";
  return "Review the request history and decide whether additional action is needed.";
}

async function getRequestBundle(fastify: FastifyInstance, requestId: string) {
  const [request, events, handoffs] = await Promise.all([
    fastify.pg.query(
      `SELECT r.*, ci.title AS catalog_title, ci.category AS catalog_category, ci.fulfillment_group,
              u.name AS requester_name, u.email AS requester_email
       FROM catalog_requests r
       LEFT JOIN catalog_items ci ON ci.id = r.catalog_item_id
       LEFT JOIN users u ON u.id = r.requester_id
       WHERE r.id = $1`,
      [requestId]
    ),
    fastify.pg.query(
      `SELECT e.*, u.name AS actor_name
       FROM catalog_request_events e
       LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.request_id = $1
       ORDER BY e.created_at ASC`,
      [requestId]
    ),
    fastify.pg.query(
      `SELECT h.*, c.name AS channel_name, c.channel_type
       FROM support_handoffs h
       LEFT JOIN support_channels c ON c.id = h.channel_id
       WHERE h.request_id = $1
       ORDER BY h.created_at DESC`,
      [requestId]
    ),
  ]);
  if (!request.rows.length) return null;
  const normalized = normalizeRequest(request.rows[0]);
  const search = `%${String(normalized.title || normalized.description || "").slice(0, 80)}%`;
  const knowledge = await fastify.pg.query(
    `SELECT id, title, type, status, summary, trust_score, health_score, updated_at
     FROM knowledge_items
     WHERE status = 'published'
       AND (LOWER(title) LIKE LOWER($1) OR LOWER(summary) LIKE LOWER($1) OR LOWER(content) LIKE LOWER($1))
     ORDER BY trust_score DESC NULLS LAST, updated_at DESC
     LIMIT 5`,
    [search]
  ).catch(() => ({ rows: [] }));
  return {
    request: normalized,
    events: events.rows,
    handoffs: handoffs.rows,
    knowledge: knowledge.rows,
    agentLinks: generateAgentLinks(normalized),
    nextBestAction: nextBestAction(normalized),
  };
}

export function registerEngageAgentWorkspaceTools() {
  registerTool<FastifyInstance>("engage-agent-workspace", {
    name: "workspace_home",
    description: "Return queue metrics and catalog requests for the Engage Agent Workspace.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string" },
        search: { type: "string" },
        limit: { type: "integer" },
      },
    },
  }, async (args, fastify) => {
    const { status, search, limit = 50 } = args as any;
    const params: any[] = [];
    let where = "WHERE 1=1";
    if (status && status !== "all") {
      params.push(status);
      where += ` AND r.status = $${params.length}`;
    }
    if (search) {
      params.push(`%${String(search).slice(0, 120)}%`);
      where += ` AND (LOWER(r.title) LIKE LOWER($${params.length}) OR LOWER(r.number) LIKE LOWER($${params.length}) OR LOWER(r.description) LIKE LOWER($${params.length}))`;
    }
    params.push(Math.min(Number(limit) || 50, 100));
    const [requests, metrics] = await Promise.all([
      fastify.pg.query(
        `SELECT r.*, ci.title AS catalog_title, ci.category AS catalog_category, ci.fulfillment_group,
                u.name AS requester_name, u.email AS requester_email
         FROM catalog_requests r
         LEFT JOIN catalog_items ci ON ci.id = r.catalog_item_id
         LEFT JOIN users u ON u.id = r.requester_id
         ${where}
         ORDER BY
           CASE WHEN r.status IN ('submitted', 'triaged', 'blocked') THEN 0 ELSE 1 END,
           r.priority ASC,
           r.created_at ASC
         LIMIT $${params.length}`,
        params
      ),
      fastify.pg.query(
        `SELECT status, COUNT(*)::int AS count
         FROM catalog_requests
         GROUP BY status`
      ),
    ]);
    return {
      queues: metrics.rows,
      requests: requests.rows.map(normalizeRequest),
      operatingModel: {
        role: "Unified fulfillment workspace for catalog requests across portals.",
        freeTier: "Queue, detail, transitions, timeline, and requester context.",
        engageTier: "AI brief, suggested knowledge, external links, fulfillment plan, and cross-app actions.",
      },
    };
  });

  registerTool<FastifyInstance>("engage-agent-workspace", {
    name: "get_request_workbench",
    description: "Get request details, timeline, related knowledge, generated links, handoffs, and agent next-best-action context.",
    parameters: { type: "object", properties: { requestId: { type: "string" } }, required: ["requestId"] },
  }, async (args, fastify) => {
    const bundle = await getRequestBundle(fastify, String((args as any).requestId || ""));
    if (!bundle) return { error: "Request not found" };
    return bundle;
  });

  registerTool<FastifyInstance>("engage-agent-workspace", {
    name: "update_request",
    description: "Update catalog request status, priority, assignment metadata, or add an agent work note.",
    parameters: {
      type: "object",
      properties: {
        requestId: { type: "string" },
        status: { type: "string" },
        priority: { type: "integer" },
        assignmentGroup: { type: "string" },
        workNote: { type: "string" },
      },
      required: ["requestId"],
    },
  }, async (args, fastify) => {
    const { requestId, status, priority, assignmentGroup, workNote, _userId } = args as any;
    const existing = await fastify.pg.query("SELECT * FROM catalog_requests WHERE id = $1", [requestId]);
    if (!existing.rows.length) return { error: "Request not found" };
    const current = normalizeRequest(existing.rows[0]);
    const answers = { ...current.answers };
    if (assignmentGroup !== undefined) answers.assignmentGroup = assignmentGroup;
    const result = await fastify.pg.query(
      `UPDATE catalog_requests
       SET status = COALESCE($1::text, status),
           priority = COALESCE($2::int, priority),
           answers = $3::jsonb,
           updated_at = NOW()
       WHERE id = $4::uuid
       RETURNING *`,
      [status || null, priority ?? null, JSON.stringify(answers), requestId]
    );
    const messages = [];
    if (status && status !== current.status) messages.push(`Status changed from ${current.status} to ${status}`);
    if (priority !== undefined && priority !== current.priority) messages.push(`Priority changed from ${current.priority} to ${priority}`);
    if (assignmentGroup) messages.push(`Assigned to ${assignmentGroup}`);
    if (workNote) messages.push(workNote);
    for (const message of messages.length ? messages : ["Request updated"]) {
      await fastify.pg.query(
        `INSERT INTO catalog_request_events (request_id, type, message, actor_id, metadata)
         VALUES ($1, 'agent.update', $2, $3, $4)`,
        [requestId, message, _userId || null, JSON.stringify({ status, priority, assignmentGroup })]
      );
    }
    emit("catalog.request.updated", { requestId, status: result.rows[0].status, priority: result.rows[0].priority });
    return normalizeRequest(result.rows[0]);
  });

  registerTool<FastifyInstance>("engage-agent-workspace", {
    name: "draft_agent_brief",
    description: "Draft an agent brief with summary, risks, next actions, requester update, and useful references.",
    parameters: { type: "object", properties: { requestId: { type: "string" } }, required: ["requestId"] },
  }, async (args, fastify) => {
    const bundle = await getRequestBundle(fastify, String((args as any).requestId || ""));
    if (!bundle) return { error: "Request not found" };
    const { request, knowledge, agentLinks } = bundle;
    return {
      summary: request.intent_summary || request.description || `${request.number || "Request"} needs fulfillment for ${request.title}.`,
      nextBestAction: bundle.nextBestAction,
      risks: request.priority <= 2 ? ["High priority request: verify impact and communicate frequently."] : ["No high-risk indicators detected from current request metadata."],
      requesterUpdate: `We are reviewing ${request.number || "your request"} and will proceed with the next fulfillment step: ${bundle.nextBestAction}`,
      knowledge,
      agentLinks,
    };
  });
}
