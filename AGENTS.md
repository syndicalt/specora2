# AGENTS.md

## Project Overview
Specora is an open-source, AI-native ITSM platform. This document provides context for AI coding agents working on the codebase.

## Architecture
- **Monorepo**: pnpm workspaces + Turborepo.
- **API**: TypeScript/Fastify/GraphQL Yoga. Runs on Node 20.
- **Web**: Next.js 14 App Router. Conversational-first UI with React Flow graph visualization.
- **Worker**: Python 3.12 asyncio gRPC server. Handles ingestion and background jobs.
- **Database**: Neo4j CE (graph) + PostgreSQL 16 (queue/ops).
- **Protocol**: gRPC + Protobuf for API-to-Worker communication.

## Key Conventions
- **TypeScript**: Strict mode enabled. Prefer `type` over `interface` for data shapes.
- **GraphQL**: All CRUD for CSDMv5 entities goes through the Yoga server at `/graphql`.
- **Neo4j**: Cypher queries should use parameterized queries. Never interpolate user input.
- **Python**: Use `async`/`await` for IO-bound operations. Format with black (recommended).
- **Styling**: Tailwind CSS. Dark-first UI (`bg-gray-950`, `text-gray-100`).
- **Auth**: Stateless JWT. The `Authorization: Bearer <token>` header is required for GraphQL operations.

## Environment Variables
| Variable | Used By | Description |
|----------|---------|-------------|
| `NEO4J_URI` | API, Worker | Neo4j Bolt URI |
| `NEO4J_USER` | API, Worker | Neo4j username |
| `NEO4J_PASSWORD` | API, Worker | Neo4j password |
| `DATABASE_URL` | Worker | PostgreSQL connection string |
| `JWT_SECRET` | API | Signing secret for JWT |
| `WORKER_GRPC_HOST` | API | gRPC target (e.g., `worker:50051`) |
| `GRPC_PORT` | Worker | Port for gRPC server |
| `NEXT_PUBLIC_API_URL` | Web | GraphQL endpoint URL |
| `OPENAI_API_KEY` | API | OpenAI API key for chat (fallback if Provara not set) |
| `PROVARA_URL` | API | Provara API endpoint for model routing |
| `PROVARA_API_KEY` | API | Provara API key |
| `PROVARA_TENANT_ID` | API | Provara tenant ID for multi-tenant mode (optional) |
| `PATHLIGHT_URL` | Worker | Pathlight trace collector URL (optional) |
| `REDIS_URL` | API | Redis connection string for multi-instance pub/sub (default: `redis://localhost:6379`) |
| `UPLOAD_DIR` | API | Local directory for uploaded discovery files (default: `./uploads`) |

## Common Commands
- `pnpm install` — Install all dependencies.
- `pnpm dev` — Start all apps in development mode.
- `pnpm --filter @specora/db seed` — Seed Neo4j with CSDMv5 schema and sample data.
- `pnpm proto:generate` — Regenerate gRPC stubs from `.proto` files.
- `docker-compose up -d neo4j postgres` — Start local infrastructure.

## App Ecosystem (Specora Arc)
- Built-in apps live in `apps/web/src/apps/<id>/` and are registered in `BUILT_IN_COMPONENTS` (`AppContainers.tsx`) and `seedBuiltInApps` (`sdk/index.ts`).
- External apps are loaded dynamically via ESM `import(/* webpackIgnore: true */ url)` with an iframe sandbox fallback on failure.
- The `ShellAPI` passed to every app is permission-filtered based on the app's declared `permissions` array.
- The marketplace backend uses the `marketplace_apps` PostgreSQL table (migrations `006`/`007`).
- Admin users can approve/reject submitted apps via the "Review" tab in the Arc app.

## Important Notes
- The UI is conversational-first. **Ctrl+K** opens the chat overlay from anywhere.
- Relationship types in Neo4j are validated against an allowlist in the API resolver.
- Attributes on ConfigurationItems are stored as JSON strings in Neo4j due to property map limitations; always parse with `parseNode()`.
- The worker uses dynamic gRPC stubs generated from `packages/protobuf/itops.proto`.
- Do not commit `.env` files.
