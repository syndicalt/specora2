import OpenAI from "openai";
import { FastifyInstance } from "fastify";
import type { Trace } from "@pathlight/sdk";

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

IMPORTANT: You do NOT have any knowledge of the actual CMDB contents. You MUST use the provided tools to answer every question about infrastructure, CIs, servers, databases, services, dependencies, or the service map. Never guess or make up CI names, IDs, or counts. Always call a tool first.

When you receive a tool result, answer concisely with the actual data. If helpful, include an action directive at the end like: [[action|open-service-map|rootId=bs-1|Open Service Map]]

Available CI classes: BusinessService, ApplicationService, TechnicalService, Server, Database, Application, NetworkGear, User, Group, Location.
Relationship types: PART_OF, DEPENDS_ON, HOSTED_ON, MANAGED_BY, OWNED_BY, LOCATED_AT.`;

  if (uiContext) {
    prompt += `\n\nCURRENT UI CONTEXT:\n${uiContext}`;
  }
  return prompt;
}

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
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

async function executeTool(
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

export interface ChatResult {
  content: string;
  toolCalls?: { call: OpenAI.Chat.ChatCompletionMessageToolCall; result: any }[];
}

const MAX_HISTORY_MESSAGES = 20;

export async function chat(
  messages: { role: "user" | "assistant" | "tool"; content: string; tool_calls?: any; tool_call_id?: string }[],
  fastify: FastifyInstance,
  trace?: Trace,
  uiContext?: string
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
    const completion = await callLlm(currentMessages, fastify, usedProvara, openai, provara, trace, round);
    const message = completion.choices[0].message;

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return {
        content: message.content || "I don't have a response for that.",
        toolCalls: allCallMetas.length > 0 ? allCallMetas : undefined,
      };
    }

    // Execute tools
    const toolResults: any[] = [];
    for (const toolCall of message.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);
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
      { role: "assistant", content: message.content || null, tool_calls: message.tool_calls },
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
    content: finalCompletion.choices[0].message.content || "I processed the data but have no response.",
    toolCalls: allCallMetas,
  };
}

async function callLlm(
  messages: any[],
  fastify: FastifyInstance,
  usedProvara: boolean,
  openai: OpenAI | null,
  provara: any,
  trace?: Trace,
  round?: number,
  includeTools = true
): Promise<OpenAI.Chat.ChatCompletion> {
  const span = trace?.span(`llm.chat${round !== undefined ? `.r${round}` : ""}`, "llm", {
    input: { messageCount: messages.length },
  });
  try {
    let completion: OpenAI.Chat.ChatCompletion;
    if (usedProvara) {
      completion = await callProvara(messages, includeTools ? TOOLS : []);
    } else {
      completion = await openai!.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        ...(includeTools ? { tools: TOOLS, tool_choice: "auto" } : {}),
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
