import { FastifyInstance } from "fastify";
import { chat, ChatResult, chatStream, ChatStreamEvent, getProvaraConfig } from "../services/chat";
import {
  createSession,
  listSessions,
  deleteSession,
  getMessages,
  appendMessage,
  getSessionTraceId,
  setSessionTraceId,
} from "../services/chatSession";
import { SessionTrace } from "../services/pathlightSession";
import { getVisibleApps } from "../services/appRegistry";
import { resolveUserRole } from "../services/rbac";

type AuthenticatedUser = { id: string; email?: string; role?: string };

type ChatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatRouteMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
};

type ChatRequestBody = {
  messages: ChatRouteMessage[];
  sessionId?: string;
  uiContext?: string;
  approvedToolNames?: string[];
};

function authUser(user: unknown): AuthenticatedUser {
  return user as AuthenticatedUser;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Chat failed";
}

function errorStack(err: unknown) {
  return err instanceof Error ? err.stack : undefined;
}

function parseToolCalls(value: unknown): ChatToolCall[] | undefined {
  if (Array.isArray(value)) return value as ChatToolCall[];
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as ChatToolCall[] : undefined;
  } catch {
    return undefined;
  }
}

const BUILTIN_CHAT_CAPABILITIES = [
  {
    appId: "customer-portal",
    appName: "Customer Portal",
    capabilities: [
      { id: "customer-portal.ask", label: "Ask for help", description: "Resolve intent, answer, request, route, or escalate", prompt: "I need help with something", icon: "MessageSquare" },
      { id: "customer-portal.catalog", label: "Browse catalog", description: "Find requestable services and submit governed catalog requests", prompt: "Show me the service catalog", icon: "ShoppingCart" },
      { id: "customer-portal.support", label: "Contact support", description: "Create a contextual support handoff or callback", prompt: "I need to talk to support", icon: "PhoneCall" },
    ],
  },
  {
    appId: "change-manager",
    appName: "Change Manager",
    capabilities: [
      { id: "change-manager.create", label: "Create change request", description: "Start a new RFC with step-by-step guidance", prompt: "I want to create a new change request", icon: "GitPullRequest" },
      { id: "change-manager.list", label: "List pending changes", description: "Show all change requests awaiting action", prompt: "Show me all pending change requests", icon: "List" },
    ],
  },
  {
    appId: "incident-manager",
    appName: "Incident Command Center",
    capabilities: [
      { id: "incident-manager.triage", label: "Triage incident", description: "Create, correlate, and triage an incident with AI context", prompt: "Triage a new incident", icon: "Siren" },
      { id: "incident-manager.command", label: "Open command center", description: "Open active incidents and major incident command", prompt: "Open Incident Command Center", icon: "Activity" },
      { id: "incident-manager.remediate", label: "Recommend remediation", description: "Suggest safe remediation actions for an active incident", prompt: "Recommend remediation for an incident", icon: "Bot" },
    ],
  },
  {
    appId: "knowledge-core",
    appName: "Knowledge Core",
    capabilities: [
      { id: "knowledge-core.answer", label: "Answer from knowledge", description: "Answer with governed knowledge, citations, and confidence", prompt: "Answer this using Knowledge Core", icon: "Brain" },
      { id: "knowledge-core.stewardship", label: "Stewardship queue", description: "Review stale, risky, missing, and draft knowledge", prompt: "Show the Knowledge Core stewardship queue", icon: "Library" },
      { id: "knowledge-core.draft", label: "Draft knowledge", description: "Create reusable knowledge from an incident, change, or operational note", prompt: "Draft a knowledge article from recent work", icon: "Sparkles" },
    ],
  },
  {
    appId: "prevention-center",
    appName: "Prevention Center",
    capabilities: [
      { id: "prevention-center.detect", label: "Detect prevention work", description: "Find recurring incident and reliability patterns worth fixing", prompt: "Detect prevention candidates", icon: "ShieldCheck" },
      { id: "prevention-center.actions", label: "Propose corrective actions", description: "Create known-error, health, change, and automation prevention work", prompt: "Propose corrective actions for prevention candidates", icon: "Target" },
    ],
  },
  {
    appId: "asset-command",
    appName: "Asset Command Center",
    capabilities: [
      { id: "asset-command.reconcile", label: "Reconcile SAM", description: "Compare software usage against entitlements and surface license risk", prompt: "Run SAM reconciliation", icon: "Scale" },
      { id: "asset-command.contract", label: "Extract entitlements", description: "Create contract and entitlement records from agreement data", prompt: "Extract software entitlements from this contract", icon: "FileText" },
      { id: "asset-command.scans", label: "Review asset scans", description: "Inspect mobile-ready barcode/RFID scan and custody evidence", prompt: "Review asset scan exceptions", icon: "ScanLine" },
    ],
  },
  {
    appId: "service-map",
    appName: "Service Map",
    capabilities: [
      { id: "service-map.show", label: "Show service map", description: "Visualize dependencies for a service", prompt: "Show me the service map", icon: "Network" },
    ],
  },
  {
    appId: "cmdb-explorer",
    appName: "CMDB Explorer",
    capabilities: [
      { id: "cmdb.investigate-ci", label: "Investigate CI", description: "Find a CI, summarize its details, and open it in CMDB Explorer", prompt: "Find and investigate a configuration item", icon: "Database" },
      { id: "cmdb.browse", label: "Browse CMDB", description: "Open the CMDB Explorer workspace", prompt: "Open CMDB Explorer", icon: "Search" },
      { id: "cmdb.find-risk", label: "Find risky CIs", description: "Find low-health, stale, or incomplete CIs", prompt: "Find risky CIs in the CMDB", icon: "AlertTriangle" },
      { id: "cmdb.find-orphans", label: "Find orphaned CIs", description: "Find CIs with missing relationship context", prompt: "Find orphaned CIs in the CMDB", icon: "Unlink" },
      { id: "cmdb.find-path", label: "Find dependency path", description: "Find the graph path between two CIs", prompt: "Find the dependency path between two CIs", icon: "Route" },
    ],
  },
  {
    appId: "discovery",
    appName: "Discovery",
    capabilities: [
      { id: "discovery.status", label: "Discovery status", description: "Check the latest discovery job results", prompt: "What is the status of the latest discovery job?", icon: "Upload" },
    ],
  },
  {
    appId: "discovery-insights",
    appName: "Discovery Insights",
    capabilities: [
      { id: "discovery-insights.coverage", label: "Discovery coverage", description: "Analyze how complete the CMDB discovery is", prompt: "Analyze discovery coverage", icon: "Radar" },
    ],
  },
  {
    appId: "health-monitor",
    appName: "Health Monitor",
    capabilities: [
      { id: "health-monitor.orphaned", label: "Find orphaned CIs", description: "Show CIs with no relationships", prompt: "Find orphaned CIs", icon: "HeartPulse" },
      { id: "health-monitor.stale", label: "Find stale CIs", description: "Show CIs not updated recently", prompt: "Find stale CIs", icon: "HeartPulse" },
      { id: "health-monitor.remediate", label: "Get remediation suggestions", description: "Show fixable health violations with one-click fixes", prompt: "Show me remediation suggestions", icon: "Wrench" },
    ],
  },
  {
    appId: "audit-log",
    appName: "Audit Log",
    capabilities: [
      { id: "audit-log.view", label: "View audit log", description: "Show recent CMDB changes", prompt: "Show me the audit log", icon: "ScrollText" },
    ],
  },
];

