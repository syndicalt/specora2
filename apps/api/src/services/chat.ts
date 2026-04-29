import OpenAI from "openai";
import { FastifyInstance } from "fastify";
import type { Trace } from "@pathlight/sdk";
import { executeTool as executeAppTool, getToolsForSession } from "@specora/sdk";
import { SessionTrace } from "./pathlightSession";
import { hasPermission } from "./rbac";

function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

export function getProvaraConfig(): { url: string; key: string; tenantId: string | null } | null {
  const url = process.env.PROVARA_URL;
  const key = process.env.PROVARA_API_KEY;
  if (!url || !key) return null;
  return { url, key, tenantId: process.env.PROVARA_TENANT_ID || null };
}

async function callProvara(
  messages: { role: string; content: string; tool_calls?: any; tool_call_id?: string }[],
  tools: OpenAI.Chat.ChatCompletionTool[]
): Promise<OpenAI.Chat.ChatCompletion> {
  const config = getProvaraConfig()!;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.key}`,
  };
  if (config.tenantId) {
    headers["X-Tenant-ID"] = config.tenantId;
  }
  const baseUrl = config.url.replace(/\/?v1\/?$/, "");
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "provara-router",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.3,
      requires_structured_output: true,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provara error ${response.status}: ${text}`);
  }
  return (await response.json()) as OpenAI.Chat.ChatCompletion;
}

