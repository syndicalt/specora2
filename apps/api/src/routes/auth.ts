import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/api/login", async (request, reply) => {
    const body = request.body as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.status(400).send({ error: "email and password required" });
    }

    const session = fastify.neo4j.session();
    try {
      const result = await session.run(
        `MATCH (u:User:ConfigurationItem {email: $email}) RETURN u`,
        { email: body.email }
      );
      const record = result.records[0];
      if (!record) {
        return reply.status(401).send({ error: "Invalid credentials" });
      }
      const user = record.get("u").properties;
      const valid = await bcrypt.compare(body.password, user.passwordHash || "");
      if (!valid) {
        return reply.status(401).send({ error: "Invalid credentials" });
      }
      const token = await fastify.jwt.sign({ id: user.id, email: user.email });
      return { token, user: { id: user.id, name: user.name, email: user.email } };
    } finally {
      await session.close();
    }
  });

  fastify.post("/api/register", async (request, reply) => {
    const body = request.body as { email?: string; password?: string; name?: string };
    if (!body.email || !body.password || !body.name) {
      return reply.status(400).send({ error: "email, password, and name required" });
    }

    const session = fastify.neo4j.session();
    try {
      const existing = await session.run(
        `MATCH (u:User:ConfigurationItem {email: $email}) RETURN u`,
        { email: body.email }
      );
      if (existing.records.length > 0) {
        return reply.status(409).send({ error: "User already exists" });
      }

      const id = crypto.randomUUID();
      const passwordHash = await bcrypt.hash(body.password, 10);
      await session.run(
        `CREATE (u:User:ConfigurationItem {id: $id, name: $name, email: $email, class: 'User', passwordHash: $passwordHash})`,
        { id, name: body.name, email: body.email, passwordHash }
      );
      const token = await fastify.jwt.sign({ id, email: body.email });
      return { token, user: { id, name: body.name, email: body.email } };
    } finally {
      await session.close();
    }
  });
}
