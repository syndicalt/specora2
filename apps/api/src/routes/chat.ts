import { FastifyInstance } from "fastify";
import { chat, ChatResult } from "../services/chat";
import {
  createSession,
  listSessions,
  deleteSession,
  getMessages,
  appendMessage,
  updateSessionTitle,
} from "../services/chatSession";

export async function chatRoutes(fastify: FastifyInstance) {
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
    const { id } = request.params as { id: string };
    try {
      const messages = await getMessages(fastify.pg, id);
      return { messages };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to get messages" });
    }
  });

  // Chat endpoint
  fastify.post("/api/chat", { onRequest: [fastify.authenticate] }, async (request, reply) => {
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
    const trace = pathlight?.trace("chat-request", { userId: user.id, sessionId: body.sessionId });

    try {
      let sessionId = body.sessionId;
      let history: { role: "user" | "assistant" | "tool"; content: string; tool_calls?: any; tool_call_id?: string }[] = [];

      if (sessionId) {
        // Load existing history
        const dbMessages = await getMessages(fastify.pg, sessionId);
        history = dbMessages.map((m) => ({
          role: m.role as "user" | "assistant" | "tool",
          content: m.content,
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        }));
      } else {
        // Create a new session with title from first user message
        const firstUserMsg = body.messages.find((m) => m.role === "user")?.content || "New Chat";
        const title = firstUserMsg.slice(0, 50) + (firstUserMsg.length > 50 ? "..." : "");
        const session = await createSession(fastify.pg, user.id, title);
        sessionId = session.id;
      }

      // Append the latest user message to DB
      const latestUserMsg = body.messages[body.messages.length - 1];
      if (latestUserMsg && latestUserMsg.role === "user") {
        await appendMessage(fastify.pg, sessionId, "user", latestUserMsg.content);
        history.push({ role: "user", content: latestUserMsg.content });
      }

      // Call AI
      const result: ChatResult = await chat(history, fastify, trace, body.uiContext);

      // Save assistant message with tool calls if any
      if (result.toolCalls && result.toolCalls.length > 0) {
        await appendMessage(
          fastify.pg,
          sessionId,
          "assistant",
          result.content,
          JSON.stringify(result.toolCalls.map((t) => ({
            id: t.call.id,
            type: t.call.type,
            function: {
              name: t.call.function.name,
              arguments: t.call.function.arguments,
            },
          })))
        );
        // Save each tool result as a separate tool message
        for (const tc of result.toolCalls) {
          await appendMessage(fastify.pg, sessionId, "tool", JSON.stringify(tc.result), undefined, tc.call.id);
        }
      } else {
        await appendMessage(fastify.pg, sessionId, "assistant", result.content);
      }

      await trace?.end({ output: { contentLength: result.content.length }, status: "completed" });

      return { role: "assistant", content: result.content, sessionId };
    } catch (err: any) {
      fastify.log.error(err);
      await trace?.end({ status: "failed", error: err.message });
      return reply.status(500).send({ error: err.message || "Chat failed" });
    }
  });
}
