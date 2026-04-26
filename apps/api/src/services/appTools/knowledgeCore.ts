import { FastifyInstance } from "fastify";
import { registerTool } from "@specora/sdk";
import { emit } from "../eventBus";
import { assignRecordNumberToRow } from "../numberSequences";

export function registerKnowledgeCoreTools() {
function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean).slice(0, 20);
}

function scoreKnowledgeHealth(item: any) {
  const freshnessDays = item.last_validated_at
    ? Math.floor((Date.now() - new Date(item.last_validated_at).getTime()) / 86400000)
    : 999;
  const freshness = item.status === "published" ? Math.max(0, 1 - freshnessDays / 180) : 0.45;
  const usage = Math.min(1, Number(item.reuse_count || 0) / 25);
  const deflection = Math.min(1, Number(item.deflection_count || 0) / 10);
  const trust = Number(item.trust_score || 0.5);
  return Math.round(((freshness * 0.35) + (usage * 0.2) + (deflection * 0.2) + (trust * 0.25)) * 100) / 100;
}

function knowledgeAnswer(query: string, rows: any[]) {
  if (rows.length === 0) {
    return {
      answer: `No governed knowledge matched "${query}". A knowledge gap was recorded so the topic can be captured.`,
      confidence: 0,
      citations: [],
      recommendedAction: "Create or draft knowledge from the next solved interaction.",
    };
  }
  const top = rows[0];
  const confidence = Math.min(0.96, 0.35 + Number(top.trust_score || 0) * 0.35 + Math.min(Number(top.reuse_count || 0), 20) / 100);
  return {
    answer: top.summary || top.content.slice(0, 420),
    confidence: Math.round(confidence * 100) / 100,
    citations: rows.slice(0, 5).map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      status: row.status,
      healthScore: row.health_score,
      trustScore: row.trust_score,
    })),
    recommendedAction: top.type === "runbook" ? "Review the runbook actions before execution." : "Use the cited knowledge and mark whether it solved the need.",
  };
}

registerTool<FastifyInstance>("knowledge-core", {
  name: "create_knowledge",
  description: "Create a governed knowledge object: article, runbook, known error, decision, service guide, FAQ, policy, or postmortem learning.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      summary: { type: "string" },
      type: { type: "string", enum: ["article", "runbook", "known_error", "decision", "service_guide", "faq", "policy", "postmortem_learning"] },
      status: { type: "string", enum: ["draft", "review", "published", "retired"] },
      audience: { type: "string", enum: ["internal", "self_service", "engineering", "executive"] },
      source: { type: "string" },
      sourceRef: { type: "string" },
      service: { type: "string" },
      ciId: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      links: { type: "array", items: { type: "object", properties: {} } },
    },
    required: ["title", "content"],
  },
}, async (args, fastify) => {
  const { title, content, summary, type = "article", status = "draft", audience = "internal", source = "manual", sourceRef, service, ciId, links, _userId } = args as any;
  const tags = normalizeTags(args.tags);
  const trustScore = status === "published" ? 0.72 : 0.48;
  const result = await fastify.pg.query(
    `INSERT INTO knowledge_items (title, content, summary, type, status, audience, source, source_ref, service, ci_id, tags, owner_id, trust_score, ai_confidence, last_validated_at, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CASE WHEN $5 = 'published' THEN NOW() ELSE NULL END, CASE WHEN $5 = 'published' THEN NOW() ELSE NULL END)
     RETURNING *`,
    [title, content, summary || null, type, status, audience, source, sourceRef || null, service || null, ciId || null, tags, _userId || null, trustScore, source === "ai" ? 0.68 : 0]
  );
  const item = await assignRecordNumberToRow(fastify, "knowledge_items", result.rows[0]);
  if (Array.isArray(links)) {
    for (const link of links) {
      if (!link?.targetType || !link?.targetId) continue;
      await fastify.pg.query(
        `INSERT INTO knowledge_links (knowledge_id, target_type, target_id, relationship) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [item.id, link.targetType, link.targetId, link.relationship || "related"]
      );
    }
  }
  const health = scoreKnowledgeHealth(item);
  await fastify.pg.query(`UPDATE knowledge_items SET health_score = $1 WHERE id = $2`, [health, item.id]);
  await fastify.pg.query(
    `INSERT INTO knowledge_events (knowledge_id, type, message, actor_id, metadata) VALUES ($1, 'created', $2, $3, $4)`,
    [item.id, `Knowledge ${status === "published" ? "published" : "created"} from ${source}`, _userId || null, JSON.stringify({ sourceRef, type })]
  );
  emit("knowledge.created", { knowledgeId: item.id, title, type, status, source });
  if (status === "published") emit("knowledge.published", { knowledgeId: item.id, title, type });
  return { ...item, health_score: health };
});

registerTool<FastifyInstance>("knowledge-core", {
  name: "list_knowledge",
  description: "List governed knowledge objects with optional type, status, tag, or CI filters.",
  parameters: {
    type: "object",
    properties: {
      type: { type: "string" },
      status: { type: "string" },
      tag: { type: "string" },
      ciId: { type: "string" },
      limit: { type: "integer" },
    },
  },
}, async (args, fastify) => {
  const { type, status, tag, ciId, limit = 100 } = args as any;
  const params: any[] = [];
  let query = `SELECT * FROM knowledge_items WHERE 1=1`;
  if (type) {
    params.push(type);
    query += ` AND type = $${params.length}`;
  }
  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }
  if (tag) {
    params.push(String(tag).toLowerCase());
    query += ` AND $${params.length} = ANY(tags)`;
  }
  if (ciId) {
    params.push(ciId);
    query += ` AND ci_id = $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 100, 250));
  query += ` ORDER BY status = 'published' DESC, health_score ASC, updated_at DESC LIMIT $${params.length}`;
  const result = await fastify.pg.query(query, params);
  return result.rows.map((row: any) => ({ ...row, health_score: scoreKnowledgeHealth(row) }));
});

