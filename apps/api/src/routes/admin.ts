import { FastifyInstance } from "fastify";
import { registerAdminAuditLogRoutes } from "./admin/auditLog";
import { registerAdminCredentialRoutes } from "./admin/credentials";
import { registerAdminEdgeEnrollmentRoutes } from "./admin/edgeEnrollment";
import { registerAdminIdentityGroupRoutes } from "./admin/identityGroups";
import { registerAdminIdentityProviderRoutes } from "./admin/identityProviders";
import { registerAdminNumberSequenceRoutes } from "./admin/numberSequences";
import { registerAdminOperationalIntelligenceRoutes } from "./admin/operationalIntelligence";
import { registerAdminPanelRoutes } from "./admin/panels";
import { registerAdminPermissionRoutes } from "./admin/permissions";
import { registerAdminRbacRoutes } from "./admin/rbac";
import { registerAdminSystemPropertyRoutes } from "./admin/systemProperties";
import { registerAdminUserRoutes } from "./admin/users";

export { getStateMachineConfig } from "./admin/systemProperties";

export async function adminRoutes(fastify: FastifyInstance) {
  registerAdminAuditLogRoutes(fastify);
  registerAdminCredentialRoutes(fastify);
  registerAdminEdgeEnrollmentRoutes(fastify);
  registerAdminIdentityGroupRoutes(fastify);
  registerAdminIdentityProviderRoutes(fastify);
  registerAdminNumberSequenceRoutes(fastify);
  registerAdminOperationalIntelligenceRoutes(fastify);
  registerAdminPanelRoutes(fastify);
  registerAdminPermissionRoutes(fastify);
  registerAdminRbacRoutes(fastify);
  registerAdminSystemPropertyRoutes(fastify);
  registerAdminUserRoutes(fastify);
}
