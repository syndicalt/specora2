import type { FastifyInstance } from "fastify";
import { getAllRegisteredApps, getAppCatalog, getVisibleApps } from "../services/appRegistry";
import { recordAuditEvent } from "../services/auditLog";

async function requireAdmin(user: any, reply: any) {
  if (!["admin", "security_admin"].includes(user?.role || "")) {
    reply.status(403).send({ error: "Forbidden" });
    return false;
  }
  return true;
}

async function createProvisioningJob(fastify: FastifyInstance, input: {
  appId: string;
  action: "install" | "uninstall";
  userId?: string | null;
  clearDataOnUninstall?: boolean;
  dataRetentionPolicy?: string;
}) {
  const apps = await getAllRegisteredApps(fastify);
  const app = apps.find((candidate) => candidate.id === input.appId);
  if (!app) return null;
  if (app.source === "built-in" && app.bundledWithPlatform !== false && input.action === "uninstall") {
    return { coreBlocked: true, app };
  }

  const job = await fastify.pg.query(
    `INSERT INTO app_provisioning_jobs
       (app_id, action, status, requested_by, clear_data_on_uninstall, data_retention_policy, message, metadata, completed_at)
     VALUES ($1, $2, 'completed', $3, $4, $5, $6, $7, NOW())
     RETURNING id, app_id, action, status, requested_by, clear_data_on_uninstall, data_retention_policy, message, metadata, created_at, updated_at, completed_at`,
    [
      input.appId,
      input.action,
      input.userId || null,
      !!input.clearDataOnUninstall,
      input.dataRetentionPolicy || "retain",
      input.action === "install" ? `${app.name} installed` : `${app.name} uninstalled`,
      JSON.stringify({ appName: app.name, packageId: app.packageId || null, immediate: true }),
    ]
  );
  const row = job.rows[0];
  if (input.action === "install") {
    await fastify.pg.query(
      `INSERT INTO app_installations
         (app_id, status, installed_by, installed_at, uninstalled_at, clear_data_on_uninstall, data_retention_policy, last_job_id, metadata, updated_at)
       VALUES ($1, 'installed', $2, NOW(), NULL, FALSE, 'retain', $3, $4, NOW())
       ON CONFLICT (app_id) DO UPDATE SET
         status = 'installed',
         installed_by = EXCLUDED.installed_by,
         installed_at = NOW(),
         uninstalled_at = NULL,
         last_job_id = EXCLUDED.last_job_id,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [input.appId, input.userId || null, row.id, JSON.stringify({ appName: app.name, packageId: app.packageId || null })]
    );
  } else {
    await fastify.pg.query(
      `INSERT INTO app_installations
         (app_id, status, installed_by, installed_at, uninstalled_at, clear_data_on_uninstall, data_retention_policy, last_job_id, metadata, updated_at)
       VALUES ($1, 'uninstalled', $2, NULL, NOW(), $3, $4, $5, $6, NOW())
       ON CONFLICT (app_id) DO UPDATE SET
         status = 'uninstalled',
         uninstalled_at = NOW(),
         clear_data_on_uninstall = EXCLUDED.clear_data_on_uninstall,
         data_retention_policy = EXCLUDED.data_retention_policy,
         last_job_id = EXCLUDED.last_job_id,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [input.appId, input.userId || null, !!input.clearDataOnUninstall, input.dataRetentionPolicy || "retain", row.id, JSON.stringify({ appName: app.name, packageId: app.packageId || null })]
    );
  }
  await recordAuditEvent(fastify, {
    actorId: input.userId,
    action: `app.${input.action}`,
    entityType: "AppInstallation",
    entityId: input.appId,
    newValues: {
      appId: input.appId,
      appName: app.name,
      status: input.action === "install" ? "installed" : "uninstalled",
      jobId: row.id,
      clearDataOnUninstall: !!input.clearDataOnUninstall,
      dataRetentionPolicy: input.dataRetentionPolicy || "retain",
    },
    metadata: {
      source: "api.apps",
      surface: "arc",
      jobId: row.id,
      packageId: app.packageId || null,
    },
  });
  return { job: row, app };
}

export async function appsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/apps/registry", { onRequest: [fastify.authenticate] }, async (request) => {
    const user = request.user as { id?: string; role?: string } | null;
    const apps = await getVisibleApps(fastify, user);
    return { apps };
  });

  fastify.get("/api/apps/catalog", { onRequest: [fastify.authenticate] }, async (request) => {
    const user = request.user as { id?: string; role?: string } | null;
    const apps = await getAppCatalog(fastify, user);
    return { apps };
  });

  fastify.get("/api/apps/provisioning-jobs", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requireAdmin(user, reply))) return;
    const result = await fastify.pg.query(
      `SELECT id, app_id, action, status, requested_by, clear_data_on_uninstall, data_retention_policy, message, metadata, created_at, updated_at, completed_at
       FROM app_provisioning_jobs ORDER BY created_at DESC LIMIT 100`
    );
    return { jobs: result.rows };
  });

  fastify.post("/api/apps/:id/install", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requireAdmin(user, reply))) return;
    const { id } = request.params as { id: string };
    const result = await createProvisioningJob(fastify, { appId: id, action: "install", userId: user?.id });
    if (!result) return reply.status(404).send({ error: "App not found" });
    return { job: result.job, app: result.app };
  });

  fastify.post("/api/apps/:id/uninstall", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requireAdmin(user, reply))) return;
    const { id } = request.params as { id: string };
    const body = request.body as { clearData?: boolean; dataRetentionPolicy?: string };
    const result = await createProvisioningJob(fastify, {
      appId: id,
      action: "uninstall",
      userId: user?.id,
      clearDataOnUninstall: !!body.clearData,
      dataRetentionPolicy: body.dataRetentionPolicy || (body.clearData ? "purge" : "retain"),
    });
    if (!result) return reply.status(404).send({ error: "App not found" });
    if ("coreBlocked" in result) return reply.status(400).send({ error: "Core platform apps cannot be uninstalled" });
    return { job: result.job, app: result.app };
  });
}