function buildSystemPrompt(uiContext?: string): string {
  let prompt = `You are Specora Assistant, an AI-native IT Service Management expert. You have ZERO knowledge of the actual CMDB. Every fact about CIs, servers, databases, dependencies, or service maps must come from tool calls. Never guess or hallucinate.

HOW TO ANSWER QUESTIONS:
1. When the user asks about infrastructure, CIs, or dependencies, immediately call the relevant tool(s). Use search_cis, get_ci_details, get_service_map, count_cis, or other available tools.
2. After receiving tool results, summarize the data clearly. Name exact CIs, list relationships, and quote real values from the results.
3. If the user mentions a CI by name or ID, use that exact identifier in your tool calls. Do not ask "which one?" if they already told you.

UI NAVIGATION (action directives):
These are special tags that open apps in the user's browser. They do NOT fetch data — they only open visual views AFTER you have already fetched the data with tools.
- [[action|open-service-map|rootId=<id>|Open Service Map]] — opens the visual service map
- [[action|open-ci-details|id=<id>|View in CMDB Explorer]] — opens CMDB Explorer and focuses the CI
- [[action|open-cmdb-explorer|queue=attention|Open CMDB Explorer]] — opens CMDB Explorer to a queue. Supported queues: all, attention, orphaned, stale, critical
- [[action|open-cmdb-explorer|query=<search>|Open Search in CMDB Explorer]] — opens CMDB Explorer with a search query
- [[action|open-cmdb-explorer|class=<class>&environment=<env>|Open Filtered CMDB Explorer]] — opens CMDB Explorer with filters
- [[action|select-ci|context=default|Browse CMDB]] — opens CMDB Explorer in visual CI selection mode
- [[action|pick-date|context=planned-start|Pick Start Date]] — shows a date picker

Always include the relevant action directive at the end of your response after describing data fetched via tools. For example, after describing a CI's dependencies, add: [[action|open-service-map|rootId=srv-6|Open Service Map]]

When the user asks to browse, open, or visually inspect the CMDB without asking for data, respond with the CMDB Explorer action only: [[action|open-cmdb-explorer|queue=all|Open CMDB Explorer]]

When the user asks for risky, stale, orphaned, or critical CIs, fetch data first with tools, summarize the results, then offer a matching Explorer queue:
- risky or low health: [[action|open-cmdb-explorer|queue=attention|Open Risk Queue]]
- orphaned: [[action|open-cmdb-explorer|queue=orphaned|Open Orphan Queue]]
- stale: [[action|open-cmdb-explorer|queue=stale|Open Stale Queue]]
- critical: [[action|open-cmdb-explorer|queue=critical|Open Critical Queue]]

EXAMPLE WORKFLOW:
User: "Show me the service map for db-prod-01"
→ Call search_cis with name="db-prod-01" to find its ID
→ Call get_service_map with rootId=<found_id> to fetch the graph
→ Summarize the nodes and relationships from the results
→ Add [[action|open-service-map|rootId=<found_id>|Open Service Map]]

User: "What are the dependencies of Portal API?"
→ Call search_cis with name="Portal API" to find its ID
→ Call get_ci_details with id=<found_id> to get relationships
→ Summarize the dependencies
→ Add [[action|open-ci-details|id=<found_id>|View in CMDB Explorer]] and optionally [[action|open-service-map|rootId=<found_id>|Open Service Map]]

User: "Open CMDB Explorer"
→ Do not call tools
→ Add [[action|open-cmdb-explorer|queue=all|Open CMDB Explorer]]

User: "Find the dependency path between Server A and Service B"
→ Use search_cis to resolve both CIs if needed
→ Call find_dependency_path with the two IDs
→ Summarize the path
→ Add [[action|open-service-map|rootId=<source_id>|Open Service Map]]

CRITICAL: Do NOT say "I will open it" or "The map is now open." The map only opens when the user clicks the action button or explicitly asks. Always fetch data with tools first, then describe it, then offer the action directive.

Available CI classes: BusinessService, ApplicationService, TechnicalService, Server, Database, Application, NetworkGear, User, Group, Location.
Relationship types: PART_OF, DEPENDS_ON, HOSTED_ON, MANAGED_BY, OWNED_BY, LOCATED_AT.

NATURAL LANGUAGE SEARCH:
When the user asks a free-form question about the CMDB (e.g., "Which databases are not hosted on a server?" or "Show me all production CIs owned by Alice"), translate their question into a Cypher query and call the nl_search tool. The query MUST only use MATCH and RETURN — no CREATE, DELETE, SET, or MERGE.

When a user wants to create or edit a change request, use a step-by-step conversational approach:
1. Ask which CI they want to change, one question at a time.
2. Use search_cis to help them find the right CI if they don't know the ID.
3. Present search results as a numbered list. Ask the user to pick one, or offer to open the CMDB Explorer for visual selection using [[action|select-ci|context=change-create|Browse CMDB]].
4. Once a CI is selected, use change-manager_get_affected_cis to discover dependencies (up to 3 hops). Ask the user which affected CIs should be included.
5. Collect title and description one by one.
6. When asking for dates DURING CREATION, pass them as separate fields to change-manager_create_rfc: plannedStartDate (YYYY-MM-DD), plannedStartTime (HH:MM), plannedEndDate (YYYY-MM-DD), plannedEndTime (HH:MM).
7. ONCE YOU HAVE COLLECTED ciId AND title (the only required fields), plus any optional fields the user provided, YOU MUST IMMEDIATELY CALL change-manager_create_rfc. Do NOT summarize, confirm, or ask "Shall I proceed?" — just call the tool. The user has already given you everything you need.
8. When asking for dates on an EXISTING RFC (after creation), you MUST call change-manager_edit_rfc with the rfcId and the extracted date fields. Extract YYYY-MM-DD from the user's input for the date fields and HH:MM for the time fields. Do NOT just acknowledge — always call the tool to persist the change.
9. When asking for any date, also offer a datepicker action: [[action|pick-date|context=planned-start|Pick Start Date]] so the user can click a calendar.
10. After creating an RFC, offer to open the Change Manager to view it with [[action|open-change-manager|rfcId=<id>|View in Change Manager]].`

  prompt += `

When a user reports, investigates, or escalates an incident:
1. First decide whether this can be deflected with known context, correlated to an existing incident/change/CI health issue, or safely remediated.
2. For a new incident, collect the minimum viable facts: affected service or CI, user-visible impact, severity, and source signal. Use search_cis when a CI or service name is ambiguous.
3. Create the incident with incident-manager_create_incident as soon as title and impact are clear. Include ciId, service, severity, source, externalRef, and affectedCiIds when known.
4. Immediately run incident-manager_triage_incident and incident-manager_recommend_remediation for active incidents.
5. For major incidents, use incident-manager_record_incident_event for timeline updates and incident-manager_draft_stakeholder_update for communications.
6. Never claim remediation has executed unless incident-manager_execute_remediation returns success.
7. Offer to open the Incident Command Center with [[action|open-incident-manager|incidentId=<id>|View Incident]].`;

  prompt += `

When a user asks a support, troubleshooting, service, runbook, policy, or "how do I" question:
1. Prefer governed knowledge first by calling knowledge-core_answer with the user's question and any known CI, service, or audience context.
2. Answer with the returned citations and confidence. If confidence is low, say what is missing and offer to create a knowledge gap or draft.
3. When a workflow produces reusable learning, call knowledge-core_draft_from_record for incidents, changes, health findings, discovery findings, or external records.
4. For explicit publish/review requests, use knowledge-core_publish_knowledge only when the user has provided a clear instruction.
5. Offer to open Knowledge Core with [[action|open-knowledge-core|knowledgeId=<id>|View Knowledge]] when citing or creating knowledge.`;

  prompt += `

When a user asks about recurring incidents, root cause, known errors, prevention, reliability backlog, or whether Problem Management is needed:
1. Use prevention-center_detect_candidates to find recurring incident clusters when the user wants prevention opportunities.
2. Use prevention-center_propose_actions for a selected prevention record before recommending manual work.
3. Use prevention-center_create_known_error when a recurring issue needs a governed Known Error in Knowledge Core.
4. Treat Prevention Center as the replacement for legacy Problem Management: focus on measurable incident reduction and corrective actions.
5. Offer to open Prevention Center with [[action|open-prevention-center|preventionId=<id>|View Prevention]].`;

  prompt += `

When a user asks about hardware assets, software licenses, procurement, contracts, entitlements, scans, renewals, audit exposure, or ITAM:
1. Use asset-command_dashboard or asset-command_list_exceptions to understand the current asset posture.
2. Use asset-command_ingest_contract when the user provides contract or agreement terms and wants entitlements extracted.
3. Use asset-command_ingest_procurement for purchase orders, invoices, receipts, or procurement payloads.
4. Use asset-command_record_scan for mobile/barcode/RFID/NFC scan evidence and custody updates.
5. Use asset-command_reconcile_sam to compare usage against entitlements before making compliance or savings claims.
6. Offer to open Asset Command Center with [[action|open-asset-command|assetId=<id>|View Asset]].`;

  prompt += `

When a user asks for help, service, access, hardware, software, support, callback, or "I need..." in a customer/self-service context:
1. Treat Customer Portal as the front door and call customer-portal_resolve_intent first.
2. Prefer answer or deflection when knowledge candidates are strong; otherwise collect only missing fields.
3. Use customer-portal_submit_request when the user has provided enough intent to create a request. Do not force catalog browsing when the intent is clear.
4. Use customer-portal_request_support_handoff when urgency is high, confidence is low, the user asks to talk to support, or a support/call channel is appropriate.
5. For call routing, include the current summary, request or incident id, urgency, affected service, attempted self-service, and next recommended action in the handoff context.
6. Offer to open Customer Portal with [[action|open-customer-portal|requestId=<id>|View Request]] after creating or updating a request.`;

  if (uiContext) {
    prompt += `\n\nCURRENT UI CONTEXT:\n${uiContext}`;
  }
  return prompt;
}

const XML_BLOCK_PATTERNS = [
  /<function_calls>[\s\S]*?<\/function_calls>/gi,
  /<invoke\s+[^>]*>[\s\S]*?<\/invoke>/gi,
  /<result>[\s\S]*?<\/result>/gi,
];

