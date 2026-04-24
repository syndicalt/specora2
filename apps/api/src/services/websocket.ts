import { FastifyInstance } from "fastify";
import { SocketStream } from "@fastify/websocket";

interface ClientConnection {
  socket: SocketStream;
  userId: string;
  subscriptions: Set<string>;
  lastPong: number;
}

const connections = new Set<ClientConnection>();

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
  const message = safeStringify({ type, payload, timestamp: new Date().toISOString() });
  for (const client of connections) {
    if (client.subscriptions.has(type) || client.subscriptions.has("*")) {
      try {
        client.socket.socket.send(message);
      } catch {
        connections.delete(client);
      }
    }
  }
}

/** Close all connections (useful for graceful shutdown) */
export function closeAllConnections() {
  for (const client of connections) {
    try {
      client.socket.socket.close();
    } catch {
      // ignore
    }
  }
  connections.clear();
}

/** Get current connection count for health/monitoring */
export function getConnectionCount(): number {
  return connections.size;
}

export async function websocketRoutes(fastify: FastifyInstance) {
  fastify.get("/api/events/live", { websocket: true }, (connection, req) => {
    // Auth via short-lived ticket exchanged over HTTP POST /api/ws-ticket.
    // Parse from raw URL because @fastify/websocket may not populate req.query.
    const rawUrl = (req as any).raw?.url || req.url || "";
    const qsIndex = rawUrl.indexOf("?");
    const queryString = qsIndex >= 0 ? rawUrl.slice(qsIndex + 1) : "";
    const params = new URLSearchParams(queryString);
    const ticket = params.get("ticket");

    let userId: string | null = null;
    try {
      if (!ticket) throw new Error("Missing ticket");
      const decoded = fastify.jwt.verify(ticket) as { id: string; type?: string };
      if (decoded.type !== "ws-ticket") throw new Error("Invalid ticket type");
      userId = decoded.id;
    } catch (err: any) {
      fastify.log.warn({ err: err.message }, "WebSocket auth failed");
      connection.socket.close(1008, "Invalid ticket");
      return;
    }

    const client: ClientConnection = {
      socket: connection,
      userId: userId!,
      subscriptions: new Set(),
      lastPong: Date.now(),
    };
    connections.add(client);
    fastify.log.info({ userId, connections: connections.size }, "WebSocket client connected");

    // Heartbeat: server sends protocol-level ping every 30s, expects pong within 10s
    connection.socket.on("pong", () => {
      client.lastPong = Date.now();
    });

    const pingInterval = setInterval(() => {
      if (Date.now() - client.lastPong > 40000) {
        fastify.log.warn({ userId }, "WebSocket client heartbeat timeout");
        connection.socket.close(1001, "Heartbeat timeout");
        return;
      }
      try {
        connection.socket.ping();
      } catch {
        clearInterval(pingInterval);
        connections.delete(client);
      }
    }, 30000);

    connection.socket.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.action === "subscribe" && Array.isArray(msg.types)) {
          for (const t of msg.types) client.subscriptions.add(t);
          connection.socket.send(JSON.stringify({ type: "subscribed", types: msg.types }));
        } else if (msg.action === "unsubscribe" && Array.isArray(msg.types)) {
          for (const t of msg.types) client.subscriptions.delete(t);
          connection.socket.send(JSON.stringify({ type: "unsubscribed", types: msg.types }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    connection.socket.on("close", () => {
      clearInterval(pingInterval);
      connections.delete(client);
      fastify.log.info({ userId, connections: connections.size }, "WebSocket client disconnected");
    });

    connection.socket.on("error", (err: any) => {
      fastify.log.warn({ err: err.message, userId }, "WebSocket error");
    });
  });
}
