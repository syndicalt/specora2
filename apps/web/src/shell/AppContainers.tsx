"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { RefObject } from "react";
import type { AppInstance } from "./AppContext";
import type { RegistryEntry, ShellAPI } from "@/sdk/types";
import { useShell } from "./AppContext";
import { authFetch, getUserRole } from "@/lib/auth";
import { API_BASE, graphqlClient } from "@/lib/api";
const BUILT_IN_COMPONENTS: Record<string, () => Promise<{ default: React.ComponentType<{ shell: ShellAPI }> }>> = {
  "service-map": () => import("@/apps/service-map"),
  "cmdb-explorer": () => import("@/apps/cmdb-explorer"),
  "settings": () => import("@/apps/settings"),
  "discovery": () => import("@/apps/discovery"),
  "arc": () => import("@/apps/arc"),
  "change-manager": () => import("@/apps/change-manager"),
  "incident-manager": () => import("@/apps/incident-manager"),
  "knowledge-core": () => import("@/apps/knowledge-core"),
  "prevention-center": () => import("@/apps/prevention-center"),
  "asset-command": () => import("@/apps/asset-command"),
  "customer-portal": () => import("@/apps/customer-portal"),
  "engage-agent-workspace": () => import("@/apps/engage-agent-workspace"),
  "discovery-insights": () => import("@/apps/discovery-insights"),
  "health-monitor": () => import("@/apps/health-monitor"),
  "it-visibility-dcim": () => import("@/apps/it-visibility-dcim"),
  "audit-log": () => import("@/apps/audit-log"),
  "reporting": () => import("@/apps/reporting"),
  "admin-console": () => import("@/apps/admin-console"),
  "ci-class-manager": () => import("@/apps/ci-class-manager"),
  "tables": () => import("@/apps/tables"),
  "data-foundations": () => import("@/apps/data-foundations"),
  "hello-world": () => import("@/apps/hello-world"),
};

const externalCache = new Map<string, React.ComponentType<{ shell: ShellAPI }>>();
const builtInCache = new Map<string, React.ComponentType<{ shell: ShellAPI }>>();
const DOCK_INSET_CLASS = "specora-dock-inset-target";

function useDockSafeScrollContainers(rootRef: RefObject<HTMLDivElement>, enabled: boolean) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;

    let frame = 0;
    const marked = new Set<HTMLElement>();

    const isScrollable = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      return /auto|scroll|overlay/.test(style.overflowY) && element.clientHeight > 0;
    };

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const dockInset = parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue("--specora-dock-safe-area")) || 112;
        const bottomThreshold = window.innerHeight - dockInset + 8;
        const candidates = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
        const next = new Set<HTMLElement>();

        for (const element of candidates) {
          if (!isScrollable(element)) continue;
          const rect = element.getBoundingClientRect();
          if (rect.height < 96 || rect.bottom < bottomThreshold) continue;
          next.add(element);
          if (!element.dataset.specoraOriginalBottomPadding) {
            element.dataset.specoraOriginalBottomPadding = window.getComputedStyle(element).paddingBottom || "0px";
            element.style.setProperty("--specora-original-bottom-padding", element.dataset.specoraOriginalBottomPadding);
          }
          element.classList.add(DOCK_INSET_CLASS);
        }

        for (const element of marked) {
          if (!next.has(element)) element.classList.remove(DOCK_INSET_CLASS);
        }
        marked.clear();
        next.forEach((element) => marked.add(element));
      });
    };

    update();
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    resizeObserver?.observe(root);
    window.addEventListener("resize", update);
    window.addEventListener("specora:dock-safe-area-change", update);

    return () => {
      cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("specora:dock-safe-area-change", update);
      marked.forEach((element) => element.classList.remove(DOCK_INSET_CLASS));
    };
  }, [rootRef, enabled]);
}

function satisfiesReactVersion(required: string): boolean {
  const requiredMajor = required.match(/\^?(\d+)/)?.[1];
  const currentMajor = "18";
  return !requiredMajor || requiredMajor === currentMajor;
}

