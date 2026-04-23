# Provara Removal — Developer Direction

## What happened

We removed Provara as the LLM router for Specora chat. Provara's `/v1/chat/completions` endpoint does **not support the `tools` / `tool_choice` parameters**, which means AI tool calling (search_cis, get_ci_details, etc.) is completely broken when Provara is enabled.

The chat service falls back to **direct OpenAI calls** (`gpt-4o-mini`) when Provara is unavailable or disabled.

## Why this matters

Specora's conversational UI is useless without tool access. The assistant has no embedded knowledge of the CMDB — every answer about CIs, services, dependencies, or the service map requires calling a tool first. Without tool support, the LLM either hallucinates or refuses to answer.

## Current state

- `OPENAI_API_KEY` is the only working LLM backend for chat
- `PROVARA_URL` and `PROVARA_API_KEY` env vars are ignored by the chat service
- The `callProvara()` function still exists in `apps/api/src/services/chat.ts` but is unreachable

## Future enhancement directions

If we want to bring back model routing, here are the viable paths:

### Option A: Provara adds tool support (external dependency)

Wait for Provara to support OpenAI-compatible `tools` and `tool_choice` in its `/v1/chat/completions` proxy. Once available, re-enable the Provara path by checking for the feature at runtime (e.g., a capabilities endpoint or a feature flag).

**Effort:** Low code change, high external dependency risk.

### Option B: Self-hosted router with tool support (recommended)

Deploy a lightweight router (e.g., LiteLLM Proxy, OpenRouter, or a custom Fastify proxy) that:

1. Accepts OpenAI-compatible requests with `tools`/`tool_choice`
2. Routes to the appropriate backend (OpenAI, Anthropic, local Ollama, etc.)
3. Normalizes tool call responses across providers
4. Returns responses in the exact OpenAI chat completion format

**Implementation sketch:**
- Add `ROUTER_URL` / `ROUTER_API_KEY` env vars
- Replace `callProvara()` with `callRouter()` using the same fetch-based approach
- Ensure the router returns `choices[0].message.tool_calls` in the exact OpenAI shape

**Effort:** Medium. Requires deploying and maintaining the router service.

### Option C: Provider-native SDK fallback

Instead of a single router, implement per-provider SDK paths:

- **OpenAI:** `openai.chat.completions.create()` with native tool support (current working path)
- **Anthropic:** `anthropic.messages.create()` with `tool_use` blocks, then normalize to OpenAI format internally
- **Local/Ollama:** Ollama's `/api/chat` with `tools` parameter

The chat service would switch based on `MODEL_PROVIDER=openai|anthropic|ollama`.

**Effort:** High. Each provider has different tool call schemas, response shapes, and streaming behavior. Requires a normalization layer.

### Option D: Drop tool-based chat, embed CMDB knowledge (not recommended)

Fine-tune or RAG-ify the CMDB so the LLM has implicit knowledge. This removes the need for tool calls entirely.

**Why we are not doing this:** CMDB data changes constantly. Embedding snapshots go stale quickly. Fine-tuning is expensive and still hallucinates on edge cases. Tool calling is the correct architecture for a live CMDB.

## Decision

**Keep Option A as a placeholder, pursue Option B for the next sprint.**

- Do not invest in Option C unless we have a concrete multi-provider requirement.
- Monitor Provara for tool support; if they ship it, Option A is a one-line re-enable.
- Option B gives us full control, works today, and unlocks local model usage for air-gapped deployments.

## Action items

| # | Task | Owner | Priority |
|---|------|-------|----------|
| 1 | Document the current OpenAI-only limitation in the README | Any dev | Low |
| 2 | Spike LiteLLM Proxy or OpenRouter for tool-compatible routing | Backend | Medium |
| 3 | Add `ROUTER_URL` env var support behind a feature flag | Backend | Medium |
| 4 | Remove `callProvara()` dead code once a replacement is merged | Backend | Low |

## References

- OpenAI tool calling spec: https://platform.openai.com/docs/guides/function-calling
- LiteLLM Proxy docs: https://docs.litellm.ai/docs/simple_proxy
- Current chat service: `apps/api/src/services/chat.ts`
- Current chat route: `apps/api/src/routes/chat.ts`
