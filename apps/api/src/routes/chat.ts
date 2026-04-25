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

const BUILTIN_CHAT_CAPABILITIES = [
  {
    appId: "change-manager",
    appName: "Change Manager",
    capabilities: [
      { id: "change-manager.create", label: "Create change request", description: "Start a new RFC with step-by-step guidance", prompt: "I want to create a new change request", icon: "GitPullRequest" },
      { id: "change-manager.list", label: "List pending changes", description: "Show all change requests awaiting action", prompt: "Show me all pending change requests", icon: "List" },
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
      { id: "cmdb.search", label: "Search CMDB", description: "Find CIs by name, class, or property", prompt: "Search the CMDB", icon: "Database" },
      { id: "cmdb.nl-search", label: "Ask CMDB (natural language)", description: "Search the CMDB using plain English questions", prompt: "Ask the CMDB a question", icon: "MessageCircleQuestion" },
      { id: "cmdb.list-servers", label: "List all servers", description: "Show every Server-class CI", prompt: "List all servers in the CMDB", icon: "Server" },
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
  fastify.get("/api/chat/capabilities", { onRequest: [fastify.authenticate] }, async (_request, _reply) => {
    return { capabilities: BUILTIN_CHAT_CAPABILITIES };
  });

  // List sessions
  fastify.get("/api/chat/sessions", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as { id: string; email: string };
    try {
      const sessions = await listSessions(fastify.pg, user.id);
      return { sessions };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to list sessions" });
    }
  });

  // Create session
  fastify.post("/api/chat/sessions", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as { id: string; email: string };
    const body = request.body as { title?: string };
    try {
      const session = await createSession(fastify.pg, user.id, body.title);
      return { session };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to create session" });
    }
  });

  // Delete session
  fastify.delete("/api/chat/sessions/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as { id: string; email: string };
    const { id } = request.params as { id: string };
    try {
      const deleted = await deleteSession(fastify.pg, user.id, id);
      if (!deleted) {
        return reply.status(404).send({ error: "Session not found" });
      }
      return { success: true };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to delete session" });
    }
  });

  // Get messages for a session
  fastify.get("/api/chat/sessions/:id/messages", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as { id: string; email: string };
    const { id } = request.params as { id: string };
    try {
      const messages = await getMessages(fastify.pg, id, user.id);
      return { messages };
    } catch (err: any) {
      if (err.message === "Session not found or access denied") {
        return reply.status(404).send({ error: "Session not found" });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to get messages" });
    }
  });

  // Chat endpoint
  fastify.post("/api/chat", {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const user = request.user as { id: string; email: string };
    const body = request.body as {
      messages: { role: "user" | "assistant" | "tool"; content: string; tool_calls?: any; tool_call_id?: string }[];
      sessionId?: string;
      uiContext?: string;
    };

    if (!body.messages || !Array.isArray(body.messages)) {
      return reply.status(400).send({ error: "messages array required" });
    }

    const pathlight = fastify.pathlight;

    let sessionId = body.sessionId;
    let trace: any;
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

      let history: { role: "user" | "assistant" | "tool"; content: string; tool_calls?: any; tool_call_id?: string }[] = [];

      if (sessionId) {
        // Load existing history
        const dbMessages = await getMessages(fastify.pg, sessionId);
        history = dbMessages.map((m) => {
          let toolCalls = m.tool_calls;
          // tool_calls may have been stored as a JSON string inside JSONB by older code
          if (typeof toolCalls === "string") {
            try { toolCalls = JSON.parse(toolCalls); } catch { toolCalls = null; }
          }
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
      const result: ChatResult = await chat(history, fastify, trace, body.uiContext, request.user as any);

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
    } catch (err: any) {
      fastify.log.error({ err: err.message, stack: err.stack, sessionId }, "Chat endpoint failed");
      await trace?.end({ status: "failed", error: err.message });
      return reply.status(500).send({ error: err.message || "Chat failed" });
    }
  });

  // Chat streaming endpoint (SSE)
  fastify.post("/api/chat/stream", {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const user = request.user as { id: string; email: string; role?: string };
    const body = request.body as {
      messages: { role: "user" | "assistant" | "tool"; content: string; tool_calls?: any; tool_call_id?: string }[];
      sessionId?: string;
      uiContext?: string;
    };

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
    let trace: any;
    let chatStreamCompleted = false;
    let assistantSaved = false;
    try {
      let history: { role: "user" | "assistant" | "tool"; content: string; tool_calls?: any; tool_call_id?: string }[] = [];

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
          let toolCalls = m.tool_calls;
          if (typeof toolCalls === "string") {
            try { toolCalls = JSON.parse(toolCalls); } catch { toolCalls = null; }
          }
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

      const result = await chatStream(history, fastify, writeEvent, trace, body.uiContext, user);
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
    } catch (err: any) {
      fastify.log.error({ err: err.message, stack: err.stack, sessionId }, "Chat stream failed");
      try {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ type: "error", message: err.message || "Chat failed" })}\n\n`);
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
        } catch (e: any) {
          fastify.log.warn({ err: e.message, sessionId }, "Failed to write abort finalizer");
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