async function loadExternalComponent(entry: RegistryEntry): Promise<React.ComponentType<{ shell: ShellAPI }> | null> {
  if (!entry.url) return null;
  if (externalCache.has(entry.id)) return externalCache.get(entry.id)!;

  if (entry.reactVersion && !satisfiesReactVersion(entry.reactVersion)) {
    console.warn(`App ${entry.id} targets React ${entry.reactVersion}, shell is on ^18.0.0`);
  }

  try {
    const mod = await import(/* webpackIgnore: true */ entry.url);
    const component = mod.default;
    if (!component) {
      console.error(`App ${entry.id} has no default export`);
      return null;
    }
    externalCache.set(entry.id, component);
    return component;
  } catch (err) {
    console.error(`Failed to load app ${entry.id} from ${entry.url}:`, err);
    return null;
  }
}

const PERMISSION_CAPABILITIES: Record<string, string[]> = {
  "read:cmdb": ["sendMessage", "onMessage", "notify", "dispatch", "query", "fetch"],
  "write:cmdb": ["sendMessage", "onMessage", "notify", "dispatch", "query", "mutate", "fetch"],
  "read:relationships": ["sendMessage", "onMessage", "notify", "query", "fetch"],
  "write:relationships": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "read:discovery": ["sendMessage", "onMessage", "notify", "query", "fetch"],
  "write:discovery": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "read:profile": ["sendMessage", "onMessage", "notify", "query", "fetch"],
  "write:profile": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "read:chat": ["sendMessage", "onMessage", "notify", "fetch", "runChatPrompt"],
  "itsm:change:read": ["sendMessage", "onMessage", "notify", "query", "fetch", "runChatPrompt"],
  "itsm:change:write": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch", "runChatPrompt"],
  "itsm:incident:read": ["sendMessage", "onMessage", "notify", "query", "fetch"],
  "itsm:incident:write": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "itsm:incident:remediate": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "itsm:knowledge:read": ["sendMessage", "onMessage", "notify", "query", "fetch"],
  "itsm:knowledge:write": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "itsm:knowledge:govern": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "itsm:prevention:read": ["sendMessage", "onMessage", "notify", "query", "fetch"],
  "itsm:prevention:write": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "itsm:prevention:govern": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "itsm:asset:read": ["sendMessage", "onMessage", "notify", "query", "fetch"],
  "itsm:asset:write": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "itsm:asset:govern": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "itsm:discovery:read": ["sendMessage", "onMessage", "notify", "query", "fetch"],
  "itsm:health:read": ["sendMessage", "onMessage", "notify", "query", "fetch"],
  "itsm:health:write": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "it-visibility:read": ["sendMessage", "onMessage", "notify", "query", "fetch"],
  "it-visibility:write": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "it-visibility:operate": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "audit-log:read": ["sendMessage", "onMessage", "notify", "query", "fetch"],
  "reporting:read": ["sendMessage", "onMessage", "notify", "fetch"],
  "reporting:write": ["sendMessage", "onMessage", "notify", "fetch"],
  "rbac:read": ["sendMessage", "onMessage", "notify", "dispatch", "fetch"],
  "rbac:write": ["sendMessage", "onMessage", "notify", "dispatch", "fetch"],
  "number-sequences:read": ["sendMessage", "onMessage", "notify", "dispatch", "fetch"],
  "number-sequences:write": ["sendMessage", "onMessage", "notify", "dispatch", "fetch"],
  "system-properties:read": ["sendMessage", "onMessage", "notify", "dispatch", "fetch"],
  "system-properties:write": ["sendMessage", "onMessage", "notify", "dispatch", "fetch"],
  "admin:cmdb": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "tables:read": ["sendMessage", "onMessage", "notify", "query", "fetch"],
  "tables:write": ["sendMessage", "onMessage", "notify", "query", "mutate", "fetch"],
  "data-foundations:read": ["sendMessage", "onMessage", "notify", "dispatch", "fetch"],
  "data-foundations:write": ["sendMessage", "onMessage", "notify", "dispatch", "fetch"],
  "customer-portal:read": ["sendMessage", "onMessage", "notify", "dispatch", "fetch"],
  "customer-portal:write": ["sendMessage", "onMessage", "notify", "dispatch", "fetch"],
  "engage:agent:read": ["sendMessage", "onMessage", "notify", "dispatch", "fetch"],
  "engage:agent:write": ["sendMessage", "onMessage", "notify", "dispatch", "fetch"],
};

