# Specora

Specora is an open-source, AI-native ITSM platform. It treats graph relationships, AI agents, and app-level automation as first-class parts of service management.

The platform centers on a graph-native CSDMv5 CMDB, a conversational workspace, and an extensible app ecosystem called Specora Arc.

## Current Platform

- **CMDB graph**: Neo4j-backed CSDMv5 subset with configuration items, ownership, dependency, hosting, and location relationships.
- **API**: TypeScript Fastify server with GraphQL Yoga for CSDMv5 CRUD, JWT auth, app tooling, chat, and marketplace operations.
- **Web app**: Next.js 14 App Router UI with React Flow service maps, CMDB Explorer, Discovery, Settings, Change Manager, Health Monitor, and Specora Arc.
- **Worker**: Python 3.12 asyncio gRPC service for ingestion and background jobs.
- **Ops data**: PostgreSQL for marketplace data, saved views, event persistence, queues, and change-management records.
- **AI layer**: Provara is the primary LLM router for chat and tool calls. OpenAI is retained as a direct fallback.

## Repository Layout

```text
specora2/
├── apps/
│   ├── api/        # Fastify, GraphQL Yoga, chat/tools, app APIs
│   ├── web/        # Next.js frontend and built-in Arc apps
│   └── worker/     # Python asyncio gRPC worker
├── packages/
│   ├── core/       # Shared TypeScript types and schemas
│   ├── db/         # Neo4j/PostgreSQL migrations and seeders
│   ├── protobuf/   # Protobuf definitions and generated gRPC stubs
│   ├── tsconfig/   # Shared TypeScript configs
│   └── eslint-config/
├── docs/           # Focused technical notes
├── AGENTS.md       # Primary coding-agent context
└── ROADMAP.md      # Released work, next work, and known debt
```

## Technology Stack

| Layer | Technology |
| --- | --- |
| Monorepo | pnpm workspaces, Turborepo |
| API | Node 20, TypeScript, Fastify, GraphQL Yoga, neo4j-driver, grpc-js |
| Web | Next.js 14 App Router, React, React Flow, TanStack Query, Tailwind CSS |
| Worker | Python 3.12, asyncio, grpcio, Neo4j Python driver |
| Graph database | Neo4j Community Edition |
| Queue / ops database | PostgreSQL 16 |
| Inter-service protocol | gRPC + Protobuf |
| Auth | Short-lived JWT access tokens, rotating refresh sessions, OAuth/SSO primitives |
| Local infrastructure | Docker Compose |

## CSDMv5 Graph Subset

Node labels:

- `ConfigurationItem`
- `BusinessService`
- `ApplicationService`
- `TechnicalService`
- `Server`
- `Database`
- `Application`
- `NetworkGear`
- `User`
- `Group`
- `Location`

Relationship types:

- `PART_OF`
- `DEPENDS_ON`
- `HOSTED_ON`
- `MANAGED_BY`
- `OWNED_BY`
- `LOCATED_AT`

The API validates relationship types against an allowlist. Cypher queries must be parameterized.

## Local Development

Prerequisites:

- Node.js 20+
- pnpm 8+
- Python 3.12
- Docker and Docker Compose

Setup:

```bash
pnpm install
docker-compose up -d neo4j postgres
pnpm --filter @specora/db seed
pnpm dev
```

Default endpoints:

- Web UI: `http://localhost:3000`
- GraphQL API: `http://localhost:4000/graphql`

Regenerate gRPC stubs:

```bash
pnpm proto:generate
```

## Environment

Core variables:

| Variable | Used by | Description |
| --- | --- | --- |
| `NEO4J_URI` | API, Worker | Neo4j Bolt URI |
| `NEO4J_USER` | API, Worker | Neo4j username |
| `NEO4J_PASSWORD` | API, Worker | Neo4j password |
| `DATABASE_URL` | Worker, API features backed by Postgres | PostgreSQL connection string |
| `JWT_SECRET` | API | JWT signing secret |
| `ACCESS_TOKEN_EXPIRES_IN` | API | Optional access-token lifetime, default `15m` |
| `ACCESS_TOKEN_EXPIRES_IN_SECONDS` | API | Optional browser-facing access-token lifetime in seconds, default `900` |
| `REFRESH_TOKEN_DAYS` | API | Optional refresh-session lifetime, default `30` |
| `AUTH_HANDOFF_TTL_SECONDS` | API | Optional OAuth/OIDC one-time handoff lifetime, default `90` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | API | Optional Google OAuth login provider |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | API | Optional GitHub OAuth login provider |
| `OAUTH_DEFAULT_ROLE` | API | Optional JIT-created OAuth user role, default `user` |
| `API_PUBLIC_URL` | API | Public API base URL used for OAuth callbacks |
| `WEB_PUBLIC_URL` | API | Public web base URL used after OAuth callbacks |
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
| `REDIS_URL` | API | Redis URL for multi-instance pub/sub, default `redis://localhost:6379` |
| `UPLOAD_DIR` | API | Discovery upload directory, default `./uploads` |

Do not commit `.env` files.

## Documentation Map

- [AGENTS.md](AGENTS.md) is the compact source of truth for coding agents.
- [ROADMAP.md](ROADMAP.md) tracks released capability, near-term work, technical debt, and decisions.
- [CHANGELOG.md](CHANGELOG.md) records release-level changes.
- [docs/README.md](docs/README.md) is the documentation index.
- [docs/platform-architecture-and-theory.md](docs/platform-architecture-and-theory.md) explains platform architecture and the theories behind major choices.
- [docs/csdmv5-compliance.md](docs/csdmv5-compliance.md) documents CSDMv5 alignment, implemented subset, and roadmap gaps.
- [docs/application-catalog.md](docs/application-catalog.md) catalogs the native applications and integration standards.
- [docs/platform-marking-sheet.md](docs/platform-marking-sheet.md) provides the platform and per-application marking sheet.
- [docs/database-performance-audit.md](docs/database-performance-audit.md) records database index coverage and enterprise storage guidance.
- [docs/llm-routing.md](docs/llm-routing.md) explains current chat model routing and tool-call behavior.
- [docs/seeding-e2e-and-coverage.md](docs/seeding-e2e-and-coverage.md) documents seed layers, current coverage, E2E direction, and testing lessons learned.
- [CLAUDE.md](CLAUDE.md), [CURSOR.md](CURSOR.md), [README-KARPATHY.md](README-KARPATHY.md), [README.zh.md](README.zh.md), [EXAMPLES.md](EXAMPLES.md), and [skills/karpathy-guidelines/SKILL.md](skills/karpathy-guidelines/SKILL.md) are imported coding-agent behavior guidelines, not Specora product architecture.

## User Experience Notes

- The UI is conversational-first.
- `Ctrl+K` / `Cmd+K` opens the app launcher or assistant entry point depending on workspace context.
- `Ctrl+/` toggles the right-side chat panel.
- Built-in apps are registered in the web app and seeded into the Arc registry.

## License

AGPL-3.0