registerTool<FastifyInstance>("knowledge-core", {
  name: "get_knowledge_details",
  description: "Get a full knowledge object with graph links, feedback, and lifecycle events.",
  parameters: {
    type: "object",
    properties: {
      knowledgeId: { type: "string" },
    },
    required: ["knowledgeId"],
  },
}, async (args, fastify) => {
  const { knowledgeId } = args as any;
  const itemResult = await fastify.pg.query(`SELECT * FROM knowledge_items WHERE id = $1`, [knowledgeId]);
  if (!itemResult.rows.length) return { error: "Knowledge not found" };
  const [links, feedback, events] = await Promise.all([
    fastify.pg.query(`SELECT * FROM knowledge_links WHERE knowledge_id = $1 ORDER BY created_at DESC`, [knowledgeId]),
    fastify.pg.query(`SELECT f.*, u.name as user_name FROM knowledge_feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.knowledge_id = $1 ORDER BY created_at DESC LIMIT 50`, [knowledgeId]),
    fastify.pg.query(`SELECT e.*, u.name as actor FROM knowledge_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.knowledge_id = $1 ORDER BY created_at ASC`, [knowledgeId]),
  ]);
  const item = itemResult.rows[0];
  return {
    ...item,
    health_score: scoreKnowledgeHealth(item),
    links: links.rows,
    feedback: feedback.rows,
    events: events.rows,
  };
});

registerTool<FastifyInstance>("knowledge-core", {
  name: "answer",
  description: "Answer a user or agent question using governed knowledge with citations, confidence, and gap capture.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      audience: { type: "string" },
      ciId: { type: "string" },
      service: { type: "string" },
      recordUse: { type: "boolean" },
    },
    required: ["query"],
  },
}, async (args, fastify) => {
  const { query, audience, ciId, service, recordUse = true, _userId } = args as any;
  const params: any[] = [`%${String(query).toLowerCase()}%`];
  let sql = `SELECT * FROM knowledge_items
     WHERE status = 'published'
       AND (LOWER(title) LIKE $1 OR LOWER(summary) LIKE $1 OR LOWER(content) LIKE $1 OR EXISTS (SELECT 1 FROM unnest(tags) tag WHERE tag LIKE $1))`;
  if (audience) {
    params.push(audience);
    sql += ` AND audience IN ($${params.length}, 'internal')`;
  }
  if (ciId) {
    params.push(ciId);
    sql += ` AND (ci_id = $${params.length} OR EXISTS (SELECT 1 FROM knowledge_links kl WHERE kl.knowledge_id = knowledge_items.id AND kl.target_id = $${params.length}))`;
  }
  if (service) {
    params.push(service);
    sql += ` AND LOWER(COALESCE(service, '')) = LOWER($${params.length})`;
  }
  sql += ` ORDER BY trust_score DESC, reuse_count DESC, updated_at DESC LIMIT 5`;
  const result = await fastify.pg.query(sql, params);
  if (result.rows.length === 0) {
    await fastify.pg.query(
      `INSERT INTO knowledge_gaps (query, context)
       VALUES ($1, $2)
       ON CONFLICT (query) DO UPDATE SET demand_count = knowledge_gaps.demand_count + 1, updated_at = NOW()
       RETURNING *`,
      [query, JSON.stringify({ audience, ciId, service, userId: _userId })]
    );
    emit("knowledge.gap_detected", { query, audience, ciId, service });
  } else if (recordUse) {
    await fastify.pg.query(`UPDATE knowledge_items SET reuse_count = reuse_count + 1, updated_at = NOW() WHERE id = $1`, [result.rows[0].id]);
    await fastify.pg.query(
      `INSERT INTO knowledge_events (knowledge_id, type, message, actor_id, metadata) VALUES ($1, 'used', $2, $3, $4)`,
      [result.rows[0].id, `Knowledge used to answer: ${query}`, _userId || null, JSON.stringify({ audience, ciId, service })]
    );
    emit("knowledge.used", { knowledgeId: result.rows[0].id, query });
  }
  return knowledgeAnswer(query, result.rows);
});

