# Specora

**AI-Native ITSM Platform**

Specora is an open-source, AI-first ITSM platform built to eventually displace legacy suites like ServiceNow. It treats AI agents and graph relationships as first-class citizens, with a conversational-first interface and a graph-native implementation of the CSDMv5 data model.

## Phase 1: The Kernel

Phase 1 establishes the graph-native CSDMv5 data layer, the API, the foundational GUI, and the event-processing worker.

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Monorepo** | pnpm workspaces + Turborepo |
| **API** | TypeScript, Fastify, GraphQL Yoga, neo4j-driver, grpc-js |
| **Web GUI** | Next.js 14 (App Router), React Flow, TanStack Query |
| **Worker** | Python 3.12, asyncio, grpcio, neo4j Python driver |
| **Graph DB** | Neo4j Community Edition |
| **Queue / Ops DB** | PostgreSQL 16 |
| **Inter-service** | gRPC + Protobuf |
| **Auth** | JWT (stateless) |
| **Local Dev** | Docker Compose |
| **Production** | Railway (Docker-based) |

## Directory Structure

```
specora2/
├── apps/
│   ├── api/                    # Fastify API Server
│   ├── web/                    # Next.js Frontend
│   └── worker/                 # Python gRPC Worker
├── packages/
│   ├── core/                   # Shared TS types, Zod schemas
│   ├── db/                     # Neo4j schema, migrations, seeders
│   ├── protobuf/               # .proto definitions + scripts
│   ├── tsconfig/               # Shared TS configs
│   └── eslint-config/          # Shared lint rules
├── docker-compose.yml
├── turbo.json
└── pnpm-workspace.yaml
```

## CSDMv5 Graph Schema (Phase 1 Subset)

### Node Labels
- `ConfigurationItem` (base)
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

### Relationship Types
- `PART_OF`
- `DEPENDS_ON`
- `HOSTED_ON`
- `MANAGED_BY`
- `OWNED_BY`
- `LOCATED_AT`

## Development

### Prerequisites
- Node.js >= 20
- pnpm >= 8
- Python 3.12
- Docker & Docker Compose

### Local Setup

```bash
# Install dependencies
pnpm install

# Start infrastructure (Neo4j + Postgres)
docker-compose up -d neo4j postgres

# Seed Neo4j schema and sample data
pnpm --filter @specora/db seed

# Start all apps in dev mode
pnpm dev
```

The API will be available at `http://localhost:4000/graphql` and the web UI at `http://localhost:3000`.

### Proto Generation

```bash
pnpm proto:generate
```

## Keyboard Shortcuts

- `Ctrl+K` / `Cmd+K` — Open Specora Assistant chat overlay from anywhere in the UI.

## License

AGPL-3.0

# Karpathy-Inspired Claude Code Guidelines

> Check out my new project [Multica](https://github.com/multica-ai/multica) — an open-source platform for running and managing coding agents with reusable skills.
>
> Follow me on X: [https://x.com/jiayuan_jy](https://x.com/jiayuan_jy)

A single `CLAUDE.md` file to improve Claude Code behavior, derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.

English | [简体中文](./README.zh.md)

## The Problems

From Andrej's post:

> "The models make wrong assumptions on your behalf and just run along with them without checking. They don't manage their confusion, don't seek clarifications, don't surface inconsistencies, don't present tradeoffs, don't push back when they should."

> "They really like to overcomplicate code and APIs, bloat abstractions, don't clean up dead code... implement a bloated construction over 1000 lines when 100 would do."

> "They still sometimes change/remove comments and code they don't sufficiently understand as side effects, even if orthogonal to the task."

## The Solution

Four principles in one file that directly address these issues:

| Principle | Addresses |
|-----------|-----------|
| **Think Before Coding** | Wrong assumptions, hidden confusion, missing tradeoffs |
| **Simplicity First** | Overcomplication, bloated abstractions |
| **Surgical Changes** | Orthogonal edits, touching code you shouldn't |
| **Goal-Driven Execution** | Leverage through tests-first, verifiable success criteria |

## The Four Principles in Detail

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

LLMs often pick an interpretation silently and run with it. This principle forces explicit reasoning:

- **State assumptions explicitly** — If uncertain, ask rather than guess
- **Present multiple interpretations** — Don't pick silently when ambiguity exists
- **Push back when warranted** — If a simpler approach exists, say so
- **Stop when confused** — Name what's unclear and ask for clarification

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

Combat the tendency toward overengineering:

- No features beyond what was asked
- No abstractions for single-use code
- No "flexibility" or "configurability" that wasn't requested
- No error handling for impossible scenarios
- If 200 lines could be 50, rewrite it

**The test:** Would a senior engineer say this is overcomplicated? If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting
- Don't refactor things that aren't broken
- Match existing style, even if you'd do it differently
- If you notice unrelated dead code, mention it — don't delete it

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused
- Don't remove pre-existing dead code unless asked

**The test:** Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform imperative tasks into verifiable goals:

| Instead of... | Transform to... |
|--------------|-----------------|
| "Add validation" | "Write tests for invalid inputs, then make them pass" |
| "Fix the bug" | "Write a test that reproduces it, then make it pass" |
| "Refactor X" | "Ensure tests pass before and after" |

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let the LLM loop independently. Weak criteria ("make it work") require constant clarification.

## Install

**Option A: Claude Code Plugin (recommended)**

From within Claude Code, first add the marketplace:
```
/plugin marketplace add forrestchang/andrej-karpathy-skills
```

Then install the plugin:
```
/plugin install andrej-karpathy-skills@karpathy-skills
```

This installs the guidelines as a Claude Code plugin, making the skill available across all your projects.

**Option B: CLAUDE.md (per-project)**

New project:
```bash
curl -o CLAUDE.md https://raw.githubusercontent.com/forrestchang/andrej-karpathy-skills/main/CLAUDE.md
```

Existing project (append):
```bash
echo "" >> CLAUDE.md
curl https://raw.githubusercontent.com/forrestchang/andrej-karpathy-skills/main/CLAUDE.md >> CLAUDE.md
```

## Using with Cursor

This repository includes a committed Cursor project rule ([`.cursor/rules/karpathy-guidelines.mdc`](.cursor/rules/karpathy-guidelines.mdc)) so the same guidelines apply when you open the project in Cursor. See **[CURSOR.md](CURSOR.md)** for setup, using the rule in other projects, and how this relates to Claude Code.

## Key Insight

From Andrej:

> "LLMs are exceptionally good at looping until they meet specific goals... Don't tell it what to do, give it success criteria and watch it go."

The "Goal-Driven Execution" principle captures this: transform imperative instructions into declarative goals with verification loops.

## How to Know It's Working

These guidelines are working if you see:

- **Fewer unnecessary changes in diffs** — Only requested changes appear
- **Fewer rewrites due to overcomplication** — Code is simple the first time
- **Clarifying questions come before implementation** — Not after mistakes
- **Clean, minimal PRs** — No drive-by refactoring or "improvements"

## Customization

These guidelines are designed to be merged with project-specific instructions. Add them to your existing `CLAUDE.md` or create a new one.

For project-specific rules, add sections like:

```markdown
## Project-Specific Guidelines

- Use TypeScript strict mode
- All API endpoints must have tests
- Follow the existing error handling patterns in `src/utils/errors.ts`
```

## Tradeoff Note

These guidelines bias toward **caution over speed**. For trivial tasks (simple typo fixes, obvious one-liners), use judgment — not every change needs the full rigor.

The goal is reducing costly mistakes on non-trivial work, not slowing down simple tasks.

## License

MIT