const ROLE_PERMISSIONS: Record<string, string[]> = {
  viewer: [
    "read:cmdb", "read:relationships", "read:discovery",
    "itsm:change:read", "itsm:incident:read", "itsm:knowledge:read", "itsm:prevention:read", "itsm:asset:read", "itsm:discovery:read", "itsm:health:read",
    "audit-log:read", "read:profile", "write:profile", "read:chat",
    "reporting:read", "tables:read", "data-foundations:read", "customer-portal:read", "customer-portal:write", "engage:agent:read"
  ],
  operator: [
    "read:cmdb", "write:cmdb", "read:relationships", "write:relationships",
    "read:discovery", "write:discovery",
    "itsm:change:read", "itsm:change:write",
    "itsm:incident:read", "itsm:incident:write", "itsm:incident:remediate",
    "itsm:knowledge:read", "itsm:knowledge:write",
    "itsm:prevention:read", "itsm:prevention:write",
    "itsm:asset:read", "itsm:asset:write",
    "itsm:discovery:read",
    "itsm:health:read", "itsm:health:write",
    "it-visibility:read",
    "audit-log:read", "read:profile", "write:profile", "read:chat",
    "reporting:read", "reporting:write", "tables:read", "tables:write", "data-foundations:read", "customer-portal:read", "customer-portal:write", "engage:agent:read", "engage:agent:write"
  ],
  admin: [
    "read:cmdb", "write:cmdb", "read:relationships", "write:relationships",
    "read:discovery", "write:discovery",
    "itsm:change:read", "itsm:change:write",
    "itsm:incident:read", "itsm:incident:write", "itsm:incident:remediate",
    "itsm:knowledge:read", "itsm:knowledge:write", "itsm:knowledge:govern",
    "itsm:prevention:read", "itsm:prevention:write", "itsm:prevention:govern",
    "itsm:asset:read", "itsm:asset:write", "itsm:asset:govern",
    "itsm:discovery:read",
    "itsm:health:read", "itsm:health:write",
    "it-visibility:read", "it-visibility:write", "it-visibility:operate",
    "audit-log:read", "read:profile", "write:profile", "read:chat",
    "app:install", "app:uninstall", "admin:cmdb",
    "number-sequences:read", "number-sequences:write",
    "reporting:read", "reporting:write", "tables:read", "tables:write", "data-foundations:read", "data-foundations:write", "customer-portal:read", "customer-portal:write", "engage:agent:read", "engage:agent:write"
  ],
  security_admin: [
    "rbac:read", "rbac:write",
    "number-sequences:read", "number-sequences:write",
    "system-properties:read", "system-properties:write",
    "audit-log:read",
    "app:install", "app:uninstall",
    "read:profile", "write:profile", "read:chat",
    "itsm:incident:read", "itsm:incident:write", "itsm:incident:remediate",
    "itsm:knowledge:read", "itsm:knowledge:write", "itsm:knowledge:govern",
    "itsm:prevention:read", "itsm:prevention:write", "itsm:prevention:govern",
    "itsm:asset:read", "itsm:asset:write", "itsm:asset:govern",
    "it-visibility:read", "it-visibility:write", "it-visibility:operate",
    "reporting:read", "reporting:write", "tables:read", "tables:write", "data-foundations:read", "data-foundations:write", "customer-portal:read", "customer-portal:write", "engage:agent:read", "engage:agent:write"
  ],
};

export function filterRegistryByRole(registry: RegistryEntry[], role: string | null): RegistryEntry[] {
  if (!role || role === "admin" || role === "security_admin") return registry;
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) {
    console.warn(`[filterRegistryByRole] Unknown role "${role}" — showing all apps as fallback`);
    return registry;
  }
  const allowed = new Set(perms);
  return registry.filter((entry) => entry.permissions.some((p) => allowed.has(p)));
}

