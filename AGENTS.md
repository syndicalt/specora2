# AGENTS.md

This is the primary context file for AI coding agents working in Specora.

## Product Summary

Specora is an open-source, AI-native ITSM platform. It combines a graph-native CSDMv5 CMDB, a conversational workspace, and an app ecosystem called Specora Arc.

## Architecture

- **Monorepo**: pnpm workspaces + Turborepo.
- **API**: Node 20, TypeScript, Fastify, GraphQL Yoga, Neo4j driver, gRPC client.
- **Web**: Next.js 14 App Router, React, React Flow, TanStack Query, Tailwind CSS.
- **Worker**: Python 3.12 asyncio gRPC server for ingestion and background jobs.
- **Databases**: Neo4j CE for CMDB graph data; PostgreSQL 16 for queues, saved views, marketplace, audit/event data, and operational records.
- **Protocol**: gRPC + Protobuf for API-to-worker communication.
- **Auth**: Stateless JWT. GraphQL and app tool operations require `Authorization: Bearer <token>`.
- **AI routing**: Provara is the primary LLM router and supports tool calls. Direct OpenAI is a fallback path.

## Key Conventions

- **TypeScript**: Strict mode. Prefer `type` over `interface` for data shapes.
- **GraphQL**: CSDMv5 CRUD goes through GraphQL Yoga at `/graphql`.
- **Neo4j**: Use parameterized Cypher. Never interpolate user input. Relationship types are validated against an allowlist.
- **ConfigurationItem attributes**: Stored as JSON strings in Neo4j because Neo4j properties cannot contain arbitrary nested maps. Always parse via the local `parseNode()` pattern.
- **Python**: Use `async`/`await` for IO-bound work. Format with black.
- **Styling**: Tailwind CSS. The UI is dark-first, commonly using `bg-gray-950` and `text-gray-100`.
- **Frontend UX**: Conversational-first. `Ctrl+K` / `Cmd+K` opens the launcher/assistant entry point; `Ctrl+/` toggles the right-side chat panel.
- **Secrets**: Do not commit `.env` files.

## Environment Variables

| Variable | Used by | Description |
| --- | --- | --- |
| `NEO4J_URI` | API, Worker | Neo4j Bolt URI |
| `NEO4J_USER` | API, Worker | Neo4j username |
| `NEO4J_PASSWORD` | API, Worker | Neo4j password |
| `DATABASE_URL` | API, Worker | PostgreSQL connection string |
| `JWT_SECRET` | API | JWT signing secret |
| `WORKER_GRPC_HOST` | API | Worker gRPC target, for example `worker:50051` |
| `GRPC_PORT` | Worker | Worker gRPC server port |
| `NEXT_PUBLIC_API_URL` | Web | GraphQL endpoint URL |
| `PROVARA_URL` | API | Provara API endpoint for LLM routing |
| `PROVARA_API_KEY` | API | Provara API key |
| `PROVARA_TENANT_ID` | API | Optional Provara tenant ID |
| `PROVARA_MODEL` | API | Optional default Provara model/router name |
| `OPENAI_API_KEY` | API | Direct OpenAI fallback for chat |
| `OPENAI_MODEL` | API | Optional default direct OpenAI fallback model |
| `DISCOVERY_PROVARA_MODEL` | API | Optional Provara model/router override for Discovery transform drafting |
| `DISCOVERY_OPENAI_MODEL` | API | Optional direct OpenAI fallback model for Discovery transform drafting |
| `DISCOVERY_AI_TIMEOUT_MS` | API | Optional timeout for Discovery transform drafting |
| `PATHLIGHT_URL` | Worker | Optional Pathlight trace collector URL |
| `REDIS_URL` | API | Redis connection string for multi-instance pub/sub, default `redis://localhost:6379` |
| `UPLOAD_DIR` | API | Local discovery upload directory, default `./uploads` |

## Common Commands

- `pnpm install` — Install dependencies.
- `docker-compose up -d neo4j postgres` — Start local infrastructure.
- `pnpm --filter @specora/db seed` — Seed Neo4j with CSDMv5 schema and sample data.
- `pnpm dev` — Start all apps in development mode.
- `pnpm proto:generate` — Regenerate gRPC stubs from `.proto` files.

Known dev-server caveat: if the web dev server crashes under `turbo run dev`, start Next directly with `node ./node_modules/next/dist/bin/next dev` from the web app context.

## Specora Arc App Ecosystem

- Built-in apps live in `apps/web/src/apps/<id>/`.
- Built-in app registration is handled through the app container registry and SDK seeding paths.
- External apps load dynamically through ESM `import(/* webpackIgnore: true */ url)`.
- If dynamic import fails, the shell falls back to an iframe sandbox.
- `ShellAPI` is permission-filtered from the app manifest `permissions` array.
- Marketplace data uses the `marketplace_apps` PostgreSQL table.
- Admin users approve or reject submitted apps in the Arc app review flow.
- App manifests can declare `chatTools` and `events`; chat routes tool calls through the unified tool registry.

## Documentation Map

- `README.md` — Human-facing product overview and setup.
- `AGENTS.md` — This file; compact implementation context for agents.
- `ROADMAP.md` — Released work, next work, technical debt, and decisions.
- `CHANGELOG.md` — Release-level change history.
- `docs/README.md` — Canonical user and administrator documentation index.
- `docs-archive/llm-routing.md` — Current LLM routing, Provara behavior, and OpenAI fallback.
- `docs-archive/` — Archived engineering, architecture, operations, and research notes.
- `CLAUDE.md`, `CURSOR.md`, `README-KARPATHY.md`, `README.zh.md`, `EXAMPLES.md`, `skills/karpathy-guidelines/SKILL.md` — Imported coding-agent behavior guidance, not product architecture.