function sanitizeAssistantContent(text: string): string {
  if (!text) return text;
  let cleaned = text;
  for (const pattern of XML_BLOCK_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

/**
 * Fallback parser for models that output action directives instead of native tool calls.
 * Converts [[action|<type>|<payload>|<label>]] into corresponding tool calls.
 */
function parseActionToolCalls(text: string): { id: string; type: "function"; function: { name: string; arguments: string } }[] | undefined {
  if (!text.includes("[[action|")) return undefined;
  const actionRegex = /\[\[action\|([^|]+)\|([^|]+)\|([^\[\]]+)\]\]/g;
  const toolCalls: { id: string; type: "function"; function: { name: string; arguments: string } }[] = [];
  let match;
  while ((match = actionRegex.exec(text)) !== null) {
    const actionType = match[1];
    const payload = match[2];
    const params = new URLSearchParams(payload);

    if (actionType === "search_cis") {
      const args: any = {};
      if (params.get("name")) args.name = params.get("name");
      if (params.get("query")) args.query = params.get("query");
      if (params.get("class")) args.class = params.get("class");
      toolCalls.push({ id: `act-${Date.now()}-${toolCalls.length}`, type: "function", function: { name: "search_cis", arguments: JSON.stringify(args) } });
    } else if (actionType === "open-service-map") {
      const rootId = params.get("rootId");
      if (rootId) {
        toolCalls.push({ id: `act-${Date.now()}-${toolCalls.length}`, type: "function", function: { name: "get_service_map", arguments: JSON.stringify({ rootId }) } });
      }
    } else if (actionType === "open-ci-details") {
      const id = params.get("id");
      if (id) {
        toolCalls.push({ id: `act-${Date.now()}-${toolCalls.length}`, type: "function", function: { name: "get_ci_details", arguments: JSON.stringify({ id }) } });
      }
    }
  }
  return toolCalls.length > 0 ? toolCalls : undefined;
}

const CORE_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_cis",
      description: "Search for Configuration Items (CIs) in the CMDB by name, class, or environment.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Substring to match against CI names" },
          class: { type: "string", description: "CI class to filter by (e.g., Server, Database, BusinessService)" },
          environment: { type: "string", description: "Environment to filter by (e.g., Production, Staging)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ci_details",
      description: "Get detailed information about a specific CI including its relationships.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The unique ID of the CI" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_service_map",
      description: "Get the dependency graph (service map) for a CI. Shows what it depends on and what depends on it.",
      parameters: {
        type: "object",
        properties: {
          rootId: { type: "string", description: "The ID of the root CI to map" },
        },
        required: ["rootId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_cis",
      description: "Count Configuration Items by class, environment, or other criteria.",
      parameters: {
        type: "object",
        properties: {
          class: { type: "string", description: "CI class to count" },
          environment: { type: "string", description: "Environment to count" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_dependency_path",
      description: "Find the shortest dependency path between two CIs in the CMDB.",
      parameters: {
        type: "object",
        properties: {
          fromId: { type: "string", description: "The ID of the starting CI" },
          toId: { type: "string", description: "The ID of the target CI" },
        },
        required: ["fromId", "toId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_orphaned_cis",
      description: "Find CIs that have no relationships (orphaned nodes).",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "nl_search",
      description: "Execute a natural-language CMDB search by running a Cypher query. Only MATCH and RETURN are allowed — no mutations.",
      parameters: {
        type: "object",
        properties: {
          cypher: {
            type: "string",
            description: "A read-only Cypher query using MATCH and RETURN only. No CREATE, DELETE, SET, or MERGE allowed.",
          },
        },
        required: ["cypher"],
      },
    },
  },
];

const APP_TOOL_RESOURCE_MAP: Record<string, string> = {
  "change-manager": "change-manager",
  "incident-manager": "incident-manager",
  "knowledge-core": "knowledge-core",
  "prevention-center": "prevention-center",
  "asset-command": "asset-command",
  "discovery-insights": "discovery",
  "health-monitor": "health-monitor",
  "customer-portal": "customer-portal",
  "engage-agent-workspace": "engage-agent-workspace",
};

function toolToAction(toolName: string): string {
  const writePrefixes = ["create", "update", "edit", "delete", "approve", "assign", "apply", "execute", "triage", "transition", "record", "request", "route", "resolve", "submit", "draft", "publish"];
  return writePrefixes.some((prefix) => toolName.startsWith(prefix)) ? "write" : "read";
}

async function canUseAppTool(fastify: FastifyInstance, user: { role?: string } | undefined, fullToolName: string): Promise<boolean> {
  if (!user?.role) return false;
  if (user.role === "admin" || user.role === "security_admin") return true;
  const separator = fullToolName.indexOf("_");
  if (separator < 0) return false;
  const appId = fullToolName.slice(0, separator);
  const toolName = fullToolName.slice(separator + 1);
  const resource = APP_TOOL_RESOURCE_MAP[appId] || appId;
  const action = toolToAction(toolName);
  return hasPermission(fastify.pg, { role: user.role, resource, action });
}

async function getAllTools(fastify: FastifyInstance, user?: { role?: string }): Promise<OpenAI.Chat.ChatCompletionTool[]> {
  const appTools = [];
  for (const tool of getToolsForSession("system")) {
    if (await canUseAppTool(fastify, user, tool.name)) {
      appTools.push(tool);
    }
  }
  const mappedAppTools = appTools.map((tool): OpenAI.Chat.ChatCompletionTool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as any,
    },
  }));
  return [...CORE_TOOLS, ...mappedAppTools];
}

async function executeCoreTool(
  name: string,
  args: any,
  fastify: FastifyInstance
): Promise<any> {
  const session = fastify.neo4j.session();
  try {
    switch (name) {
      case "search_cis": {
        let query = "MATCH (n:ConfigurationItem)";
        const params: any = {};
        const conditions: string[] = [];
        const searchName = args.name || args.query;
        if (searchName) {
          conditions.push("n.name CONTAINS $name");
          params.name = searchName;
        }
        if (args.class) {
          conditions.push("n.class = $class");
          params.class = args.class;
        }
        if (args.environment) {
          conditions.push("n.environment = $environment");
          params.environment = args.environment;
        }
        if (conditions.length) query += " WHERE " + conditions.join(" AND ");
        query += " RETURN n LIMIT 20";
        const result = await session.run(query, params);
        return result.records.map((r: any) => {
          const props = r.get("n").properties;
          return {
            id: props.id,
            name: props.name,
            class: props.class,
            environment: props.environment,
          };
        });
      }
      case "get_ci_details": {
        const result = await session.run(
          `MATCH (n:ConfigurationItem {id: $id}) RETURN n`,
          { id: args.id }
        );
        if (!result.records.length) return null;
        const props = result.records[0].get("n").properties;
        const relResult = await session.run(
          `MATCH (n:ConfigurationItem {id: $id})-[r]-(target:ConfigurationItem)
           RETURN r, target`,
          { id: args.id }
        );
        const relationships = relResult.records.map((r: any) => {
          const rel = r.get("r");
          const target = r.get("target").properties;
          return {
            type: rel.type,
            direction: rel.start === props.id ? "outgoing" : "incoming",
            target: { id: target.id, name: target.name, class: target.class },
          };
        });
        return {
          id: props.id,
          name: props.name,
          class: props.class,
          environment: props.environment,
          relationships,
        };
      }
      case "get_service_map": {
        // Fetch root node first to guarantee it's included and to validate existence
        const rootResult = await session.run(
          `MATCH (root:ConfigurationItem {id: $rootId}) RETURN root`,
          { rootId: args.rootId }
        );
        if (!rootResult.records.length) {
          return { rootId: args.rootId, nodes: [], edges: [], error: "CI not found" };
        }
        const rootProps = rootResult.records[0].get("root").properties;

        // Use a bounded path query to avoid combinatorial explosion on dense graphs
        const result = await session.run(
          `MATCH (root:ConfigurationItem {id: $rootId})
           CALL {
             WITH root
             MATCH path = (root)-[:PART_OF|DEPENDS_ON|HOSTED_ON|MANAGED_BY|OWNED_BY|LOCATED_AT*1..3]-(related:ConfigurationItem)
             WHERE related <> root
             RETURN path
             LIMIT 25
           }
           UNWIND relationships(path) as rel
           WITH DISTINCT root, rel, startNode(rel) as src, endNode(rel) as tgt
           RETURN root, rel, src, tgt
           LIMIT 50`,
          { rootId: args.rootId }
        );
        const nodesMap = new Map();
        const edges: any[] = [];
        nodesMap.set(rootProps.id, { id: rootProps.id, name: rootProps.name, class: rootProps.class });
        for (const record of result.records) {
          const rel = record.get("rel");
          const src = record.get("src").properties;
          const tgt = record.get("tgt").properties;
          nodesMap.set(src.id, { id: src.id, name: src.name, class: src.class });
          nodesMap.set(tgt.id, { id: tgt.id, name: tgt.name, class: tgt.class });
          edges.push({
            type: rel.type,
            sourceId: src.id,
            targetId: tgt.id,
          });
        }
        return {
          rootId: args.rootId,
          nodes: Array.from(nodesMap.values()),
          edges,
        };
      }
      case "count_cis": {
        let query = "MATCH (n:ConfigurationItem)";
        const params: any = {};
        const conditions: string[] = [];
        if (args.class) {
          conditions.push("n.class = $class");
          params.class = args.class;
        }
        if (args.environment) {
          conditions.push("n.environment = $environment");
          params.environment = args.environment;
        }
        if (conditions.length) query += " WHERE " + conditions.join(" AND ");
        query += " RETURN count(n) as total";
        const result = await session.run(query, params);
        return { total: result.records[0].get("total").toNumber() };
      }
      case "find_dependency_path": {
        const result = await session.run(
          `MATCH path = shortestPath((a:ConfigurationItem {id: $fromId})-[:PART_OF|DEPENDS_ON|HOSTED_ON|MANAGED_BY*1..10]-(b:ConfigurationItem {id: $toId}))
           UNWIND nodes(path) as node
           WITH collect(DISTINCT node) as pathNodes, path
           UNWIND relationships(path) as rel
           RETURN pathNodes, collect(DISTINCT rel) as pathRels`,
          { fromId: args.fromId, toId: args.toId }
        );
        if (!result.records.length) {
          return { nodes: [], edges: [], found: false };
        }
        const record = result.records[0];
        const pathNodes = record.get("pathNodes");
        const pathRels = record.get("pathRels");
        const nodes = pathNodes.map((n: any) => {
          const props = n.properties;
          return { id: props.id, name: props.name, class: props.class };
        });
        const edges = pathRels.map((rel: any) => ({
          type: rel.type,
          sourceId: rel.start.properties.id,
          targetId: rel.end.properties.id,
        }));
        return { nodes, edges, found: true };
      }
      case "find_orphaned_cis": {
        const result = await session.run(
          `MATCH (n:ConfigurationItem)
           WHERE NOT (n)-[:PART_OF|DEPENDS_ON|HOSTED_ON|MANAGED_BY|OWNED_BY|LOCATED_AT]-()
           RETURN n LIMIT 50`
        );
        return result.records.map((r: any) => {
          const props = r.get("n").properties;
          return { id: props.id, name: props.name, class: props.class, environment: props.environment };
        });
      }
      case "nl_search": {
        const cypher = (args.cypher || "").trim();
        // Safety guard: reject mutation keywords
        const upper = cypher.toUpperCase();
        const forbidden = ["CREATE", "DELETE", "SET", "MERGE", "DROP", "REMOVE", "CALL", "LOAD"];
        if (forbidden.some((kw) => upper.includes(kw))) {
          return { error: "Query contains forbidden keywords. Only MATCH and RETURN are allowed." };
        }
        // Additional guard: must start with MATCH
        if (!/^\s*MATCH/i.test(cypher)) {
          return { error: "Query must start with MATCH." };
        }
        try {
          const result = await session.run(cypher);
          const rows = result.records.map((record: any) => {
            const obj: Record<string, any> = {};
            for (const key of record.keys) {
              const val = record.get(key);
              if (val && typeof val === "object" && val.properties) {
                obj[key] = val.properties;
              } else if (Array.isArray(val)) {
                obj[key] = val.map((v: any) => (v && v.properties ? v.properties : v));
              } else {
                obj[key] = val;
              }
            }
            return obj;
          });
          return { rows: rows.slice(0, 50), count: rows.length };
        } catch (err: any) {
          return { error: `Cypher execution failed: ${err.message}` };
        }
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } finally {
    await session.close();
  }
}

async function executeTool(
  name: string,
  args: any,
  fastify: FastifyInstance
): Promise<any> {
  // Check if it's a core tool
  const isCoreTool = CORE_TOOLS.some((t) => t.function?.name === name);
  if (isCoreTool) {
    return executeCoreTool(name, args, fastify);
  }
  // Otherwise, delegate to app tool registry
  return executeAppTool(name, args, fastify);
}

/**
 * Fallback parser for models that output XML-style tool calls in their text content
 * instead of using the native tool-calling API. Extracts <invoke name="..."> blocks.
 */
function parseXmlToolCalls(text: string): { id: string; type: "function"; function: { name: string; arguments: string } }[] | undefined {
  if (!text.includes("<invoke")) return undefined;
  const toolCalls: { id: string; type: "function"; function: { name: string; arguments: string } }[] = [];
  const matchedRanges: Array<{ start: number; end: number }> = [];

  // Parse multi-parameter invocations first to avoid double-parsing by the single-parameter regex
  const multiInvokeRegex = /<invoke\s+name="([^"]+)">(.*?)<\/invoke>/gs;
  let match;
  while ((match = multiInvokeRegex.exec(text)) !== null) {
    matchedRanges.push({ start: match.index, end: match.index + match[0].length });
    const name = match[1];
    const inner = match[2];
    const args: Record<string, string> = {};
    const paramRegex = /<parameter\s+name="([^"]+)">([^<]*)<\/parameter>/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(inner)) !== null) {
      args[paramMatch[1]] = paramMatch[2];
    }
    if (Object.keys(args).length > 0) {
      toolCalls.push({
        id: `xml-${Date.now()}-${toolCalls.length}`,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      });
    }
  }

  // Parse single-parameter invocations, skipping ranges already matched above
  const invokeRegex = /<invoke\s+name="([^"]+)">\s*<parameter\s+name="([^"]+)">([^<]*)<\/parameter>\s*<\/invoke>/g;
  while ((match = invokeRegex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (matchedRanges.some((r) => start >= r.start && end <= r.end)) continue;
    toolCalls.push({
      id: `xml-${Date.now()}-${toolCalls.length}`,
      type: "function",
      function: {
        name: match[1],
        arguments: JSON.stringify({ [match[2]]: match[3] }),
      },
    });
  }

  return toolCalls.length > 0 ? toolCalls : undefined;
}

export interface ChatResult {
  content: string;
  toolCalls?: { call: OpenAI.Chat.ChatCompletionMessageToolCall; result: any }[];
}

const MAX_HISTORY_MESSAGES = 20;

export async function chat(
  messages: { role: "user" | "assistant" | "tool"; content: string; tool_calls?: any; tool_call_id?: string }[],
  fastify: FastifyInstance,
  trace?: Trace | SessionTrace,
  uiContext?: string,
  user?: { id: string; role?: string }
): Promise<ChatResult> {
  const openai = getOpenAI();
  const provara = getProvaraConfig();

  if (!provara && !openai) {
    return { content: "AI chat is not configured. Set OPENAI_API_KEY or PROVARA_URL + PROVARA_API_KEY." };
  }

  // Apply context window limit
  const recentMessages = messages.slice(-MAX_HISTORY_MESSAGES);

  const usedProvara = !!provara;

  const MAX_TOOL_ROUNDS = 3;
  let currentMessages: any[] = [
    { role: "system" as const, content: buildSystemPrompt(uiContext) },
    ...recentMessages.map((m) => ({
      role: m.role as any,
      content: m.content,
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    })),
  ];
  const allCallMetas: { call: OpenAI.Chat.ChatCompletionMessageToolCall; result: any }[] = [];
  let lastServiceMapRootId: string | null = null;
  let lastCiDetailsId: string | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let completion = await callLlm(currentMessages, fastify, usedProvara, openai, provara, trace, round, true, user);
    let message = completion.choices[0].message;

    // Fallback: check for XML and action-directive tool calls BEFORE sanitizing content.
    // Some models embed tool calls in XML or action directives within the content text.
    const rawContent = message.content || "";
    if (!message.tool_calls || message.tool_calls.length === 0) {
      if (rawContent) {
        const xmlToolCalls = parseXmlToolCalls(rawContent);
        if (xmlToolCalls) {
          fastify.log.warn({ round, tools: xmlToolCalls.map((t) => t.function.name) }, "Detected XML tool calls in model text — using fallback parser");
          message.tool_calls = xmlToolCalls;
        } else {
          const actionToolCalls = parseActionToolCalls(rawContent);
          if (actionToolCalls) {
            fastify.log.warn({ round, tools: actionToolCalls.map((t) => t.function.name) }, "Detected action-directive tool calls in model text — using fallback parser");
            message.tool_calls = actionToolCalls;
          }
        }
      }
    }

    // Sanitize content for display and history AFTER extracting fallbacks.
    message.content = sanitizeAssistantContent(rawContent);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      // Retry once without tools if the model returned empty content.
      if (!message.content) {
        fastify.log.warn({ round }, "chat empty content — retrying without tools");
        completion = await callLlm(currentMessages, fastify, usedProvara, openai, provara, trace, round, false, user);
        message = completion.choices[0].message;
        const retryRaw = message.content || "";
        const retryXml = parseXmlToolCalls(retryRaw);
        if (retryXml && (!message.tool_calls || message.tool_calls.length === 0)) {
          message.tool_calls = retryXml;
        } else {
          const retryAction = parseActionToolCalls(retryRaw);
          if (retryAction && (!message.tool_calls || message.tool_calls.length === 0)) {
            message.tool_calls = retryAction;
          }
        }
        message.content = sanitizeAssistantContent(retryRaw);
      }

      if (!message.tool_calls || message.tool_calls.length === 0) {
        return {
          content: message.content || "I'm not sure how to respond to that. Could you rephrase or provide more detail?",
          toolCalls: allCallMetas.length > 0 ? allCallMetas : undefined,
        };
      }
    }

    // Execute tools
    const toolResults: any[] = [];
    for (const toolCall of message.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);
      // Enrich with user context for permission-aware tools
      if (user?.id) args._userId = user.id;
      if (user?.role) args._userRole = user.role;
      fastify.log.info({ tool: toolCall.function.name, args, round }, "AI tool call");

      const toolSpan = trace?.span(`tool.execute.${toolCall.function.name}`, "tool", {
        toolName: toolCall.function.name,
        toolArgs: args,
      });

      let result: any;
      try {
        result = await executeTool(toolCall.function.name, args, fastify);
        await toolSpan?.end({ status: "completed", toolResult: result });
      } catch (err: any) {
        await toolSpan?.end({ status: "failed", error: err.message });
        result = { error: err.message };
      }

      // Track which CIs were queried so we can auto-append action directives
      if (toolCall.function.name === "get_service_map" && args.rootId) {
        lastServiceMapRootId = args.rootId;
      }
      if (toolCall.function.name === "get_ci_details" && args.id) {
        lastCiDetailsId = args.id;
      }

      toolResults.push({
        tool_call_id: toolCall.id,
        role: "tool",
        content: JSON.stringify(result),
      });
      allCallMetas.push({ call: toolCall, result });
    }

    // When tools were used, strip all content from the assistant message in history
    // to prevent XML/filler text from leaking into subsequent rounds.
    const historyContent = (message.tool_calls && message.tool_calls.length > 0) ? "" : message.content;

    // Add assistant message with tool_calls + tool results for next round
    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: historyContent, tool_calls: message.tool_calls },
      ...toolResults,
    ];
  }

  // If we hit the max rounds, force a final response without tools
  const finalMessages = [
    ...currentMessages,
    { role: "user", content: "Please provide a final answer based on the tool results above." },
  ];
  const finalCompletion = await callLlm(finalMessages, fastify, usedProvara, openai, provara, trace, MAX_TOOL_ROUNDS, false, user);
  let finalContent = sanitizeAssistantContent(finalCompletion.choices[0].message.content || "");

  // Auto-append action directives if the model fetched data but forgot to offer the visual
  if (lastServiceMapRootId && !finalContent.includes("[[action|open-service-map")) {
    finalContent += `\n\n[[action|open-service-map|rootId=${lastServiceMapRootId}|Open Service Map]]`;
  }
  if (lastCiDetailsId && !finalContent.includes("[[action|open-ci-details")) {
    finalContent += `\n\n[[action|open-ci-details|id=${lastCiDetailsId}|View CI Details]]`;
  }

  return {
    content: finalContent,
    toolCalls: allCallMetas,
  };
}