registerTool<FastifyInstance>("knowledge-core", {
  name: "draft_from_record",
  description: "Draft a knowledge object from an incident, change, chat answer, health finding, discovery finding, or external process.",
  parameters: {
    type: "object",
    properties: {
      sourceType: { type: "string", enum: ["incident", "change", "chat", "health", "discovery", "external"] },
      sourceId: { type: "string" },
      title: { type: "string" },
      notes: { type: "string" },
      type: { type: "string" },
    },
    required: ["sourceType", "sourceId"],
  },
}, async (args, fastify) => {
  const { sourceType, sourceId, title, notes, type, _userId } = args as any;
  let inferredTitle = title || `${sourceType} learning: ${sourceId}`;
  let service: string | null = null;
  let ciId: string | null = null;
  let sourceSummary = notes || "";
  const links = [{ targetType: sourceType, targetId: sourceId, relationship: "generated_from" }];

  if (sourceType === "incident") {
    const incident = await fastify.pg.query(`SELECT title, description, service, ci_id, ai_summary, ai_next_action FROM incidents WHERE id = $1`, [sourceId]);
    if (incident.rows[0]) {
      const row = incident.rows[0];
      inferredTitle = title || `Known error: ${row.title}`;
      service = row.service;
      ciId = row.ci_id;
      sourceSummary = [row.description, row.ai_summary, row.ai_next_action, notes].filter(Boolean).join("\n\n");
    }
  } else if (sourceType === "change") {
    const change = await fastify.pg.query(`SELECT title, description, ci_id, priority FROM change_requests WHERE id = $1`, [sourceId]);
    if (change.rows[0]) {
      const row = change.rows[0];
      inferredTitle = title || `Change implementation guide: ${row.title}`;
      ciId = row.ci_id;
      sourceSummary = [row.description, notes].filter(Boolean).join("\n\n");
    }
  }

  const content = `Context\n${sourceSummary || "No source notes supplied."}\n\nResolution\nCapture the validated steps, safeguards, and outcome.\n\nReuse Guidance\nWhen this applies, how to verify it, and when to escalate.\n\nAutomation Safety\nMark actions safe only after owner review.`;
  return (await import("@specora/sdk")).executeTool("knowledge-core_create_knowledge", {
    title: inferredTitle,
    summary: sourceSummary.slice(0, 500) || `Drafted from ${sourceType} ${sourceId}`,
    content,
    type: type || (sourceType === "incident" ? "known_error" : sourceType === "change" ? "runbook" : "article"),
    status: "draft",
    audience: "internal",
    source: sourceType,
    sourceRef: sourceId,
    service,
    ciId,
    tags: [sourceType, "ai-draft"],
    links,
    _userId,
  }, fastify);
});

