# Specora App Ecosystem Architecture Review

**Date:** 2026-04-25
**Scope:** Frontend app registration, ShellAPI, cross-app communication, external app loading, API tool registration, modularity gaps
**Status:** Post-review — recommendations documented, fixes pending prioritization

---

## 1. Executive Summary

The Specora Arc app ecosystem has a solid foundation: IndexedDB client registry, permission-filtered ShellAPI, in-memory message bus, WebSocket+Redis server event bus, and chat tool registration. However, several architectural gaps prevent it from being truly pluggable and modular. The most critical issues are: (a) built-in apps are hardcoded as static imports defeating dynamic loading, (b) external apps have no access to GraphQL or auth, (c) iframe sandbox is completely isolated with no integration bridge, (d) API tool registration is a 1,445-line monolith with no lazy loading or cleanup.

---

## 2. What's Working Well

### 2.1 Built-in App Registry
- `apps/web/src/sdk/index.ts:seedBuiltInApps()` writes 11 built-in app records to IndexedDB (`specora_platform` / `specora_apps`).
- Each record carries `id`, `name`, `permissions`, `chatTools`, `chatCapabilities`, `events`, `adminPanels`.
- Registry controls visibility and capability gating at runtime.

### 2.2 Permission-Filtered ShellAPI
- `apps/web/src/shell/AppContainers.tsx:buildShellAPI()` filters capabilities based on the app's declared `permissions` array.
- `PERMISSION_CAPABILITIES` maps permission strings to ShellAPI method grants.
- Role-based app filtering via `filterRegistryByRole()`.

### 2.3 Cross-App Messaging
- In-memory `messageBus` in `AppShell.tsx` supports pub/sub.
- `sendMessage(msg)` / `onMessage(handler)` enables app-to-app direct messaging (`to: "app-id"`) and broadcast (`to: "*"`).
- Used in production: CMDB Explorer sends `SET_ROOT_CI` to Service Map.

### 2.4 Server-Side Event Bus
- `apps/api/src/services/eventBus.ts`: Redis pub/sub for cross-instance delivery.
- `apps/web/src/hooks/useEventStream.ts`: WebSocket connection with REST fallback polling.
- Events observed: `ci.created`, `ci.updated`, `ci.deleted`, `relationship.*`, `rfc.*`, `discovery.completed`.

### 2.5 Chat Tool Registration
- `packages/sdk/src/chatRegistry.ts`: `registerTool(appId, toolDef, handler)`.
- `apps/api/src/services/chat.ts:getAllTools()` merges core + app tools for LLM context.
- `apps/api/src/routes/appTools.ts`: REST endpoints for tool listing and execution.

---

## 3. Critical Findings

### 3.1 Built-in Apps Are NOT Dynamically Loaded (Severity: High)

**Location:** `apps/web/src/shell/AppContainers.tsx:8-32`

```tsx
import ServiceMapApp from "@/apps/service-map";
import CMDBExplorerApp from "@/apps/cmdb-explorer";
// ... 9 more static imports

const BUILT_IN_COMPONENTS: Record<string, React.ComponentType<{ shell: ShellAPI }>> = {
  "service-map": ServiceMapApp,
  "cmdb-explorer": CMDBExplorerApp,
  // ...
};
```

**Impact:**
- You cannot add a built-in app without modifying `AppContainers.tsx` and rebuilding the web bundle.
- Every built-in app is included in the main JS bundle regardless of whether the user installs it.
- Dead code elimination is defeated.
- The IndexedDB registry controls visibility but not code loading.

**Recommendation:** Implement dynamic imports for built-in apps:
```tsx
const BUILT_IN_COMPONENTS: Record<string, () => Promise<any>> = {
  "service-map": () => import("@/apps/service-map"),
  // ...
};
```
This enables true code splitting and lazy loading.

---

### 3.2 External ESM Apps Cannot Access GraphQL or Auth (Severity: High)

**Location:** Multiple built-in apps import directly:
```tsx
// apps/web/src/apps/service-map/index.tsx:17
import { graphqlClient } from "@/lib/api";
// apps/web/src/apps/discovery/index.tsx:4
import { graphqlClient } from "@/lib/api";
```

