import OpenAI from "openai";
import { FastifyInstance } from "fastify";
import type { Trace } from "@pathlight/sdk";
import { executeTool as executeAppTool, getToolsForSession } from "@specora/sdk";
import { SessionTrace } from "./pathlightSession";
// Import to trigger tool registration
import "./appTools";

function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

function getProvaraConfig(): { url: string; key: string; tenantId: string | null } | null {
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
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provara error ${response.status}: ${text}`);
  }
  return (await response.json()) as OpenAI.Chat.ChatCompletion;
}

function buildSystemPrompt(uiContext?: string): string {
  let prompt = `You are Specora Assistant, an AI expert in IT Service Management and the CSDMv5 data model.
You help users explore their CMDB (Configuration Management Database), understand service dependencies, and navigate IT infrastructure.

CRITICAL RULES:
1. You do NOT have any knowledge of the actual CMDB contents. You MUST use the provided tools to answer every question about infrastructure, CIs, servers, databases, services, dependencies, or the service map. Never guess or make up CI names, IDs, or counts.
2. NEVER output raw XML, JSON, markdown code blocks, or text descriptions for tool calls. Do NOT write things like "<function_calls>" or "I'll call search_cis". Use the native tool-calling mechanism silently. The user should never see raw tool syntax in your response.
3. When you need to call a tool, your response content should be empty (or a brief natural-language acknowledgment) and the tool call should be made through the tool-calling API.
4. When you receive tool results, give a thorough, specific answer using the actual data. Name exact CIs, list specific relationships, and quote real values.

Proactively offer action directives whenever they would help the user explore visually:
- After describing a CI and its dependencies, offer: [[action|open-service-map|rootId=<id>|Open Service Map]]
- After describing a specific CI's details, offer: [[action|open-ci-details|id=<id>|View CI Details]]

Use multiple tools in sequence if needed to build a complete picture. For example, if asked about a service, first search for it, then get its details, then get its service map.

Available CI classes: BusinessService, ApplicationService, TechnicalService, Server, Database, Application, NetworkGear, User, Group, Location.
Relationship types: PART_OF, DEPENDS_ON, HOSTED_ON, MANAGED_BY, OWNED_BY, LOCATED_AT.

You can also use structural validation tools to check for missing relationships (e.g., Database without HOSTED_ON, BusinessService without children).

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

  if (uiContext) {
    prompt += `\n\nCURRENT UI CONTEXT:\n${uiContext}`;
  }
  return prompt;
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
];

function getAllTools(): OpenAI.Chat.ChatCompletionTool[] {
  const appTools = getToolsForSession("system").map((tool): OpenAI.Chat.ChatCompletionTool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as any,
    },
  }));
  return [...CORE_TOOLS, ...appTools];
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
        if (args.name) {
          conditions.push("n.name CONTAINS $name");
          params.name = args.name;
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
        const result = await session.run(
          `MATCH path = (root:ConfigurationItem {id: $rootId})-[:PART_OF|DEPENDS_ON|HOSTED_ON|MANAGED_BY|OWNED_BY|LOCATED_AT*1..3]-(related:ConfigurationItem)
           UNWIND relationships(path) as rel
           RETURN root, related, rel, startNode(rel) as src, endNode(rel) as tgt
           LIMIT 50`,
          { rootId: args.rootId }
        );
        const nodesMap = new Map();
        const edges: any[] = [];
        for (const record of result.records) {
          const root = record.get("root").properties;
          const related = record.get("related").properties;
          const rel = record.get("rel");
          const src = record.get("src").properties;
          const tgt = record.get("tgt").properties;
          nodesMap.set(root.id, { id: root.id, name: root.name, class: root.class });
          nodesMap.set(related.id, { id: related.id, name: related.name, class: related.class });
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

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let completion = await callLlm(currentMessages, fastify, usedProvara, openai, provara, trace, round);
    let message = completion.choices[0].message;

    // Fallback: some models output XML tool calls in text instead of using native tool-calling API
    if ((!message.tool_calls || message.tool_calls.length === 0) && message.content) {
      const xmlToolCalls = parseXmlToolCalls(message.content);
      if (xmlToolCalls) {
        fastify.log.warn({ round, tools: xmlToolCalls.map((t) => t.function.name) }, "Detected XML tool calls in model text — using fallback parser");
        message.tool_calls = xmlToolCalls;
      }
    }

    if (!message.tool_calls || message.tool_calls.length === 0) {
      // Retry once without tools if the model returned empty content.
      if (!message.content) {
        fastify.log.warn({ round }, "chat empty content — retrying without tools");
        completion = await callLlm(currentMessages, fastify, usedProvara, openai, provara, trace, round, false);
        message = completion.choices[0].message;
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

      toolResults.push({
        tool_call_id: toolCall.id,
        role: "tool",
        content: JSON.stringify(result),
      });
      allCallMetas.push({ call: toolCall, result });
    }

    // Add assistant message with tool_calls + tool results for next round
    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: message.content || "", tool_calls: message.tool_calls },
      ...toolResults,
    ];
  }

  // If we hit the max rounds, force a final response without tools
  const finalMessages = [
    ...currentMessages,
    { role: "user", content: "Please provide a final answer based on the tool results above." },
  ];
  const finalCompletion = await callLlm(finalMessages, fastify, usedProvara, openai, provara, trace, MAX_TOOL_ROUNDS, false);
  return {
    content: finalCompletion.choices[0].message.content || "I processed the data but don't have a clear answer. Could you rephrase or provide more detail?",
    toolCalls: allCallMetas,
  };
}

