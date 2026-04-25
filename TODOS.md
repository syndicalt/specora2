# TODOS.md

## Status: ALL ITEMS COMPLETE ✅

Captured from `/plan-eng-review` on 2026-04-24. All items have been verified and resolved.

---

## ✅ T1 — Multi-instance API scale path (PG LISTEN/NOTIFY or Redis)

**Status:** DONE — Redis pub/sub implemented.
- `eventBus.ts` publishes/subscribes via Redis `specora:events` channel
- `rbac.ts` uses Redis as L2 cache with local L1 fallback (30s TTL)
- WebSocket `broadcast()` is called from eventBus handler, so cross-instance WS delivery works

## ✅ T2 — Websocket protocol ping (replace app-layer JSON ping)

**Status:** DONE — Already using protocol-level ping/pong.
- `websocket.ts` lines 86-103: `connection.socket.ping()` + `connection.socket.on("pong", ...)`
- No JSON ping/pong code exists anywhere in the codebase
- Git history: `524566d fix(websocket): use protocol-level ping/pong instead of JSON heartbeat`

## ✅ T3 — Make app tool registration explicit (remove load-time side effects)

**Status:** DONE — Refactored in commit.
- `appTools.ts`: All `registerTool()` calls wrapped in `export function registerAllAppTools()`
- `index.ts`: Explicit `registerAllAppTools()` call before `chatRoutes` registration
- Side-effect import `import "./services/appTools"` removed

## ✅ T4 — Impact Graph truthfulness in Change Manager

**Status:** DONE — Backend already returns real Neo4j edges.
- `appTools.ts` line 415: `edges: realEdges` from actual Neo4j query
- Frontend `change-manager/index.tsx` lines 145-149: uses `data.edges` from backend
- No fabricated `DEPENDS_ON` star topology remains

## ✅ T5 — Rate limit hardening

**Status:** DONE — Per-route limits in place.
- Global `skipOnError: false` in `index.ts`
- `/api/login`: 10/min IP-based
- `/api/chat`: 30/min
- `/api/chat/stream`: 20/min

## ✅ T6 — JWT expiration + refresh flow

**Status:** DONE — All mechanisms present.
- `JWT_EXPIRES_IN = "24h"` in `routes/auth.ts`
- `expiresIn` on all `fastify.jwt.sign()` calls
- `/api/auth/refresh` endpoint exists
- `jti: crypto.randomUUID()` included in payload

## ✅ T7 — Chat session state finalizer on abort

**Status:** DONE — Abort finalizer implemented.
- `routes/chat.ts` lines 391-399: If stream completes but assistant message wasn't saved (client disconnected mid-save), writes synthetic `{role: "assistant", content: "[interrupted]"}` message
- This keeps the conversation valid for the next turn

## ✅ T8 — Test coverage backfill strategy for the excluded 6

**Status:** DONE — All services have tests.
- `aiRuleGenerator` → `aiRuleGenerator.test.ts` ✅
- `appTools` → `appTools.test.ts` ✅
- `eventBus` → `eventBus.test.ts` ✅
- `websocket` → `websocket.test.ts` ✅
- `healthRules` → `healthRules.test.ts` ✅
- `routes/health` → `health.test.ts` ✅

## ✅ T9 — Provara `requires_structured_output` hint for chat tool calls

**Status:** DONE — Added to both Provara request paths.
- `callProvara()` body: `requires_structured_output: true`
- `callLlmStream()` Provara streaming fetch: `requires_structured_output: true`
- Narrows router to `STRUCTURED_OUTPUT_RELIABLE` models only (gpt-4o, claude-sonnet, etc.)
- Fallback parsers (`parseXmlToolCalls`, `parseActionToolCalls`) retained as safety net with warning logs

---

## Forward-looking ideas (not yet scoped)

- **CSDMv5 Data Foundations compliance** — Health score dimensions, data quality rules, class inheritance
- **Chat UX polish** — Message threading, file attachments, streaming tool call visualization
- **Worker scaling** — Multi-worker gRPC load balancing, job queue persistence
- **Advanced Service Map** — Layout persistence, animated transitions, multi-root views