**Impact:**
- External ESM apps loaded via `import(/* webpackIgnore: true */ url)` cannot resolve `@/lib/api` because it lives inside the shell's webpack bundle, not the external app's.
- External apps must bring their own GraphQL client and re-implement JWT auth header injection.
- This creates a two-tier ecosystem where built-in apps have full capabilities but external apps are second-class.

**Recommendation:** Add to ShellAPI:
```ts
interface ShellAPI {
  // ... existing methods
  query: (query: string, variables?: Record<string, unknown>) => Promise<any>;
  mutate: (mutation: string, variables?: Record<string, unknown>) => Promise<any>;
  fetch: (path: string, init?: RequestInit) => Promise<Response>; // shell-injected auth headers
}
```
The shell's `query`/`mutate` wrappers would inject the auth token and target the correct API endpoint.

---

### 3.3 Iframe Sandbox Is Completely Isolated (Severity: High)

**Location:** `apps/web/src/shell/AppContainers.tsx:184-193`

```tsx
if (useIframe && entry.url) {
  return (
    <iframe src={entry.url} className="w-full h-full border-0" title={entry.name} allow="clipboard-read; clipboard-write" />
  );
}
```

**Impact:**
- No `postMessage` protocol exists anywhere in the codebase (grep for `postMessage`, `window.parent`, `window.top` returned zero matches in `apps/web/src`).
- Iframe apps cannot: receive ShellAPI, send/receive cross-app messages, subscribe to server events, access auth tokens, or call GraphQL.
- The iframe fallback is a non-functional integration path.

**Recommendation:** Implement a `postMessage` bridge:
1. Shell wraps iframe in a component that listens for `message` events.
2. Iframe app loads a tiny SDK (`specora-iframe-sdk.js`) that proxies `ShellAPI` calls via `window.parent.postMessage`.
3. Shell validates origin against app's registered URL.
4. Supported methods: `sendMessage`, `onMessage`, `notify`, `query`, `eventBus.subscribe`.

This is a significant feature requiring its own design doc.

---

### 3.4 API Tool Registration Is a Monolith (Severity: Medium)

**Location:** `apps/api/src/services/appTools.ts` (1,445 lines)

**Impact:**
- All ~35 tool handlers for Change Manager, Discovery Insights, and Health Monitor live in one file.
- The API loads every handler at startup via `registerAllAppTools()`.
- No lazy loading — even if a user never uses Change Manager, its tool handlers are in memory.
- `unregisterAppTools(appId)` exists in `@specora/sdk` but is never called when an app is uninstalled.
- In a long-running Node process, tools accumulate forever.

**Recommendation:**
1. Split `appTools.ts` into per-app files: `apps/api/src/app-tools/change-manager.ts`, `discovery-insights.ts`, `health-monitor.ts`.
2. Each file exports a `register()` function.
3. `registerAllAppTools()` iterates over installed apps and calls only the relevant `register()` functions.
4. On app uninstall, call `unregisterAppTools(appId)`.
5. In the future, load tool handlers lazily (e.g., first time a tool is invoked).

---

### 3.5 Chat Sees Tools for Uninstalled Apps (Severity: Medium)

**Location:** `packages/sdk/src/chatRegistry.ts`

```ts
export function getToolsForSession(_userId: string): ChatToolDefinition[] {
  // TODO: Filter by user's installed apps
  return Array.from(toolDefinitions.values());
}
```

**Impact:**
- The LLM receives tool definitions for apps the user may not have installed.
- If the LLM invokes an uninstalled app's tool, the API returns 403.
- The LLM wastes a turn and may hallucinate workarounds.

**Recommendation:**
1. Track installed apps per user (already in IndexedDB on client, needs server-side tracking).
2. Filter `getToolsForSession(userId)` by installed app IDs.
3. Alternatively, filter at the API level in `getAllTools()` by checking user permissions per tool.

---

### 3.6 Cross-App Direct Imports Violate Modularity (Severity: Medium)

**Location:** `apps/web/src/apps/admin-console/index.tsx:6`

```tsx
import ChangeStateMachinePanel from "@/apps/change-manager/StateMachinePanel";
```

