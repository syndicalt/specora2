import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { id?: string; email?: string; role?: string; type?: string; typ?: string; sid?: string; jti?: string; provider?: string; returnTo?: string; configId?: string };
    user: { id: string; email?: string; role?: string; type?: string; typ?: string; sid?: string; jti?: string };
  }
}