registerTool<FastifyInstance>("knowledge-core", {
  name: "publish_knowledge",
  description: "Publish or retire a knowledge object and update trust/validation metadata.",
  parameters: {
    type: "object",
    properties: {
      knowledgeId: { type: "string" },
      status: { type: "string", enum: ["draft", "review", "published", "retired"] },
      note: { type: "string" },
    },
    required: ["knowledgeId", "status"],
  },
}, async (args, fastify) => {
  const { knowledgeId, status, note, _userId } = args as any;
  const result = await fastify.pg.query(
    `UPDATE knowledge_items SET status = $1,
       trust_score = CASE WHEN $1 = 'published' THEN GREATEST(trust_score, 0.78) ELSE trust_score END,
       last_validated_at = CASE WHEN $1 = 'published' THEN NOW() ELSE last_validated_at END,
       published_at = CASE WHEN $1 = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END,
       retired_at = CASE WHEN $1 = 'retired' THEN NOW() ELSE retired_at END,
       updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [status, knowledgeId]
  );
  if (!result.rows.length) return { error: "Knowledge not found" };
  const item = result.rows[0];
  const health = scoreKnowledgeHealth(item);
  await fastify.pg.query(`UPDATE knowledge_items SET health_score = $1 WHERE id = $2`, [health, knowledgeId]);
  await fastify.pg.query(
    `INSERT INTO knowledge_events (knowledge_id, type, message, actor_id, metadata) VALUES ($1, 'status.changed', $2, $3, $4)`,
    [knowledgeId, note || `Status changed to ${status}`, _userId || null, JSON.stringify({ status })]
  );
  emit(status === "published" ? "knowledge.published" : "knowledge.status_changed", { knowledgeId, status });
  return { ...item, health_score: health };
});

registerTool<FastifyInstance>("knowledge-core", {
  name: "record_feedback",
  description: "Record whether knowledge was helpful, solved work, deflected a request, or needs improvement.",
  parameters: {
    type: "object",
    properties: {
      knowledgeId: { type: "string" },
      helpful: { type: "boolean" },
      outcome: { type: "string", enum: ["solved", "deflected", "partial", "not_helpful", "stale", "unsafe"] },
      comment: { type: "string" },
      context: { type: "object", properties: {} },
    },
    required: ["knowledgeId", "outcome"],
  },
}, async (args, fastify) => {
  const { knowledgeId, helpful, outcome, comment, context = {}, _userId } = args as any;
  const result = await fastify.pg.query(
    `INSERT INTO knowledge_feedback (knowledge_id, user_id, helpful, outcome, comment, context) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [knowledgeId, _userId || null, helpful ?? null, outcome, comment || null, JSON.stringify(context)]
  );
  const reuseInc = outcome === "solved" || outcome === "partial" ? 1 : 0;
  const deflectInc = outcome === "deflected" ? 1 : 0;
  await fastify.pg.query(
    `UPDATE knowledge_items SET reuse_count = reuse_count + $1, deflection_count = deflection_count + $2, updated_at = NOW() WHERE id = $3`,
    [reuseInc, deflectInc, knowledgeId]
  );
  await fastify.pg.query(
    `INSERT INTO knowledge_events (knowledge_id, type, message, actor_id, metadata) VALUES ($1, 'feedback', $2, $3, $4)`,
    [knowledgeId, `Feedback recorded: ${outcome}`, _userId || null, JSON.stringify({ helpful, outcome })]
  );
  emit("knowledge.feedback_recorded", { knowledgeId, outcome, helpful });
  return result.rows[0];
});

registerTool<FastifyInstance>("knowledge-core", {
  name: "stewardship_queue",
  description: "Return knowledge stewardship work: stale, low-health, draft, low-trust, and gap-driven knowledge.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer" },
    },
  },
}, async (args, fastify) => {
  const { limit = 25 } = args as any;
  const items = await fastify.pg.query(
    `SELECT * FROM knowledge_items
     WHERE status IN ('draft', 'review')
        OR health_score < 0.65
        OR trust_score < 0.60
        OR last_validated_at IS NULL
        OR last_validated_at < NOW() - INTERVAL '120 days'
     ORDER BY status = 'published' DESC, health_score ASC, updated_at ASC
     LIMIT $1`,
    [Math.min(Number(limit) || 25, 100)]
  );
  const gaps = await fastify.pg.query(
    `SELECT * FROM knowledge_gaps WHERE status = 'open' ORDER BY demand_count DESC, updated_at DESC LIMIT $1`,
    [Math.min(Number(limit) || 25, 100)]
  );
  return {
    items: items.rows.map((row: any) => ({ ...row, health_score: scoreKnowledgeHealth(row) })),
    gaps: gaps.rows,
  };
});
}
