import { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

interface ClientConnection {
  socket: WebSocket;
  userId: string;
  subscriptions: Set<string>;
  lastPong: number;
}

interface SseConnection {
  send: (message: string) => void;
  subscriptions: Set<string>;
}

const connections = new Set<ClientConnection>();
const sseConnections = new Set<SseConnection>();

function safeStringify(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  });
}

/** Broadcast an event to all WebSocket clients subscribed to its type */
export function broadcast(type: string, payload: Record<string, unknown>) {
  const event = { type, payload, timestamp: new Date().toISOString() };
  const message = safeStringify(event);
  for (const client of connections) {
    if (client.subscriptions.has(type) || client.subscriptions.has("*")) {
      try {
        client.socket.send(message);
      } catch {
        connections.delete(client);
      }
    }
  }
  for (const client of sseConnections) {
    if (client.subscriptions.has(type) || client.subscriptions.has("*")) {
      try {
        client.send(`data: ${message}\n\n`);
      } catch {
        sseConnections.delete(client);
      }
    }
  }
}

/** Close all connections (useful for graceful shutdown) */
export function closeAllConnections() {
  for (const client of connections) {
    try {
      client.socket.close();
    } catch {
      // ignore
    }
  }
  connections.clear();
  sseConnections.clear();
}

/** Get current connection count for health/monitoring */
export function getConnectionCount(): number {
  return connections.size + sseConnections.size;
}

export async function websocketRoutes(fastify: FastifyInstance) {
  function verifyTicket(ticket?: string | null) {
    if (!ticket) throw new Error("Missing ticket");
    const decoded = fastify.jwt.verify(ticket) as { id: string; type?: string };
    if (decoded.type !== "ws-ticket") throw new Error("Invalid ticket type");
    return decoded.id;
  }

  fastify.get("/api/events/stream", async (request: any, reply: any) => {
    const { ticket, types } = request.query as { ticket?: string; types?: string };
    let userId: string;
    try {
      userId = verifyTicket(ticket);
    } catch (err: any) {
      fastify.log.warn({ err: err.message }, "SSE auth failed");
      return reply.status(401).send({ error: "Invalid ticket" });
    }

    const subscriptions = new Set(
      String(types || "*")
        .split(",")
        .map((type) => type.trim())
        .filter(Boolean)
    );
    if (!subscriptions.size) subscriptions.add("*");

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`data: ${safeStringify({ type: "connected", payload: { transport: "sse" }, timestamp: new Date().toISOString() })}\n\n`);

    const client: SseConnection = {
      subscriptions,
      send: (message: string) => reply.raw.write(message),
    };
    sseConnections.add(client);
    fastify.log.info({ userId, connections: sseConnections.size }, "SSE event client connected");

    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(": keep-alive\n\n");
      } catch {
        clearInterval(keepAlive);
        sseConnections.delete(client);
      }
    }, 25000);

    request.raw.on("close", () => {
      clearInterval(keepAlive);
      sseConnections.delete(client);
      fastify.log.info({ userId, connections: sseConnections.size }, "SSE event client disconnected");
    });

    return;
  });

  (fastify as any).get("/api/events/live", { websocket: true }, (socket: WebSocket, req: any) => {
    // Auth via short-lived ticket exchanged over HTTP POST /api/ws-ticket.
    // Parse from raw URL because @fastify/websocket may not populate req.query.
    const rawUrl = (req as any).raw?.url || req.url || "";
    const qsIndex = rawUrl.indexOf("?");
    const queryString = qsIndex >= 0 ? rawUrl.slice(qsIndex + 1) : "";
    const params = new URLSearchParams(queryString);
    const ticket = params.get("ticket");

    let userId: string | null = null;
    try {
      userId = verifyTicket(ticket);
    } catch (err: any) {
      fastify.log.warn({ err: err.message }, "WebSocket auth failed");
      socket.close(1008, "Invalid ticket");
      return;
    }

    const client: ClientConnection = {
      socket,
      userId: userId!,
      subscriptions: new Set(),
      lastPong: Date.now(),
    };
    connections.add(client);
    fastify.log.info({ userId, connections: connections.size }, "WebSocket client connected");

    // Heartbeat: server sends protocol-level ping every 30s, expects pong within 10s
    socket.on("pong", () => {
      client.lastPong = Date.now();
    });

    const pingInterval = setInterval(() => {
      if (Date.now() - client.lastPong > 40000) {
        fastify.log.warn({ userId }, "WebSocket client heartbeat timeout");
        socket.close(1001, "Heartbeat timeout");
        return;
      }
      try {
        socket.ping();
      } catch {
        clearInterval(pingInterval);
        connections.delete(client);
      }
    }, 30000);

    socket.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.action === "subscribe" && Array.isArray(msg.types)) {
          for (const t of msg.types) client.subscriptions.add(t);
          socket.send(JSON.stringify({ type: "subscribed", types: msg.types }));
        } else if (msg.action === "unsubscribe" && Array.isArray(msg.types)) {
          for (const t of msg.types) client.subscriptions.delete(t);
          socket.send(JSON.stringify({ type: "unsubscribed", types: msg.types }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    socket.on("close", () => {
      clearInterval(pingInterval);
      connections.delete(client);
      fastify.log.info({ userId, connections: connections.size }, "WebSocket client disconnected");
    });

    socket.on("error", (err: any) => {
      fastify.log.warn({ err: err.message, userId }, "WebSocket error");
    });
  });
}