function buildShellAPI(
  instance: AppInstance,
  dispatch: React.Dispatch<any>,
  bus: { publish: (m: any) => void; subscribe: (h: any) => () => void },
  eventBus: { subscribe: (type: string, handler: any) => () => void; connected: boolean }
): ShellAPI {
  const allowed = new Set(
    (instance.permissions || []).flatMap((p) => PERMISSION_CAPABILITIES[p] || [])
  );

  return {
    installKey: instance.installKey,
    appId: instance.id,
    isActive: instance.state === "active",
    isDormant: instance.state === "dormant",
    launchPayload: instance.launchPayload,
    sendMessage: allowed.has("sendMessage")
      ? (msg) => bus.publish({ from: instance.installKey, ...msg })
      : () => console.warn(`App ${instance.id} lacks permission to send messages`),
    onMessage: (handler) => bus.subscribe((m: any) => {
      if (m.to === instance.installKey || m.to === instance.id || m.to === "*") handler(m);
    }),
    notify: allowed.has("notify")
      ? (message, type = "info") => {
          dispatch({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message, type } });
        }
      : () => {},
    runChatPrompt: allowed.has("runChatPrompt")
      ? (prompt, options = {}) => {
          dispatch({ type: "SET_RIGHT_PANEL_OPEN", open: true });
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent("specora:chat-prefill", {
              detail: { prompt, autoSend: options.autoSend === true },
            }));
          }, 80);
        }
      : () => console.warn(`App ${instance.id} lacks permission to run chat prompts`),
    query: allowed.has("query")
      ? (query, variables) => graphqlClient.request(query, variables)
      : () => Promise.reject(new Error(`App ${instance.id} lacks permission to query GraphQL`)),
    mutate: allowed.has("mutate")
      ? (mutation, variables) => graphqlClient.request(mutation, variables)
      : () => Promise.reject(new Error(`App ${instance.id} lacks permission to mutate GraphQL`)),
    fetch: allowed.has("fetch")
      ? (path, init = {}) => {
          const headers = new Headers(init.headers);
          const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
          return authFetch(url, { ...init, headers });
        }
      : () => Promise.reject(new Error(`App ${instance.id} lacks permission to fetch API routes`)),
    dispatch: allowed.has("dispatch") ? dispatch : () => {},
    messageBus: bus,
    eventBus,
  };
}

function AppLoader({ entry, shellAPI }: {
  entry: RegistryEntry;
  shellAPI: ShellAPI;
}) {
  const [Component, setComponent] = useState<React.ComponentType<{ shell: ShellAPI }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [useIframe, setUseIframe] = useState(false);

  useEffect(() => {
    let mounted = true;

    const builtIn = BUILT_IN_COMPONENTS[entry.id];
    if (builtIn) {
      const cached = builtInCache.get(entry.id);
      if (cached) {
        if (mounted) setComponent(() => cached);
        return;
      }
      builtIn().then((mod) => {
        if (!mounted) return;
        builtInCache.set(entry.id, mod.default);
        setComponent(() => mod.default);
      }).catch((err) => {
        console.error(`Failed to load built-in app ${entry.id}:`, err);
        if (mounted) setFailed(true);
      });
      return;
    }

    loadExternalComponent(entry).then((comp) => {
      if (!mounted) return;
      if (comp) {
        setComponent(() => comp);
      } else {
        setFailed(true);
      }
    });

    return () => { mounted = false; };
  }, [entry.id, entry.url]);

  if (useIframe && entry.url) {
    return (
      <iframe
        src={entry.url}
        className="w-full h-full border-0"
        title={entry.name}
        allow="clipboard-read; clipboard-write"
      />
    );
  }

  if (failed) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-gray-950">
        <div className="text-center space-y-4">
          <p className="text-gray-400">Failed to load <span className="text-white font-medium">{entry.name}</span></p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => {
                setFailed(false);
                externalCache.delete(entry.id);
                loadExternalComponent(entry).then((comp) => {
                  if (comp) setComponent(() => comp);
                  else setFailed(true);
                });
              }}
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-white transition-colors"
            >
              Retry
            </button>
            {entry.url && (
              <button
                onClick={() => setUseIframe(true)}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm text-white transition-colors"
              >
                Open in Sandbox
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!Component) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading {entry.name}...</p>
        </div>
      </div>
    );
  }

  return <Component shell={shellAPI} />;
}

function AppHost({ entry, instance }: { entry: RegistryEntry; instance: AppInstance }) {
  const { dispatch, messageBus, eventBus } = useShell();
  const hostRef = useRef<HTMLDivElement>(null);
  const permissionsKey = useMemo(() => (instance.permissions || []).join("|"), [instance.permissions]);
  const shellAPI = useMemo(
    () => buildShellAPI(instance, dispatch, messageBus, eventBus),
    [
      instance.id,
      instance.installKey,
      instance.state,
      instance.launchPayload,
      permissionsKey,
      dispatch,
      messageBus,
      eventBus,
    ]
  );

  useDockSafeScrollContainers(hostRef, instance.mode === "canvas" && instance.state === "active");

  return (
    <div ref={hostRef} className="specora-app-host h-full w-full overflow-hidden">
      <AppLoader entry={entry} shellAPI={shellAPI} />
    </div>
  );
}

