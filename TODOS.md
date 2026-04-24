# TODOS.md

Captured from `/plan-eng-review` on 2026-04-24 against the v0.4+v0.5 uncommitted blob on `main`.

Format per item:
- **What** — one-line description
- **Why** — concrete problem solved or value unlocked
- **Pros** — what you gain
- **Cons** — cost, complexity, or risks
- **Context** — current state + where to start (so future-you can pick this up cold)
- **Depends on / blocked by** — prerequisites or ordering

---

## T1 — Multi-instance API scale path (PG LISTEN/NOTIFY or Redis)

- **What:** Replace in-memory singletons (rbac cache, eventBus subscriptions, websocket connections) with a shared backplane so the API can run with `replicas: 2+`.
- **Why:** Current code binds each of those three concerns to a single Node process. Horizontal scale silently breaks pub/sub; one process crash = websocket drop for all connected clients. Cap on real-world load + zero redundancy.
- **Pros:** Unblocks horizontal scale; gains failover; unifies cache invalidation across instances.
- **Cons:** Adds infra (Redis) or complexity (pg LISTEN/NOTIFY 8KB payload limit + listener thread). Requires careful cutover to avoid dropped events mid-migration.
- **Context:** `apps/api/src/services/rbac.ts:7` (permissionCache), `apps/api/src/services/eventBus.ts:8` (subscriptions), `apps/api/src/services/websocket.ts` (connections). Chosen remediation in `/plan-eng-review` D3 was "document now, fix post-ship." PG LISTEN/NOTIFY preferred since PG is already in the stack.
- **Depends on:** T2 (outbox pattern) for event bus path; natural fit after outbox is in.

## T2 — Websocket protocol ping (replace app-layer JSON ping)

- **What:** Replace `JSON.stringify({type:"ping"})` sent over WS data frame with the WS-protocol ping (`socket.ping()` + `pong` event listener).
- **Why:** Current heartbeat requires client to send `{action:"pong"}`; no client in repo does. Every connection times out at 40s and closes with 1001.
- **Pros:** Heartbeat works without client cooperation; uses the protocol-level mechanism reverse proxies already understand; no wasted re-connects.
- **Cons:** Tiny behavioral change — clients that *did* send the JSON pong will no longer extend the timer that way (but nothing in repo does this).
- **Context:** `apps/api/src/services/websocket.ts:11, 82-84`. Flagged by outside voice (P2-14) in `/plan-eng-review` D18.
- **Depends on:** None.

## T3 — Make app tool registration explicit (remove load-time side effects)

- **What:** Replace `import "./appTools"` side-effect at `apps/api/src/services/chat.ts:6` with an explicit `registerAllAppTools(fastify)` call in `index.ts` before route registration.
- **Why:** Current registration happens at module load; any import path that touches `@specora/sdk` before `chatRoutes` is registered sees an empty tool registry. Untested.
- **Pros:** Deterministic ordering; testable; readable — `index.ts` shows every side effect.
- **Cons:** Small refactor across 3-4 files; need to thread `fastify` into `appTools.ts` (already done via arg in most places).
- **Context:** `apps/api/src/services/chat.ts:6`, `apps/api/src/services/appTools.ts`. Flagged by outside voice (P2-15).
- **Depends on:** Lands cleanly after D9 (appTools.ts split into per-app files).

## T4 — Impact Graph truthfulness in Change Manager

- **What:** Either query Neo4j for real relationships to power the "Impact Graph (3 hops)" panel, or rename the panel to "Affected CIs" and drop the fabricated graph.
- **Why:** `apps/web/src/apps/change-manager/index.tsx:141-149` fabricates a star topology of `DEPENDS_ON` edges from the primary CI to each affected CI. Those relationships may not exist in the real CMDB.
- **Pros:** Approvers currently make decisions based on a fiction; fixing this restores meaningful impact analysis.
- **Cons:** Proper 3-hop query needs a GraphQL endpoint addition + UI loading state. "Real impact analysis" was already on the v0.6 ROADMAP — this is the motivating use case.
- **Context:** Flagged by outside voice (P2-16). Related to v0.6 roadmap item "Impact analysis — Blast radius calculation before changes."
- **Depends on:** None — can ship the rename today, full fix lands with v0.6 impact analysis.

## T5 — Rate limit hardening

- **What:** Set `skipOnError: false` on the global `@fastify/rate-limit`; add per-route tighter caps for `/api/chat/stream` and `/api/chat` (they call billed LLM APIs); add IP-based outer limit on `/api/auth/login`.
- **Why:** `skipOnError: true` means a rate-limit store error bypasses all limits silently. No special cap on chat endpoints means one compromised token can rack up LLM spend at the global rate (100/min).
- **Pros:** Caps spend on a per-user basis; brute-force protection on login; fails closed on limit-store outage.
- **Cons:** Per-route bucket config + possible Redis dependency (already implied by T1).
- **Context:** `apps/api/src/index.ts:34-38`. Flagged by outside voice (P2-17).
- **Depends on:** T1 (shared limit store) for multi-instance correctness; works single-instance today without it.

## T6 — JWT expiration + refresh flow

- **What:** Add `expiresIn: "24h"` to `fastify.jwt.sign()` calls in `apps/api/src/routes/auth.ts:25, 60`. Add a `/api/auth/refresh` endpoint. Include `jti` (JWT ID) claim for future revocation.
- **Why:** Tokens currently have no expiration. A leaked token is valid until `JWT_SECRET` rotates. Role changes in the DB don't take effect until user re-logs in.
- **Pros:** Standard security posture; combines with D6 (30s RBAC cache TTL) to bound staleness at 24h worst case; enables future server-side revocation via `jti` denylist.
- **Cons:** Requires a refresh flow or users re-log daily. Breaking change for any stored long-lived tokens (mitigated: force re-login on release).
- **Context:** `apps/api/src/routes/auth.ts`. Flagged by outside voice (P2-18). Related to D6 (RBAC cache TTL) and D7 (required role in JWT).
- **Depends on:** Natural fit with D7 (required role in JWT type).

## T7 — Chat session state finalizer on abort

- **What:** When chat SSE is aborted between tool-result persist and final assistant turn, write a synthetic `{role: "assistant", content: "[interrupted]"}` message so the stored conversation is valid for the next turn.
- **Why:** Currently, on abort (user closes tab mid-stream), the session can be left with `assistant+tool_calls` followed by `tool` messages but no closing assistant turn. OpenAI rejects the next turn because the conversation is in an invalid state.
- **Pros:** Session always resumable; no "chat is broken" UX on reload.
- **Cons:** Requires wiring `AbortController.onabort` through the chat stream handler (related to D18 SSE keep-alive work).
- **Context:** `apps/api/src/services/chat.ts:763-768`. Flagged by outside voice (P3-20).
- **Depends on:** SSE abort-handling work (part of P1-8 in D18 required action list).

## T8 — Test coverage backfill strategy for the excluded 6

- **What:** Track the 6 services currently excluded from `vitest.config.ts` (aiRuleGenerator, appTools, eventBus, websocket, healthRules, routes/health). D8 chose to write tests for all 6 pre-ship; if any slip, they move here.
- **Why:** Explicit capture so nothing silently regresses back into the exclude list.
- **Pros:** Observable commitment; prevents exclusion-drift.
- **Cons:** None; it's a checkbox list.
- **Context:** `apps/api/vitest.config.ts:12`. `/plan-eng-review` D8 chose option A (restore 100/95 thresholds + write all 6 now).
- **Depends on:** None.

---

Each entry ends in a commit that removes it from this file.
