# Operations Guide

This guide covers deployment and runtime operations for administrators and platform operators.

## Infrastructure

Specora uses:

- Web app.
- API service.
- Worker service.
- PostgreSQL.
- Neo4j.
- Optional Redis.
- Optional Provara/OpenAI LLM routing.

## Environment Variables

Common variables include:

- `DATABASE_URL`
- `NEO4J_URI`
- `NEO4J_USER`
- `NEO4J_PASSWORD`
- `JWT_SECRET`
- `NEXT_PUBLIC_API_URL`
- `PROVARA_URL`
- `PROVARA_API_KEY`
- `OPENAI_API_KEY`
- `REDIS_URL`
- `UPLOAD_DIR`

Do not commit `.env` files.

## Deployment

Typical deployment order:

1. Provision PostgreSQL.
2. Provision Neo4j.
3. Configure API environment variables.
4. Configure web environment variables.
5. Deploy API.
6. Deploy web.
7. Run database migrations.
8. Seed required system data.
9. Create or import admin users.
10. Validate sign-in and core app access.

## Migrations

Run migrations after deployment and before UAT.

Common commands:

```bash
pnpm migrate:status
pnpm migrate
```

For Railway deployments, set `DATABASE_URL` from the target PostgreSQL service before running migrations.

## Demo Data

Demo data is useful for evaluation environments. Avoid importing demo data into production tenants unless explicitly intended.

## Backup and Restore

Back up:

- PostgreSQL.
- Neo4j.
- Uploaded discovery evidence.
- Runtime configuration.
- Secret stores or deployment variables.

Restore order should match dependency order:

1. Databases.
2. Upload storage.
3. API service.
4. Worker service.
5. Web service.

## LLM Routing

Specora supports Provara as the primary router and OpenAI as a fallback path when configured.

Chat behavior depends on:

- Model availability.
- Tool-call support.
- Streaming reliability.
- Platform context provided by apps.

Use governed prompts and tool results for operational decisions.

## Production Checks

Before demo or production validation:

- Confirm web loads.
- Confirm API health or GraphQL endpoint responds.
- Confirm sign-in works.
- Confirm migrations are current.
- Confirm Admin Console opens.
- Confirm CMDB Explorer can query records.
- Confirm Tables can edit records.
- Confirm global chat can respond.
- Confirm discovery jobs and edge enrollment routes are reachable if demonstrating discovery.

## Railway Release Checklist

Use the checked-in Railway checklist after each deployment to validate the public web/API boundary and the demo-ready app registry.

```bash
SPECORA_WEB_URL=https://specora-dev.specora.org \
SPECORA_API_URL=https://gateway-dev.specora.org \
SPECORA_ADMIN_EMAIL=admin@specora.org \
SPECORA_ADMIN_PASSWORD='<admin password>' \
pnpm railway:check
```

The script checks:

- Web `/login` and root app shell reachability.
- API `/healthz`, `/ready`, and `/graphql` reachability.
- Admin password login when credentials are provided.
- Authenticated app registry presence for Admin Console, Customer Portal, Settings, and Specora Arc.
- Migration status when `DATABASE_URL` is set.
- Documentation screenshot catalog presence.

When checking migrations from a workstation, export the Railway PostgreSQL connection string first:

```bash
DATABASE_URL='<railway postgres public url>' pnpm railway:check
```

Related:

- [Admin Guide](../admin/README.md)
- [Getting Started](../getting-started.md)