function EmptyCanvas() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-gray-950">
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-16 h-16">
          <svg viewBox="0 0 64 64" className="w-full h-full" fill="none">
            <path
              d="M32 4L58 18v28L32 60 6 46V18L32 4z"
              className="stroke-indigo-500"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d="M32 14L48 24v20L32 54 16 44V24L32 14z"
              className="stroke-indigo-400"
              strokeWidth="1.5"
              strokeLinejoin="round"
              opacity="0.6"
            />
            <circle cx="32" cy="34" r="6" className="fill-indigo-500" opacity="0.8" />
          </svg>
        </div>
        <span className="text-sm font-medium tracking-widest text-gray-500 uppercase">Specora</span>
      </div>
    </div>
  );
}

function CanvasUnavailable({ appId, registry }: { appId: string; registry: RegistryEntry[] }) {
  const exists = registry.find((r) => r.id === appId);
  return (
    <div className="h-full w-full flex items-center justify-center text-gray-500">
      {exists ? "Access denied" : `Unknown app: ${appId}`}
    </div>
  );
}

export function CanvasLayer() {
  const { state, registry } = useShell();
  const role = useMemo(() => getUserRole(), []);
  const visibleRegistry = filterRegistryByRole(registry, role);
  const canvasInstances = state.instances.filter((i) => i.mode === "canvas");
  const hasActiveCanvas = canvasInstances.some((instance) => instance.id === state.activeCanvasId);

  return (
    <div className="relative h-full w-full overflow-hidden bg-gray-950">
      {!hasActiveCanvas && <EmptyCanvas />}
      {canvasInstances.map((instance) => {
        const entry = visibleRegistry.find((r) => r.id === instance.id);
        const isActive = instance.id === state.activeCanvasId;
        return (
          <div
            key={instance.instanceId}
            aria-hidden={!isActive}
            className={`absolute inset-0 h-full w-full ${isActive ? "z-10" : "z-0 pointer-events-none select-none opacity-0"}`}
            style={{ visibility: isActive ? "visible" : "hidden" }}
          >
            {entry ? <AppHost entry={entry} instance={instance} /> : <CanvasUnavailable appId={instance.id} registry={registry} />}
          </div>
        );
      })}
    </div>
  );
}

const WINDOW_STATE_KEY = "specora_window_state";

function loadWindowState(appId: string) {
  try {
    const raw = sessionStorage.getItem(WINDOW_STATE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, { x: number; y: number; width: number; height: number }>;
    return data[appId] ?? null;
  } catch {
    return null;
  }
}

function saveWindowState(appId: string, state: { x: number; y: number; width: number; height: number }) {
  try {
    const raw = sessionStorage.getItem(WINDOW_STATE_KEY) || "{}";
    const data = JSON.parse(raw) as Record<string, { x: number; y: number; width: number; height: number }>;
    data[appId] = state;
    sessionStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(data));
  } catch {
    /* silent */
  }
}

