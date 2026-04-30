import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../services/rbac";
import { recordAuditEvent } from "../../services/auditLog";
import {
  CREDENTIAL_PROVIDER_MODES,
  credentialReferenceRow,
  encryptCredentialSecret,
  normalizeCredentialReferenceBody,
  testCredentialReference,
} from "../../services/credentials";

type DbError = Error & { code?: string };
type CredentialRefRowInput = Parameters<typeof credentialReferenceRow>[0];

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function dbError(err: unknown): DbError {
  return err instanceof Error ? err as DbError : new Error(String(err)) as DbError;
}

export function registerAdminCredentialRoutes(fastify: FastifyInstance) {
  fastify.get("/api/admin/credentials", { onRequest: [fastify.authenticate, requirePermission("credentials", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        `SELECT id, ref, name, provider, status, description, scope, secret_env_key, external_ref,
                encrypted_secret IS NOT NULL AS secret_present, metadata,
                last_tested_at, last_status, last_error, created_by, updated_by, created_at, updated_at
         FROM credential_references
         ORDER BY scope, name`
      );
      return {
        credentials: (result.rows as CredentialRefRowInput[]).map(credentialReferenceRow),
        providers: CREDENTIAL_PROVIDER_MODES.map((provider) => ({ id: provider, name: provider })),
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to fetch credential references") });
    }
  });

  fastify.post("/api/admin/credentials", { onRequest: [fastify.authenticate, requirePermission("credentials", "write")] }, async (request, reply) => {
    const config = normalizeCredentialReferenceBody(request.body);
    if ("error" in config) return reply.status(400).send({ error: config.error });
    try {
      const result = await fastify.pg.query(
        `INSERT INTO credential_references (
           ref, name, provider, status, description, scope, secret_env_key, external_ref, encrypted_secret, metadata, created_by, updated_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $11)
         RETURNING id, ref, name, provider, status, description, scope, secret_env_key, external_ref,
                   encrypted_secret IS NOT NULL AS secret_present, metadata,
                   last_tested_at, last_status, last_error, created_by, updated_by, created_at, updated_at`,
        [
          config.ref,
          config.name,
          config.provider,
          config.status || "active",
          config.description || null,
          config.scope || "discovery",
          config.secretEnvKey || null,
          config.externalRef || null,
          config.secretValue ? JSON.stringify(encryptCredentialSecret(config.secretValue)) : null,
          JSON.stringify(config.metadata || {}),
          request.user?.id || null,
        ]
      );
      const row = credentialReferenceRow(result.rows[0] as CredentialRefRowInput);
      await recordAuditEvent(fastify, {
        actorId: request.user?.id,
        action: "credential.reference.created",
        entityType: "CredentialReference",
        entityId: row.id,
        newValues: row,
        metadata: { source: "api.admin", surface: "admin-console", provider: row.provider, scope: row.scope },
      });
      return { credential: row };
    } catch (err) {
      const error = dbError(err);
      fastify.log.error(err);
      if (error.code === "23505") return reply.status(409).send({ error: "Credential reference already exists" });
      return reply.status(500).send({ error: errorMessage(err, "Failed to create credential reference") });
    }
  });

  fastify.patch("/api/admin/credentials/:id", { onRequest: [fastify.authenticate, requirePermission("credentials", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const config = normalizeCredentialReferenceBody(request.body, true);
    if ("error" in config) return reply.status(400).send({ error: config.error });
    try {
      const existing = await fastify.pg.query(
        `SELECT id, ref, name, provider, status, description, scope, secret_env_key, external_ref,
                encrypted_secret IS NOT NULL AS secret_present, metadata,
                last_tested_at, last_status, last_error, created_by, updated_by, created_at, updated_at
         FROM credential_references WHERE id = $1`,
        [id]
      );
      const result = await fastify.pg.query(
        `UPDATE credential_references SET
           name = COALESCE($2, name),
           provider = COALESCE($3, provider),
           status = COALESCE($4, status),
           description = COALESCE($5, description),
           scope = COALESCE($6, scope),
           secret_env_key = COALESCE($7, secret_env_key),
           external_ref = COALESCE($8, external_ref),
           encrypted_secret = COALESCE($9::jsonb, encrypted_secret),
           metadata = COALESCE($10::jsonb, metadata),
           updated_by = $11,
           updated_at = NOW()
         WHERE id = $1
         RETURNING id, ref, name, provider, status, description, scope, secret_env_key, external_ref,
                   encrypted_secret IS NOT NULL AS secret_present, metadata,
                   last_tested_at, last_status, last_error, created_by, updated_by, created_at, updated_at`,
        [
          id,
          config.name || null,
          config.provider || null,
          config.status || null,
          config.description ?? null,
          config.scope || null,
          config.secretEnvKey ?? null,
          config.externalRef ?? null,
          config.secretValue ? JSON.stringify(encryptCredentialSecret(config.secretValue)) : null,
          config.metadata ? JSON.stringify(config.metadata) : null,
          request.user?.id || null,
        ]
      );
      if (!result.rows.length) return reply.status(404).send({ error: "Credential reference not found" });
      const row = credentialReferenceRow(result.rows[0] as CredentialRefRowInput);
      await recordAuditEvent(fastify, {
        actorId: request.user?.id,
        action: "credential.reference.updated",
        entityType: "CredentialReference",
        entityId: row.id,
        oldValues: existing.rows[0] ? credentialReferenceRow(existing.rows[0] as CredentialRefRowInput) : undefined,
        newValues: row,
        metadata: { source: "api.admin", surface: "admin-console", provider: row.provider, scope: row.scope },
      });
      return { credential: row };
    } catch (err) {
      const error = dbError(err);
      fastify.log.error(err);
      if (error.code === "23505") return reply.status(409).send({ error: "Credential reference already exists" });
      return reply.status(500).send({ error: errorMessage(err, "Failed to update credential reference") });
    }
  });

  fastify.post("/api/admin/credentials/:id/test", { onRequest: [fastify.authenticate, requirePermission("credentials", "test")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const existing = await fastify.pg.query(
        `SELECT ref FROM credential_references WHERE id = $1`,
        [id]
      );
      if (!existing.rows.length) return reply.status(404).send({ error: "Credential reference not found" });
      const test = await testCredentialReference(fastify, (existing.rows[0] as { ref: string }).ref);
      const result = await fastify.pg.query(
        `UPDATE credential_references
         SET last_tested_at = NOW(), last_status = $2, last_error = $3, updated_by = $4, updated_at = NOW()
         WHERE id = $1
         RETURNING id, ref, name, provider, status, description, scope, secret_env_key, external_ref,
                   encrypted_secret IS NOT NULL AS secret_present, metadata,
                   last_tested_at, last_status, last_error, created_by, updated_by, created_at, updated_at`,
        [id, test.status, test.message, request.user?.id || null]
      );
      const row = credentialReferenceRow(result.rows[0] as CredentialRefRowInput);
      await recordAuditEvent(fastify, {
        actorId: request.user?.id,
        action: "credential.reference.tested",
        entityType: "CredentialReference",
        entityId: row.id,
        newValues: { ok: test.ok, status: test.status, message: test.message, credential: row },
        metadata: { source: "api.admin", surface: "admin-console", status: test.status },
      });
      return { ok: test.ok, status: test.status, message: test.message, credential: row };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to test credential reference") });
    }
  });

  fastify.delete("/api/admin/credentials/:id", { onRequest: [fastify.authenticate, requirePermission("credentials", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const existing = await fastify.pg.query(
        `SELECT id, ref, name, provider, status, description, scope, secret_env_key, external_ref,
                encrypted_secret IS NOT NULL AS secret_present, metadata,
                last_tested_at, last_status, last_error, created_by, updated_by, created_at, updated_at
         FROM credential_references WHERE id = $1`,
        [id]
      );
      const result = await fastify.pg.query("DELETE FROM credential_references WHERE id = $1 RETURNING id", [id]);
      if (!result.rows.length) return reply.status(404).send({ error: "Credential reference not found" });
      await recordAuditEvent(fastify, {
        actorId: request.user?.id,
        action: "credential.reference.deleted",
        entityType: "CredentialReference",
        entityId: id,
        oldValues: existing.rows[0] ? credentialReferenceRow(existing.rows[0] as CredentialRefRowInput) : { id },
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to delete credential reference") });
    }
  });
}
