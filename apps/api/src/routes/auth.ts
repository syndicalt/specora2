import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";

const JWT_EXPIRES_IN = "24h";

function buildTokenPayload(user: { id: string; email: string; role: string }) {
  return { id: user.id, email: user.email, role: user.role, jti: crypto.randomUUID() };
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/api/login", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
        keyGenerator: (req: any) => req.ip,
      },
    },
  }, async (request, reply) => {
    const body = request.body as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.status(400).send({ error: "email and password required" });
    }

    const result = await fastify.pg.query(
      "SELECT id, name, email, password_hash, role FROM users WHERE email = $1",
      [body.email]
    );
    const user = result.rows[0];
    if (!user) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(body.password, user.password_hash || "");
    if (!valid) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const token = await fastify.jwt.sign(buildTokenPayload(user), { expiresIn: JWT_EXPIRES_IN });
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  });

  fastify.post("/api/register", async (request, reply) => {
    const body = request.body as { email?: string; password?: string; name?: string };
    if (!body.email || !body.password || !body.name) {
      return reply.status(400).send({ error: "email, password, and name required" });
    }

    const existing = await fastify.pg.query("SELECT id FROM users WHERE email = $1", [body.email]);
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: "User already exists" });
    }

    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(body.password, 10);

    // Create canonical user in Postgres
    await fastify.pg.query(
      "INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5)",
      [id, body.email, body.name, passwordHash, "operator"]
    );

    // Create visualization node in Neo4j (no passwordHash)
    const session = fastify.neo4j.session();
    try {
      await session.run(
        `CREATE (u:User:ConfigurationItem {id: $ciId, name: $name, email: $email, class: 'User', userId: $userId})`,
        { ciId: `usr-${id.slice(0, 8)}`, name: body.name, email: body.email, userId: id }
      );
    } finally {
      await session.close();
    }

    const token = await fastify.jwt.sign(buildTokenPayload({ id, email: body.email, role: "operator" }), { expiresIn: JWT_EXPIRES_IN });
    return { token, user: { id, name: body.name, email: body.email, role: "operator" } };
  });

  fastify.post("/api/auth/refresh", { onRequest: [fastify.authenticate] }, async (request, _reply) => {
    const user = request.user as { id: string; email: string; role: string };
    const fresh = await fastify.jwt.sign(buildTokenPayload(user), { expiresIn: JWT_EXPIRES_IN });
    return { token: fresh };
  });

  fastify.post("/api/ws-ticket", { onRequest: [fastify.authenticate] }, async (request, _reply) => {
    const user = request.user as { id: string };
    const ticket = await fastify.jwt.sign({ id: user.id, type: "ws-ticket" }, { expiresIn: "60s" });
    return { ticket };
  });
}
