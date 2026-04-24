import { FastifyInstance } from "fastify";
import { broadcast } from "./websocket";

export type EventPayload = Record<string, unknown>;

export type EventHandler = (payload: EventPayload) => void | Promise<void>;

const subscriptions = new Map<string, Set<EventHandler>>();

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

export function emit(type: string, payload: EventPayload) {
  // In-memory dispatch for immediate subscribers
  const handlers = subscriptions.get(type);
  if (handlers) {
    for (const handler of handlers) {
      Promise.resolve(handler(payload)).catch((err) => {
        console.error(`Event handler for ${type} failed:`, err);
      });
    }
  }

  // Broadcast to WebSocket subscribers
  broadcast(type, payload);
}

export { safeStringify };

export function subscribe(type: string, handler: EventHandler) {
  if (!subscriptions.has(type)) {
    subscriptions.set(type, new Set());
  }
  subscriptions.get(type)!.add(handler);
  return () => {
    subscriptions.get(type)?.delete(handler);
  };
}

export async function eventBusRoutes(fastify: FastifyInstance) {
  fastify.post("/events", { onRequest: [fastify.authenticate] }, async (request, _reply) => {
    const { type, payload } = request.body as { type: string; payload: EventPayload };
    if (!type || typeof type !== "string") {
      return _reply.status(400).send({ error: "Event type is required" });
    }

    // Persist to PostgreSQL for audit and polling
    await fastify.pg.query(
      "INSERT INTO events (type, payload) VALUES ($1, $2)",
      [type, JSON.stringify(payload || {})]
    );

    // In-memory dispatch
    emit(type, payload || {});

    return { success: true };
  });

  fastify.get("/events", { onRequest: [fastify.authenticate] }, async (request, _reply) => {
    const { type, since } = request.query as { type?: string; since?: string };
    let query = "SELECT id, type, payload, created_at FROM events WHERE 1=1";
    const params: (string | number)[] = [];
    let idx = 1;

    if (type) {
      query += ` AND type = $${idx++}`;
      params.push(type);
    }
    if (since) {
      query += ` AND created_at > $${idx++}`;
      params.push(since);
    }

    query += " ORDER BY created_at DESC LIMIT 100";

    const result = await fastify.pg.query(query, params);
    return result.rows;
  });
}