function WindowFrame({
  instance,
  entry,
}: {
  instance: AppInstance;
  entry: RegistryEntry;
}) {
  const { dispatch } = useShell();
  const frameRef = useRef<HTMLDivElement>(null);
  const hasLoaded = useRef(false);
  const windowStateRef = useRef(instance.window);
  windowStateRef.current = instance.window;

  const isActive = instance.state === "active";
  const zIndex = instance.window?.zIndex || 10;
  const isMinimized = instance.window?.minimized ?? false;

  // Load persisted position on first mount (or center if new)
  useEffect(() => {
    if (hasLoaded.current) return;
    hasLoaded.current = true;

    const w = instance.window;
    if (!w) return;

    const launchPayload = instance.launchPayload as { windowPreset?: string } | undefined;
    const persisted = launchPayload?.windowPreset === "large" ? null : loadWindowState(instance.id);
    if (persisted) {
      dispatch({ type: "MOVE_WINDOW", instanceId: instance.instanceId, x: persisted.x, y: persisted.y });
      dispatch({ type: "RESIZE_WINDOW", instanceId: instance.instanceId, width: persisted.width, height: persisted.height });
    } else if (w.x === 0 && w.y === 0) {
      const cx = Math.max(0, Math.round((window.innerWidth - w.width) / 2));
      const cy = Math.max(0, Math.round((window.innerHeight - w.height) / 2));
      dispatch({ type: "MOVE_WINDOW", instanceId: instance.instanceId, x: cx, y: cy });
    }
  }, [instance.id, instance.instanceId, instance.window, dispatch]);

  // Save final state on unmount
  useEffect(() => {
    return () => {
      const w = windowStateRef.current;
      if (w) {
        saveWindowState(instance.id, { x: w.x, y: w.y, width: w.width, height: w.height });
      }
    };
  }, [instance.id, instance.instanceId]);

  const handleMouseDown = () => {
    dispatch({ type: "FOCUS_WINDOW", instanceId: instance.instanceId });
  };

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: "FOCUS_WINDOW", instanceId: instance.instanceId });

    const startX = e.clientX;
    const startY = e.clientY;
    const w = instance.window!;
    const startWindowX = w.x;
    const startWindowY = w.y;

    const handleMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const newX = Math.max(0, Math.min(window.innerWidth - 80, startWindowX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 30, startWindowY + dy));
      if (frameRef.current) {
        frameRef.current.style.left = `${newX}px`;
        frameRef.current.style.top = `${newY}px`;
      }
    };

    const handleMouseUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const newX = Math.max(0, Math.min(window.innerWidth - 80, startWindowX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 30, startWindowY + dy));
      dispatch({ type: "MOVE_WINDOW", instanceId: instance.instanceId, x: newX, y: newY });
      saveWindowState(instance.id, {
        x: newX,
        y: newY,
        width: instance.window!.width,
        height: instance.window!.height,
      });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: "FOCUS_WINDOW", instanceId: instance.instanceId });

    const startX = e.clientX;
    const startY = e.clientY;
    const w = instance.window!;
    const startWidth = w.width;
    const startHeight = w.height;

    const handleMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const newWidth = Math.max(300, Math.min(window.innerWidth - w.x, startWidth + dx));
      const newHeight = Math.max(200, Math.min(window.innerHeight - w.y, startHeight + dy));
      if (frameRef.current) {
        frameRef.current.style.width = `${newWidth}px`;
        frameRef.current.style.height = `${newHeight}px`;
      }
    };

    const handleMouseUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const newWidth = Math.max(300, Math.min(window.innerWidth - w.x, startWidth + dx));
      const newHeight = Math.max(200, Math.min(window.innerHeight - w.y, startHeight + dy));
      dispatch({ type: "RESIZE_WINDOW", instanceId: instance.instanceId, width: newWidth, height: newHeight });
      saveWindowState(instance.id, {
        x: instance.window!.x,
        y: instance.window!.y,
        width: newWidth,
        height: newHeight,
      });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div
      ref={frameRef}
      className="absolute pointer-events-auto"
      style={{
        left: instance.window?.x ?? 0,
        top: instance.window?.y ?? 0,
        width: instance.window?.width || 600,
        height: instance.window?.height || 400,
        zIndex,
        display: isMinimized ? "none" : "block",
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="h-full flex flex-col bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Title bar — draggable */}
        <div
          className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700 select-none cursor-grab active:cursor-grabbing"
          onMouseDown={startDrag}
        >
          <span className="text-sm font-medium text-gray-200">{entry.name || instance.id}</span>
          <div className="flex items-center gap-1">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => dispatch({ type: "MINIMIZE_APP", instanceId: instance.instanceId })}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 text-xs"
            >
              -
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => dispatch({ type: "CLOSE_APP", instanceId: instance.instanceId })}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-900/50 text-gray-400 hover:text-red-400 text-xs"
            >
              x
            </button>
          </div>
        </div>
        {/* Content */}
        <div className={`flex-1 overflow-hidden ${!isActive ? "opacity-50" : ""}`}>
          <AppHost entry={entry} instance={instance} />
        </div>
        {/* Resize handle */}
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          onMouseDown={startResize}
          title="Resize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" className="absolute bottom-1 right-1 text-gray-600">
            <path d="M8 12L12 8M4 12L12 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </div>
      </div>
    </div>
  );
}

export function WindowLayer({ registry }: { registry: RegistryEntry[] }) {
  const { state } = useShell();
  const role = useMemo(() => getUserRole(), []);
  const visibleRegistry = filterRegistryByRole(registry, role);
  const windowInstances = state.instances.filter((i) => i.mode === "window");

  if (windowInstances.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-40">
      {windowInstances.map((instance) => {
        const entry = visibleRegistry.find((r) => r.id === instance.id);
        if (!entry) return null;
        return (
          <WindowFrame
            key={instance.instanceId}
            instance={instance}
            entry={entry}
          />
        );
      })}
    </div>
  );
}