**Impact:**
- Admin Console cannot function without Change Manager's internal component tree.
- If Change Manager is uninstalled or refactored, Admin Console breaks.
- This pattern could spread.

**Recommendation:**
- Move shared components to `apps/web/src/components/` or `apps/web/src/shared/`.
- Alternatively, expose reusable panels through the ShellAPI as renderable components (complex).
- Short-term: move `StateMachinePanel` to a shared location.

---

### 3.7 Permission Inversion in Capability Map (Severity: Low)

**Location:** `apps/web/src/shell/AppContainers.tsx:65-78`

```ts
const PERMISSION_CAPABILITIES: Record<string, string[]> = {
  "read:cmdb": ["sendMessage", "onMessage", "notify", "dispatch"],
  "write:cmdb": ["sendMessage", "onMessage", "notify"], // NOTE: lacks dispatch
  // ...
};
```

**Impact:**
- `read:cmdb` grants `dispatch`, but `write:cmdb` does not.
- This is likely accidental and could confuse capability debugging.

**Recommendation:** Add `dispatch` to `write:cmdb` (or remove it from `read:cmdb` if it shouldn't be there).

---

### 3.8 `admin:cmdb` Permission Not in Role Map (Severity: Low)

**Location:** `apps/web/src/shell/AppContainers.tsx:112-121`

The `admin` role's `ROLE_PERMISSIONS` does not include `admin:cmdb`, which is the permission declared by `ci-class-manager` in its manifest. This means even admin users may not see the CI Class Manager app if role filtering is strict.

**Recommendation:** Add `admin:cmdb` to `ROLE_PERMISSIONS.admin`.

---

## 4. Target Architecture Options

### Option A — True Plugin Architecture (Ambitious)
- Built-in and external apps load identically via dynamic ESM import.
- ShellAPI exposes `query`, `mutate`, `fetch`, `token`.
- Iframe apps get full `postMessage` bridge.
- API tool handlers load lazily per app.
- Each app is an independent package with its own build.

### Option B — Pragmatic Cleanup (Recommended)
- Keep built-in apps co-located (they share the monorepo anyway).
- Add `query`/`mutate`/`fetch` to ShellAPI for external app support.
- Add minimal `postMessage` bridge for iframe apps (phase 2).
- Split `appTools.ts` into per-app files with explicit registration.
- Filter `getToolsForSession()` by installed apps + permissions.
- Fix permission inversion and missing `admin:cmdb`.

### Option C — Incremental
- Address only the High-severity items first (3.1, 3.2, 3.3).
- Defer iframe bridge and tool monolith split to v0.8.

---

## 5. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-25 | `registerAllAppTools()` wrapper created | Eliminates import-order side-effect dependency |
| 2026-04-25 | Provara `requires_structured_output` added | Guarantees structured-output-capable models |
| 2026-04-25 | T1-T8 verified as already implemented | Redis pub/sub, WS ping, JWT refresh, abort finalizer, tests all present |

---

## 6. Appendix: File Inventory

| File | Role | Lines |
|------|------|-------|
| `apps/web/src/sdk/index.ts` | Client-side IndexedDB registry, `seedBuiltInApps()` | 477 |
| `apps/web/src/sdk/types.ts` | `ShellAPI`, `AppMessage`, `RegistryEntry` types | 95 |
| `apps/web/src/shell/AppContainers.tsx` | Component loader, `BUILT_IN_COMPONENTS`, `buildShellAPI()` | 240 |
| `apps/web/src/shell/AppShell.tsx` | Message bus, dock, window manager | 200 |
| `apps/web/src/hooks/useEventStream.ts` | WebSocket + REST event subscription | 80 |
| `apps/api/src/services/appTools.ts` | All app tool registrations (monolith) | 1445 |
| `apps/api/src/routes/appTools.ts` | REST endpoints for tool listing/execution | 60 |
| `packages/sdk/src/chatRegistry.ts` | `registerTool`, `getToolsForSession` | 50 |
| `apps/api/src/services/eventBus.ts` | Redis-backed pub/sub + REST endpoints | 133 |
| `apps/api/src/services/websocket.ts` | WebSocket server with protocol ping | 130 |