export async function chatRoutes(fastify: FastifyInstance) {
  // Chat capabilities catalog
  fastify.get("/api/chat/capabilities", { onRequest: [fastify.authenticate] }, async (request, _reply) => {
    const user = authUser(request.user);
    const visibleAppIds = new Set((await getVisibleApps(fastify, user)).map((app) => app.id));
    return { capabilities: BUILTIN_CHAT_CAPABILITIES.filter((group) => visibleAppIds.has(group.appId)) };
  });

  // List sessions
  fastify.get("/api/chat/sessions", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = authUser(request.user);
    try {
      const sessions = await listSessions(fastify.pg, user.id);
      return { sessions };
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err) || "Failed to list sessions" });
    }
  });

  // Create session
  fastify.post("/api/chat/sessions", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = authUser(request.user);
    const body = request.body as { title?: string };
    try {
      const session = await createSession(fastify.pg, user.id, body.title);
      return { session };
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err) || "Failed to create session" });
    }
  });

  // Delete session
  fastify.delete("/api/chat/sessions/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = authUser(request.user);
    const { id } = request.params as { id: string };
    try {
      const deleted = await deleteSession(fastify.pg, user.id, id);
      if (!deleted) {
        return reply.status(404).send({ error: "Session not found" });
      }
      return { success: true };
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err) || "Failed to delete session" });
    }
  });

  // Get messages for a session
  fastify.get("/api/chat/sessions/:id/messages", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = authUser(request.user);
    const { id } = request.params as { id: string };
    try {
      const messages = await getMessages(fastify.pg, id, user.id);
      return { messages };
    } catch (err: unknown) {
      if (errorMessage(err) === "Session not found or access denied") {
        return reply.status(404).send({ error: "Session not found" });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err) || "Failed to get messages" });
    }
  });

  // Chat endpoint
  fastify.post("/api/chat", {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const authenticatedUser = authUser(request.user);
    const role = await resolveUserRole(fastify.pg, authenticatedUser);
    const user = { ...authenticatedUser, role: role ?? undefined };
    const body = request.body as ChatRequestBody;

    if (!body.messages || !Array.isArray(body.messages)) {
      return reply.status(400).send({ error: "messages array required" });
    }

    const pathlight = fastify.pathlight;

    let sessionId = body.sessionId;
    let trace: SessionTrace | undefined;
    try {
      // Reuse existing session trace or create a new one
      let traceId: string | null = null;
      if (sessionId) {
        traceId = await getSessionTraceId(fastify.pg, sessionId);
      }
      const provara = getProvaraConfig();
      const model = provara ? "provara-router" : "gpt-4o-mini";
      const provider = provara ? "provara" : "openai";
      const traceInput = {
        userId: user.id,
        sessionId,
        model,
        provider,
        messageCount: body.messages.length,
        lastMessage: body.messages[body.messages.length - 1]?.content?.slice(0, 500),
      };
      if (traceId && pathlight) {
        trace = new SessionTrace(pathlight, traceId, "chat-request");
      } else if (pathlight) {
        trace = await SessionTrace.create(pathlight, "chat-request", traceInput);
        if (sessionId) {
          await setSessionTraceId(fastify.pg, sessionId, trace.id);
        }
      }

      let history: ChatRouteMessage[] = [];

      if (sessionId) {
        // Load existing history
        const dbMessages = await getMessages(fastify.pg, sessionId);
        history = dbMessages.map((m) => {
          const toolCalls = parseToolCalls(m.tool_calls);
          return {
            role: m.role as "user" | "assistant" | "tool",
            content: m.content,
            ...(toolCalls ? { tool_calls: toolCalls } : {}),
            ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          };
        });
      } else {
        // Create a new session with title from first user message
        const firstUserMsg = body.messages.find((m) => m.role === "user")?.content || "New Chat";
        const title = firstUserMsg.slice(0, 50) + (firstUserMsg.length > 50 ? "..." : "");
        const session = await createSession(fastify.pg, user.id, title);
        sessionId = session.id;
      }

      // Store trace ID for new sessions
      if (!traceId && trace && sessionId) {
        await setSessionTraceId(fastify.pg, sessionId, trace.id);
      }

      // Append the latest user message to DB
      const latestUserMsg = body.messages[body.messages.length - 1];
      if (latestUserMsg && latestUserMsg.role === "user") {
        await appendMessage(fastify.pg, sessionId, "user", latestUserMsg.content);
        history.push({ role: "user", content: latestUserMsg.content });
      }

      // Call AI
      const result: ChatResult = await chat(history, fastify, trace, body.uiContext, user);

      // Save assistant message with tool calls if any
      if (result.toolCalls && result.toolCalls.length > 0) {
        const toolCallsToSave = result.toolCalls.map((t) => ({
          id: t.call.id,
          type: t.call.type,
          function: {
            name: t.call.function.name,
            arguments: typeof t.call.function.arguments === "string" ? t.call.function.arguments : JSON.stringify(t.call.function.arguments),
          },
        }));
        fastify.log.debug({ toolCallsToSave }, "Saving assistant message with tool_calls");
        await appendMessage(
          fastify.pg,
          sessionId,
          "assistant",
          result.content ?? "",
          toolCallsToSave
        );
        // Save each tool result as a separate tool message
        for (const tc of result.toolCalls) {
          const toolResultStr = tc.result !== undefined ? JSON.stringify(tc.result) : "null";
          await appendMessage(fastify.pg, sessionId, "tool", toolResultStr, undefined, tc.call.id);
        }
      } else {
        await appendMessage(fastify.pg, sessionId, "assistant", result.content ?? "");
      }

      await trace?.end({ output: { contentLength: result.content?.length ?? 0 }, status: "completed" });

      return { role: "assistant", content: result.content ?? "", sessionId };
    } catch (err: unknown) {
      fastify.log.error({ err: errorMessage(err), stack: errorStack(err), sessionId }, "Chat endpoint failed");
      await trace?.end({ status: "failed", error: errorMessage(err) });
      return reply.status(500).send({ error: errorMessage(err) });
    }
  });

  // Chat streaming endpoint (SSE)
  fastify.post("/api/chat/stream", {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const authenticatedUser = authUser(request.user);
    const role = await resolveUserRole(fastify.pg, authenticatedUser);
    const user = { ...authenticatedUser, role: role ?? undefined };
    const body = request.body as ChatRequestBody;

    if (!body.messages || !Array.isArray(body.messages)) {
      return reply.status(400).send({ error: "messages array required" });
    }

    // Set SSE headers — must include CORS manually because reply.raw.writeHead()
    // bypasses Fastify's onSend hooks where @fastify/cors normally injects headers.
    const origin = request.headers.origin;
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...(origin ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
      } : {}),
    });

    let sessionId = body.sessionId;
    let trace: SessionTrace | undefined;
    let chatStreamCompleted = false;
    let assistantSaved = false;
    try {
      let history: ChatRouteMessage[] = [];

      // Reuse existing session trace or create a new one
      let traceId: string | null = null;
      if (sessionId) {
        traceId = await getSessionTraceId(fastify.pg, sessionId);
      }
      const provaraStream = getProvaraConfig();
      const modelStream = provaraStream ? "provara-router" : "gpt-4o-mini";
      const providerStream = provaraStream ? "provara" : "openai";
      const traceInputStream = {
        userId: user.id,
        sessionId,
        model: modelStream,
        provider: providerStream,
        messageCount: body.messages.length,
        lastMessage: body.messages[body.messages.length - 1]?.content?.slice(0, 500),
      };
      const pathlight = fastify.pathlight;
      if (traceId && pathlight) {
        trace = new SessionTrace(pathlight, traceId, "chat-stream");
      } else if (pathlight) {
        trace = await SessionTrace.create(pathlight, "chat-stream", traceInputStream);
      }

      if (sessionId) {
        const dbMessages = await getMessages(fastify.pg, sessionId);
        history = dbMessages.map((m) => {
          const toolCalls = parseToolCalls(m.tool_calls);
          return {
            role: m.role as "user" | "assistant" | "tool",
            content: m.content,
            ...(toolCalls ? { tool_calls: toolCalls } : {}),
            ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          };
        });
      } else {
        const firstUserMsg = body.messages.find((m) => m.role === "user")?.content || "New Chat";
        const title = firstUserMsg.slice(0, 50) + (firstUserMsg.length > 50 ? "..." : "");
        const session = await createSession(fastify.pg, user.id, title);
        sessionId = session.id;
      }

      // Store trace ID for new sessions
      if (!traceId && trace && sessionId) {
        await setSessionTraceId(fastify.pg, sessionId, trace.id);
      }

      // Append the latest user message to DB
      const latestUserMsg = body.messages[body.messages.length - 1];
      if (latestUserMsg && latestUserMsg.role === "user") {
        await appendMessage(fastify.pg, sessionId, "user", latestUserMsg.content);
        history.push({ role: "user", content: latestUserMsg.content });
      }

      const writeEvent = (event: ChatStreamEvent) => {
        try {
          reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        } catch {
          // client disconnected
        }
      };

      const result = await chatStream(history, fastify, writeEvent, trace, body.uiContext, user, body.approvedToolNames || []);
      chatStreamCompleted = true;

      // Save assistant message
      if (result.toolCalls && result.toolCalls.length > 0) {
        const toolCallsToSave = result.toolCalls.map((t) => ({
          id: t.call.id,
          type: t.call.type,
          function: {
            name: t.call.function.name,
            arguments: typeof t.call.function.arguments === "string" ? t.call.function.arguments : JSON.stringify(t.call.function.arguments),
          },
        }));
        await appendMessage(fastify.pg, sessionId, "assistant", result.content ?? "", toolCallsToSave);
        for (const tc of result.toolCalls) {
          const toolResultStr = tc.result !== undefined ? JSON.stringify(tc.result) : "null";
          await appendMessage(fastify.pg, sessionId, "tool", toolResultStr, undefined, tc.call.id);
        }
      } else {
        await appendMessage(fastify.pg, sessionId, "assistant", result.content ?? "");
      }
      assistantSaved = true;

      await trace?.end({ output: { contentLength: result.content?.length ?? 0 }, status: "completed" });
      writeEvent({ type: "done", content: result.content ?? "", sessionId });
    } catch (err: unknown) {
      fastify.log.error({ err: errorMessage(err), stack: errorStack(err), sessionId }, "Chat stream failed");
      try {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ type: "error", message: errorMessage(err) })}\n\n`);
      } catch {
        // client disconnected
      }
    } finally {
      // T7: If the stream completed but we didn't save the assistant message
      // (client disconnected mid-save), append a synthetic message so the
      // session remains valid for the next turn.
      if (chatStreamCompleted && !assistantSaved && sessionId) {
        try {
          await appendMessage(fastify.pg, sessionId, "assistant", "[interrupted]");
        } catch (err: unknown) {
          fastify.log.warn({ err: errorMessage(err), sessionId }, "Failed to write abort finalizer");
        }
      }
      try {
        reply.raw.end();
      } catch {
        // already closed
      }
    }
  });
}