async function callLlm(
  messages: any[],
  _fastify: FastifyInstance,
  usedProvara: boolean,
  openai: OpenAI | null,
  _provara: any,
  trace?: Trace | SessionTrace,
  round?: number,
  includeTools = true
): Promise<OpenAI.Chat.ChatCompletion> {
  const span = trace?.span(`llm.chat${round !== undefined ? `.r${round}` : ""}`, "llm", {
    input: { messageCount: messages.length },
  });
  try {
    const tools = includeTools ? getAllTools() : [];
    let completion: OpenAI.Chat.ChatCompletion;
    if (usedProvara) {
      _fastify.log.info("[LLM] Routing through Provara");
      completion = await callProvara(messages, tools);
    } else {
      _fastify.log.info("[LLM] Routing through OpenAI directly");
      completion = await openai!.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
        temperature: 0.3,
      });
    }
    await span?.end({ status: "completed", output: { toolCalls: completion.choices[0].message.tool_calls?.length ?? 0 } });
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
  | { type: "done"; content: string; sessionId: string; toolCalls?: any[] }
  | { type: "error"; message: string };

async function callLlmStream(
  messages: any[],
  _fastify: FastifyInstance,
  usedProvara: boolean,
  openai: OpenAI | null,
  _provara: any,
  onEvent: (event: ChatStreamEvent) => void,
  trace?: Trace | SessionTrace,
  includeTools = true
): Promise<{ content: string; toolCalls?: any[] }> {
  const span = trace?.span("llm.chat.stream", "llm", {
    input: { messageCount: messages.length },
  });

  try {
    const tools = includeTools ? getAllTools() : [];
    let accumulatedContent = "";
    let toolCalls: any[] | undefined;

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
          tool_choice: tools.length > 0 ? "auto" : undefined,
          temperature: 0.3,
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
        const { done, value } = await reader.read();
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
        ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
        temperature: 0.3,
        stream: true,
      });

      for await (const chunk of stream) {
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

    await span?.end({ status: "completed", output: { contentLength: accumulatedContent.length, toolCalls: toolCalls?.length ?? 0 } });
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
  user?: { id: string; role?: string }
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

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Always pass tools (matching non-streaming behavior). The model uses them
    // only when it chooses to; omitting them in later rounds can confuse
    // Provara's router when tool_calls exist in the history.
    let { content, toolCalls } = await callLlmStream(currentMessages, fastify, usedProvara, openai, provara, onEvent, trace, true);

    fastify.log.info({ round, hasToolCalls: !!toolCalls?.length, contentLength: content?.length }, "chatStream round complete");

    // Fallback: some models output XML tool calls in text instead of using native tool-calling API
    if ((!toolCalls || toolCalls.length === 0) && content) {
      const xmlToolCalls = parseXmlToolCalls(content);
      if (xmlToolCalls) {
        fastify.log.warn({ round, tools: xmlToolCalls.map((t: any) => t.function.name) }, "Detected XML tool calls in stream text — using fallback parser");
        toolCalls = xmlToolCalls;
      }
    }

    if (!toolCalls || toolCalls.length === 0) {
      // Retry once without tools if the model returned empty content.
      // Some providers (e.g., Provara) occasionally return empty content
      // in streaming mode when tools are present, even for simple prompts.
      if (!content) {
        fastify.log.warn({ round }, "chatStream empty content — retrying without tools");
        const retry = await callLlmStream(currentMessages, fastify, usedProvara, openai, provara, onEvent, trace, false);
        content = retry.content;
        toolCalls = retry.toolCalls;
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

      onEvent({ type: "tool_result", name: toolCall.function.name, result });

      toolResults.push({
        tool_call_id: toolCall.id,
        role: "tool",
        content: JSON.stringify(result),
      });
      allCallMetas.push({ call: toolCall, result });
    }

    // Add assistant message with tool_calls + tool results for next round
    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: content || "", tool_calls: toolCalls },
      ...toolResults,
    ];
  }

  // If we hit the max rounds, force a final response without tools
  const finalMessages = [
    ...currentMessages,
    { role: "user", content: "Please provide a final answer based on the tool results above." },
  ];
  const { content } = await callLlmStream(finalMessages, fastify, usedProvara, openai, provara, onEvent, trace, false);
  return { content: content || "I processed the data but don't have a clear answer. Could you rephrase or provide more detail?", toolCalls: allCallMetas };
}
