# LLM Routing

Specora chat uses tool calls to answer questions about the live CMDB, service map, change requests, health findings, discovery data, and app-specific workflows. The model should call tools rather than rely on embedded knowledge for operational facts.

## Current State

- **Primary router**: Provara.
- **Tool support**: Provara now supports OpenAI-compatible tool calls, so Specora has switched back to Provara for normal chat/tool orchestration.
- **Fallback**: Direct OpenAI remains available as a fallback when Provara is not configured or unavailable.
- **Reasoning boundary**: The assistant does not have durable knowledge of the CMDB. It must use registered tools for live data.

## Required Configuration

Primary Provara routing:

| Variable | Description |
| --- | --- |
| `PROVARA_URL` | Provara API endpoint |
| `PROVARA_API_KEY` | Provara API key |
| `PROVARA_TENANT_ID` | Optional tenant identifier for multi-tenant Provara deployments |

Fallback OpenAI routing:

| Variable | Description |
| --- | --- |
| `OPENAI_API_KEY` | Direct OpenAI key used when Provara is unavailable or disabled |

## Tool-Call Contract

The chat service expects an OpenAI-compatible chat-completions shape for tools:

- Request messages include a `tools` array and `tool_choice` when applicable.
- Model responses may include `choices[0].message.tool_calls`.
- Tool calls include a stable tool name and JSON arguments.
- Tool results are appended to the conversation before the final assistant response.

Any future router must preserve this contract, even if it adapts provider-native schemas internally.

## Tool Sources

Tool definitions come from two places:

- **Core platform tools** for CMDB search, CI details, relationships, service maps, health checks, and change-management operations.
- **App tools** declared by Specora Arc app manifests through `chatTools`.

The unified registry exposes the tool list to chat and routes tool invocations to the correct handler.

## Operational Notes

- Prefer Provara for normal deployments because it centralizes model routing.
- Keep OpenAI fallback working so local development and degraded routing states remain usable.
- Do not remove tool calling or replace it with static embeddings. CMDB data changes frequently, and stale embedded knowledge is not acceptable for ITSM workflows.
- If Provara behavior changes, update this file and `AGENTS.md` in the same change.
