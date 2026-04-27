import { FastifyInstance } from "fastify";
import { registerTool } from "@specora/sdk";
import { emit } from "../eventBus";
import { assignRecordNumberToRow } from "../numberSequences";

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

function normalizeItem(row: any) {
  return {
    ...row,
    questions: parseJson(row.questions, []),
    fulfillment: parseJson(row.fulfillment, []),
    audience: parseJson(row.audience, []),
    related_knowledge_ids: parseJson(row.related_knowledge_ids, []),
  };
}

function normalizeRequest(row: any) {
  return {
    ...row,
    answers: parseJson(row.answers, {}),
    ai_resolution: parseJson(row.ai_resolution, {}),
    fulfillment_plan: parseJson(row.fulfillment_plan, []),
  };
}

function classifyIntent(input: string) {
  const text = input.toLowerCase();
  if (/can't|cannot|down|broken|error|issue|outage|slow|latency|not working/.test(text)) return "incident_intake";
  if (/access|permission|role|login|entitlement/.test(text)) return "access_request";
  if (/laptop|monitor|keyboard|mouse|hardware|device|loaner|replacement/.test(text)) return "hardware_request";
  if (/software|license|install|application/.test(text)) return "software_request";
  if (/how do|how can|what is|where is|policy|guide|runbook/.test(text)) return "knowledge_request";
  return "service_request";
}

function defaultPriority(intent: string, urgency?: string) {
  if (urgency === "critical") return 1;
  if (urgency === "high" || intent === "incident_intake") return 2;
  if (urgency === "low") return 4;
  return 3;
}

export function registerCustomerPortalTools() {
  registerTool<FastifyInstance>("customer-portal", {
    name: "portal_home",
    description: "Return the Customer Portal home model: featured catalog items, user's recent requests, support channels, and portal guidance.",
    parameters: { type: "object", properties: { limit: { type: "integer" } } },
  }, async (args, fastify) => {
    const { _userId, limit = 8 } = args as any;
    const [items, requests, channels] = await Promise.all([
      fastify.pg.query(
        `SELECT * FROM catalog_items WHERE status = 'published' ORDER BY category, title LIMIT $1`,
        [Math.min(Number(limit) || 8, 25)]
      ),
      _userId
        ? fastify.pg.query(
            `SELECT * FROM catalog_requests WHERE requester_id = $1 ORDER BY created_at DESC LIMIT 8`,
            [_userId]
          )
        : Promise.resolve({ rows: [] }),
      fastify.pg.query(
        `SELECT id, name, channel_type, description, target, priority FROM support_channels WHERE enabled = TRUE ORDER BY priority, name LIMIT 8`
      ),
    ]);
    return {
      portal: {
        name: "Customer Portal",
        premiumExpansion: "Specora Engage",
        operatingModel: "Describe the outcome. Specora answers, requests, fixes, routes, or escalates with context.",
      },
      featuredItems: items.rows.map(normalizeItem),
      myRequests: requests.rows.map(normalizeRequest),
      supportChannels: channels.rows,
    };
  });

  registerTool<FastifyInstance>("customer-portal", {
    name: "resolve_intent",
    description: "Classify a user need into an Intent Resolution Card with catalog, knowledge, incident, and support handoff guidance.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string" },
        urgency: { type: "string", enum: ["low", "medium", "high", "critical"] },
        service: { type: "string" },
      },
      required: ["message"],
    },
  }, async (args, fastify) => {
    const { message, urgency = "medium", service } = args as any;
    const intent = classifyIntent(String(message || ""));
    const item = await fastify.pg.query(
      `SELECT * FROM catalog_items
       WHERE status = 'published' AND item_type = $1
       ORDER BY title
       LIMIT 1`,
      [intent]
    );
    const knowledge = await fastify.pg.query(
      `SELECT id, title, type, status, health_score, trust_score
       FROM knowledge_items
       WHERE status = 'published'
         AND (
           LOWER(title) LIKE LOWER($1)
           OR LOWER(summary) LIKE LOWER($1)
           OR LOWER(content) LIKE LOWER($1)
         )
       ORDER BY trust_score DESC NULLS LAST, updated_at DESC
       LIMIT 3`,
      [`%${String(service || message).slice(0, 80)}%`]
    ).catch(() => ({ rows: [] }));
    const channels = await fastify.pg.query(
      `SELECT id, name, channel_type, description, target, priority
       FROM support_channels
       WHERE enabled = TRUE
       ORDER BY priority, name
       LIMIT 5`
    );
    const confidence = item.rows.length ? 0.78 : 0.52;
    return {
      intent,
      confidence,
      title: intent === "incident_intake" ? "Potential technology issue" : item.rows[0]?.title || "General service request",
      summary: `Classified as ${intent.replace(/_/g, " ")} from the user's request.`,
      recommendedAction: confidence >= 0.7 ? "submit_or_deflect" : "ask_clarifying_question",
      catalogItem: item.rows[0] ? normalizeItem(item.rows[0]) : null,
      knowledgeCandidates: knowledge.rows,
      supportChannels: channels.rows,
      missingFields: item.rows[0] ? normalizeItem(item.rows[0]).questions.filter((q: any) => q.required).map((q: any) => q.key) : [],
      priority: defaultPriority(intent, urgency),
    };
  });

  registerTool<FastifyInstance>("customer-portal", {
    name: "submit_request",
    description: "Submit a catalog/customer portal request from conversational or form intake.",
    parameters: {
      type: "object",
      properties: {
        catalogItemId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        requestType: { type: "string" },
        answers: { type: "object" },
        urgency: { type: "string" },
        source: { type: "string" },
        intentSummary: { type: "string" },
      },
      required: ["title"],
    },
  }, async (args, fastify) => {
    const { catalogItemId, title, description, requestType, answers = {}, urgency, source = "portal", intentSummary, _userId } = args as any;
    const item = catalogItemId
      ? await fastify.pg.query("SELECT * FROM catalog_items WHERE id = $1", [catalogItemId])
      : { rows: [] };
    const itemType = requestType || item.rows[0]?.item_type || classifyIntent(`${title} ${description || ""}`);
    const fulfillment = item.rows[0]?.fulfillment ? parseJson(item.rows[0].fulfillment, []) : [];
    const result = await fastify.pg.query(
      `INSERT INTO catalog_requests (
         requester_id, catalog_item_id, title, description, request_type, priority, source,
         intent_summary, answers, ai_resolution, fulfillment_plan
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        _userId || null,
        catalogItemId || null,
        title,
        description || null,
        itemType,
        defaultPriority(itemType, urgency),
        source,
        intentSummary || null,
        JSON.stringify(answers),
        JSON.stringify({ intent: itemType, confidence: item.rows[0] ? 0.8 : 0.55, generatedBy: "customer-portal" }),
        JSON.stringify(fulfillment),
      ]
    );
    const request = normalizeRequest(await assignRecordNumberToRow(fastify, "catalog_requests", result.rows[0]));
    await fastify.pg.query(
      `INSERT INTO catalog_request_events (request_id, type, message, actor_id, metadata)
       VALUES ($1, 'submitted', $2, $3, $4)`,
      [request.id, `Request ${request.number || request.id} submitted`, _userId || null, JSON.stringify({ source, itemType })]
    );
    emit("catalog.request.submitted", { requestId: request.id, number: request.number, requestType: itemType });
    return request;
  });

  registerTool<FastifyInstance>("customer-portal", {
    name: "list_my_requests",
    description: "List customer portal requests for the current user.",
    parameters: { type: "object", properties: { status: { type: "string" }, limit: { type: "integer" } } },
  }, async (args, fastify) => {
    const { _userId, status, limit = 25 } = args as any;
    const params: any[] = [];
    let sql = `SELECT r.*, ci.title as catalog_title
               FROM catalog_requests r
               LEFT JOIN catalog_items ci ON ci.id = r.catalog_item_id
               WHERE 1=1`;
    if (_userId) {
      params.push(_userId);
      sql += ` AND r.requester_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND r.status = $${params.length}`;
    }
    params.push(Math.min(Number(limit) || 25, 100));
    sql += ` ORDER BY r.created_at DESC LIMIT $${params.length}`;
    const result = await fastify.pg.query(sql, params);
    return result.rows.map(normalizeRequest);
  });

  registerTool<FastifyInstance>("customer-portal", {
    name: "get_request_details",
    description: "Get full request details, timeline, and recommended support handoff context.",
    parameters: { type: "object", properties: { requestId: { type: "string" } }, required: ["requestId"] },
  }, async (args, fastify) => {
    const { requestId } = args as any;
    const [request, events, handoffs] = await Promise.all([
      fastify.pg.query(`SELECT r.*, ci.title as catalog_title FROM catalog_requests r LEFT JOIN catalog_items ci ON ci.id = r.catalog_item_id WHERE r.id = $1`, [requestId]),
      fastify.pg.query(`SELECT * FROM catalog_request_events WHERE request_id = $1 ORDER BY created_at ASC`, [requestId]),
      fastify.pg.query(`SELECT h.*, c.name as channel_name, c.channel_type FROM support_handoffs h LEFT JOIN support_channels c ON c.id = h.channel_id WHERE h.request_id = $1 ORDER BY h.created_at DESC`, [requestId]),
    ]);
    if (!request.rows.length) return { error: "Request not found" };
    return { ...normalizeRequest(request.rows[0]), events: events.rows, handoffs: handoffs.rows };
  });

  registerTool<FastifyInstance>("customer-portal", {
    name: "request_support_handoff",
    description: "Create a support handoff or callback request with full portal/chat context for call routing platforms such as Cisco UCM.",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string" },
        requestId: { type: "string" },
        incidentId: { type: "string" },
        reason: { type: "string" },
        context: { type: "object" },
      },
    },
  }, async (args, fastify) => {
    const { channelId, requestId, incidentId, reason, context = {}, _userId } = args as any;
    const selectedChannel = channelId
      ? await fastify.pg.query("SELECT * FROM support_channels WHERE id = $1 AND enabled = TRUE", [channelId])
      : await fastify.pg.query("SELECT * FROM support_channels WHERE enabled = TRUE ORDER BY priority, name LIMIT 1");
    if (!selectedChannel.rows.length) return { error: "No enabled support channel found" };
    const channel = selectedChannel.rows[0];
    const result = await fastify.pg.query(
      `INSERT INTO support_handoffs (channel_id, requester_id, request_id, incident_id, reason, context)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [channel.id, _userId || null, requestId || null, incidentId || null, reason || null, JSON.stringify(context)]
    );
    if (requestId) {
      await fastify.pg.query(
        `INSERT INTO catalog_request_events (request_id, type, message, actor_id, metadata)
         VALUES ($1, 'support.handoff_requested', $2, $3, $4)`,
        [requestId, `Support handoff requested via ${channel.name}`, _userId || null, JSON.stringify({ channelType: channel.channel_type })]
      );
    }
    emit("support.handoff.requested", { handoffId: result.rows[0].id, channelId: channel.id, requestId, incidentId });
    return { ...result.rows[0], channel };
  });
}