const LLM_REQUEST_TIMEOUT_MS = 120_000;

async function callLlm(
  messages: any[],
  _fastify: FastifyInstance,
  usedProvara: boolean,
  openai: OpenAI | null,
  _provara: any,
  trace?: Trace | SessionTrace,
  round?: number,
  includeTools = true,
  user?: { role?: string }
): Promise<OpenAI.Chat.ChatCompletion> {
  const tools = includeTools ? await getAllTools(_fastify, user) : [];
  const model = usedProvara ? "provara-router" : "gpt-4o-mini";
  const provider = usedProvara ? "provara" : "openai";
  const toolChoice = (includeTools && round === 0) ? "required" : (tools.length > 0 ? "auto" : undefined);

  const span = trace?.span(`llm.chat${round !== undefined ? `.r${round}` : ""}`, "llm", {
    model,
    provider,
    input: {
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content?.slice?.(0, 2000) ?? m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls.map((t: any) => ({ id: t.id, name: t.function?.name })) } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      })),
      temperature: 0.3,
      toolChoice,
      toolCount: tools.length,
    },
  });
  try {
    let completion: OpenAI.Chat.ChatCompletion;
    if (usedProvara) {
      _fastify.log.info("[LLM] Routing through Provara");
      completion = await Promise.race([
        callProvara(messages, tools),
        new Promise<OpenAI.Chat.ChatCompletion>((_, reject) =>
          setTimeout(() => reject(new Error(`Provara request timed out after ${LLM_REQUEST_TIMEOUT_MS}ms`)), LLM_REQUEST_TIMEOUT_MS)
        ),
      ]);
    } else {
      _fastify.log.info("[LLM] Routing through OpenAI directly");
      completion = await Promise.race([
        openai!.chat.completions.create({
          model,
          messages,
          ...(tools.length > 0 ? { tools, tool_choice: toolChoice } : {}),
          temperature: 0.3,
        }),
        new Promise<OpenAI.Chat.ChatCompletion>((_, reject) =>
          setTimeout(() => reject(new Error(`OpenAI request timed out after ${LLM_REQUEST_TIMEOUT_MS}ms`)), LLM_REQUEST_TIMEOUT_MS)
        ),
      ]);
    }
    const msg = completion.choices[0].message;
    await span?.end({
      status: "completed",
      output: {
        role: msg.role,
        content: msg.content?.slice?.(0, 2000) ?? msg.content,
        toolCalls: msg.tool_calls?.map((t: any) => ({ id: t.id, name: t.function?.name })) ?? [],
      },
      inputTokens: completion.usage?.prompt_tokens,
      outputTokens: completion.usage?.completion_tokens,
    });
    return completion;
  } catch (err: any) {
    await span?.end({ status: "failed", error: err.message });
    throw err;
  }
}

export type ChatStreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: any }
  | { type: "approval_required"; name: string; arguments: Record<string, unknown>; risk: "high"; reason: string }
  | { type: "done"; content: string; sessionId: string; toolCalls?: any[] }
  | { type: "error"; message: string };

const LLM_STREAM_TIMEOUT_MS = 120_000;

async function callLlmStream(
  messages: any[],
  _fastify: FastifyInstance,
  usedProvara: boolean,
  openai: OpenAI | null,
  _provara: any,
  onEvent: (event: ChatStreamEvent) => void,
  trace?: Trace | SessionTrace,
  round = 0,
  includeTools = true,
  user?: { role?: string }
): Promise<{ content: string; toolCalls?: any[] }> {
  const tools = includeTools ? await getAllTools(_fastify, user) : [];
  const model = usedProvara ? "provara-router" : "gpt-4o-mini";
  const provider = usedProvara ? "provara" : "openai";
  const toolChoice = (includeTools && tools.length > 0) ? (round === 0 ? "required" : "auto") : undefined;

  const span = trace?.span("llm.chat.stream", "llm", {
    model,
    provider,
    input: {
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content?.slice?.(0, 2000) ?? m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls.map((t: any) => ({ id: t.id, name: t.function?.name })) } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      })),
      temperature: 0.3,
      toolChoice,
      toolCount: tools.length,
    },
  });

  try {
    let accumulatedContent = "";
    let toolCalls: any[] | undefined;

    const timeoutRace = <T>(promise: Promise<T>, label: string): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out after ${LLM_STREAM_TIMEOUT_MS}ms`)), LLM_STREAM_TIMEOUT_MS)
        ),
      ]);
    };

    if (usedProvara) {
      // Provara streaming via fetch
      const config = getProvaraConfig()!;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key}`,
      };
      if (config.tenantId) headers["X-Tenant-ID"] = config.tenantId;
      const baseUrl = config.url.replace(/\/?v1\/?$/, "");

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "provara-router",
          messages,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: toolChoice,
          temperature: 0.3,
          requires_structured_output: true,
          stream: true,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Provara error ${response.status}: ${text}`);
      }

      // Parse SSE stream
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await timeoutRace(reader.read(), "Provara stream read");
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (trimmed.startsWith("data: ")) {
            try {
              const chunk = JSON.parse(trimmed.slice(6));
              const delta = chunk.choices?.[0]?.delta;
              _fastify.log.debug({ hasContent: !!delta?.content, hasToolCalls: !!delta?.tool_calls }, "Provara stream chunk");
              if (delta?.content) {
                accumulatedContent += delta.content;
                onEvent({ type: "token", content: delta.content });
              }
              if (delta?.tool_calls) {
                // Accumulate tool calls
                if (!toolCalls) toolCalls = [];
                for (const tc of delta.tool_calls) {
                  const existing = toolCalls[tc.index];
                  if (existing) {
                    if (tc.id) existing.id = tc.id;
                    if (tc.type) existing.type = tc.type;
                    if (tc.function?.name) existing.function.name = tc.function.name;
                    if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                  } else {
                    toolCalls[tc.index] = {
                      id: tc.id || "",
                      type: tc.type || "function",
                      function: {
                        name: tc.function?.name || "",
                        arguments: tc.function?.arguments || "",
                      },
                    };
                  }
                }
              }
            } catch {
              // ignore malformed chunks
            }
          }
        }
      }
    } else {
      // OpenAI streaming via SDK
      const stream = await openai!.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        ...(tools.length > 0 ? { tools, tool_choice: toolChoice } : {}),
        temperature: 0.3,
        stream: true,
      });

      const streamIterator = stream[Symbol.asyncIterator]();
      while (true) {
        const next = await timeoutRace(streamIterator.next(), "OpenAI stream read");
        if (next.done) break;
        const chunk = next.value;
        const delta = chunk.choices[0].delta;
        _fastify.log.debug({ hasContent: !!delta?.content, hasToolCalls: !!delta?.tool_calls }, "OpenAI stream chunk");
        if (delta?.content) {
          accumulatedContent += delta.content;
          onEvent({ type: "token", content: delta.content });
        }
        if (delta?.tool_calls) {
          if (!toolCalls) toolCalls = [];
          for (const tc of delta.tool_calls) {
            const existing = toolCalls[tc.index];
            if (existing) {
              if (tc.id) existing.id = tc.id;
              if (tc.type) existing.type = tc.type;
              if (tc.function?.name) existing.function.name = tc.function.name;
              if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
            } else {
              toolCalls[tc.index] = {
                id: tc.id || "",
                type: tc.type || "function",
                function: {
                  name: tc.function?.name || "",
                  arguments: tc.function?.arguments || "",
                },
              };
            }
          }
        }
      }
    }

    await span?.end({
      status: "completed",
      output: {
        content: accumulatedContent.slice(0, 2000),
        toolCalls: toolCalls?.map((t: any) => ({ id: t.id, name: t.function?.name })) ?? [],
      },
    });
    return { content: accumulatedContent, toolCalls };
  } catch (err: any) {
    await span?.end({ status: "failed", error: err.message });
    throw err;
  }
}

export async function chatStream(
  messages: { role: "user" | "assistant" | "tool"; content: string; tool_calls?: any; tool_call_id?: string }[],
  fastify: FastifyInstance,
  onEvent: (event: ChatStreamEvent) => void,
  trace?: Trace | SessionTrace,
  uiContext?: string,
  user?: { id: string; role?: string },
  approvedToolNames: string[] = []
): Promise<{ content: string; toolCalls?: any[] }> {
  const openai = getOpenAI();
  const provara = getProvaraConfig();

  if (!provara && !openai) {
    onEvent({ type: "error", message: "AI chat is not configured. Set OPENAI_API_KEY or PROVARA_URL + PROVARA_API_KEY." });
    return { content: "" };
  }

  const usedProvara = !!provara;

  // Apply context window limit
  const recentMessages = messages.slice(-MAX_HISTORY_MESSAGES);

  const MAX_TOOL_ROUNDS = 3;
  let currentMessages: any[] = [
    { role: "system" as const, content: buildSystemPrompt(uiContext) },
    ...recentMessages.map((m) => ({
      role: m.role as any,
      content: m.content,
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    })),
  ];
  const allCallMetas: { call: any; result: any }[] = [];
  let lastServiceMapRootId: string | null = null;
  let lastCiDetailsId: string | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Always pass tools (matching non-streaming behavior). The model uses them
    // only when it chooses to; omitting them in later rounds can confuse
    // Provara's router when tool_calls exist in the history.
    let { content, toolCalls } = await callLlmStream(currentMessages, fastify, usedProvara, openai, provara, onEvent, trace, round, true, user);

    // Fallback: check for XML and action-directive tool calls BEFORE sanitizing content.
    const rawContent = content || "";
    if (!toolCalls || toolCalls.length === 0) {
      if (rawContent) {
        const xmlToolCalls = parseXmlToolCalls(rawContent);
        if (xmlToolCalls) {
          fastify.log.warn({ round, tools: xmlToolCalls.map((t: any) => t.function.name) }, "Detected XML tool calls in stream text — using fallback parser");
          toolCalls = xmlToolCalls;
        } else {
          const actionToolCalls = parseActionToolCalls(rawContent);
          if (actionToolCalls) {
            fastify.log.warn({ round, tools: actionToolCalls.map((t: any) => t.function.name) }, "Detected action-directive tool calls in stream text — using fallback parser");
            toolCalls = actionToolCalls;
          }
        }
      }
    }

    // Sanitize content for display and history AFTER extracting fallbacks.
    content = sanitizeAssistantContent(rawContent);

    fastify.log.info({ round, hasToolCalls: !!toolCalls?.length, contentLength: content?.length }, "chatStream round complete");

    if (!toolCalls || toolCalls.length === 0) {
      // Retry once without tools if the model returned empty content.
      // Some providers (e.g., Provara) occasionally return empty content
      // in streaming mode when tools are present, even for simple prompts.
      if (!content) {
        fastify.log.warn({ round }, "chatStream empty content — retrying without tools");
        const retry = await callLlmStream(currentMessages, fastify, usedProvara, openai, provara, onEvent, trace, round, false, user);
        const retryRaw = retry.content || "";
        const retryXml = parseXmlToolCalls(retryRaw);
        if (retryXml && (!retry.toolCalls || retry.toolCalls.length === 0)) {
          toolCalls = retryXml;
        } else {
          const retryAction = parseActionToolCalls(retryRaw);
          if (retryAction && (!retry.toolCalls || retry.toolCalls.length === 0)) {
            toolCalls = retryAction;
          } else {
            toolCalls = retry.toolCalls;
          }
        }
        content = sanitizeAssistantContent(retryRaw);
      }

      if (!toolCalls || toolCalls.length === 0) {
        return { content: content || "I'm not sure how to respond to that. Could you rephrase or provide more detail?", toolCalls: allCallMetas.length > 0 ? allCallMetas : undefined };
      }
    }

    // Execute tools
    const toolResults: any[] = [];
    for (const toolCall of toolCalls) {
      let args: any;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }
      // Enrich with user context for permission-aware tools
      if (user?.id) args._userId = user.id;
      if (user?.role) args._userRole = user.role;

      const separator = toolCall.function.name.indexOf("_");
      const appToolName = separator >= 0 ? toolCall.function.name.slice(separator + 1) : toolCall.function.name;
      const requiresApproval = separator >= 0 && toolToAction(appToolName) === "write" && !approvedToolNames.includes(toolCall.function.name);
      if (requiresApproval) {
        onEvent({
          type: "approval_required",
          name: toolCall.function.name,
          arguments: args,
          risk: "high",
          reason: "This action can create, update, delete, approve, or otherwise mutate platform data.",
        });
        return {
          content: `Approval required before running ${toolCall.function.name}. Review the staged action and approve it to continue.`,
          toolCalls: allCallMetas.length > 0 ? allCallMetas : undefined,
        };
      }

      onEvent({ type: "tool_call", name: toolCall.function.name, arguments: args });
      fastify.log.info({ tool: toolCall.function.name, args, round }, "AI tool call (stream)");

      const toolSpan = trace?.span(`tool.execute.${toolCall.function.name}`, "tool", {
        toolName: toolCall.function.name,
        toolArgs: args,
      });

      let result: any;
      try {
        result = await executeTool(toolCall.function.name, args, fastify);
        await toolSpan?.end({ status: "completed", toolResult: result });
      } catch (err: any) {
        await toolSpan?.end({ status: "failed", error: err.message });
        result = { error: err.message };
      }

      // Track which CIs were queried so we can auto-append action directives
      if (toolCall.function.name === "get_service_map" && args.rootId) {
        lastServiceMapRootId = args.rootId;
      }
      if (toolCall.function.name === "get_ci_details" && args.id) {
        lastCiDetailsId = args.id;
      }

      onEvent({ type: "tool_result", name: toolCall.function.name, result });

      toolResults.push({
        tool_call_id: toolCall.id,
        role: "tool",
        content: JSON.stringify(result),
      });
      allCallMetas.push({ call: toolCall, result });
    }

    // When tools were used, strip all content from the assistant message in history
    // to prevent XML/filler text from leaking into subsequent rounds.
    const historyContent = (toolCalls && toolCalls.length > 0) ? "" : content;

    // Add assistant message with tool_calls + tool results for next round
    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: historyContent, tool_calls: toolCalls },
      ...toolResults,
    ];
  }

  // If we hit the max rounds, force a final response without tools
  const finalMessages = [
    ...currentMessages,
    { role: "user", content: "Please provide a final answer based on the tool results above." },
  ];
  const { content: finalContent } = await callLlmStream(finalMessages, fastify, usedProvara, openai, provara, onEvent, trace, MAX_TOOL_ROUNDS, false, user);
  let sanitizedFinal = sanitizeAssistantContent(finalContent || "");

  // Auto-append action directives if the model fetched data but forgot to offer the visual
  if (lastServiceMapRootId && !sanitizedFinal.includes("[[action|open-service-map")) {
    sanitizedFinal += `\n\n[[action|open-service-map|rootId=${lastServiceMapRootId}|Open Service Map]]`;
  }
  if (lastCiDetailsId && !sanitizedFinal.includes("[[action|open-ci-details")) {
    sanitizedFinal += `\n\n[[action|open-ci-details|id=${lastCiDetailsId}|View CI Details]]`;
  }

  return { content: sanitizedFinal, toolCalls: allCallMetas };
}
