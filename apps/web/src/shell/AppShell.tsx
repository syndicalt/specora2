"use client";

import { useReducer, useEffect, useState, useRef } from "react";
import { ShellContext, shellReducer, initialShellState, type ShellAction } from "./AppContext";
import { CanvasLayer, WindowLayer } from "./AppContainers";
import { AppDock } from "./AppDock";
import { AppLauncher } from "./AppLauncher";
import { syncServerRegistry } from "@/sdk";
import type { RegistryEntry, AppMessage } from "@/sdk/types";
import { X } from "lucide-react";
import { ChatPanel } from "@/components/ChatPanel";
import { graphqlClient } from "@/lib/api";
import { useEventStream } from "@/hooks/useEventStream";
import { BootstrapLoading } from "@/components/BootstrapLoading";
import { applyTheme } from "@/lib/themes";

function createMessageBus() {
  const handlers = new Set<(msg: AppMessage) => void>();
  return {
    subscribe: (handler: (msg: AppMessage) => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    publish: (msg: AppMessage) => {
      handlers.forEach((h) => h(msg));
    },
  };
}

const ME_QUERY = `query { me { id name email preferences } }`;

const UPDATE_PREFS_MUTATION = `
  mutation UpdatePreferences($preferences: JSON!) {
    updatePreferences(preferences: $preferences) { id preferences }
  }
`;

const CREATE_FORM_TABLE_BY_APP: Record<string, string> = {
  "incident-manager": "pg.incidents",
  "change-manager": "pg.change_requests",
  "knowledge-core": "pg.knowledge_items",
  "prevention-center": "pg.prevention_records",
  "asset-command": "pg.asset_records",
  "discovery": "pg.discovery_pipelines",
};

const FALLBACK_CREATE_FORM = { appId: "incident-manager", tableId: "pg.incidents" };

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

interface HistoryState {
  activeCanvasId: string | null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timer));
  });
}

function useShellHistory(
  state: typeof initialShellState,
  rawDispatch: React.Dispatch<ShellAction>,
  registry: RegistryEntry[],
  ready: boolean
) {
  const isNavigatingRef = useRef(false);
  const historyLengthRef = useRef(0);

  // Push history entry when active canvas changes due to user action
  useEffect(() => {
    if (!ready || isNavigatingRef.current) return;
    const current: HistoryState = { activeCanvasId: state.activeCanvasId };
    // Replace initial state, then push on subsequent changes
    if (historyLengthRef.current === 0) {
      history.replaceState(current, "");
      historyLengthRef.current = 1;
    } else {
      history.pushState(current, "");
      historyLengthRef.current++;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeCanvasId, ready]);

  // Handle browser back/forward
  useEffect(() => {
    if (!ready) return;
    const onPopState = (e: PopStateEvent) => {
      const prev = e.state as HistoryState | null;
      if (!prev) return;
      isNavigatingRef.current = true;
      if (prev.activeCanvasId) {
        const instance = state.instances.find((i) => i.id === prev.activeCanvasId);
        if (instance) {
          rawDispatch({ type: "ACTIVATE_APP", instanceId: instance.instanceId });
        } else {
          const entry = registry.find((r) => r.id === prev.activeCanvasId);
          if (entry) {
            rawDispatch({
              type: "OPEN_APP",
              id: entry.id,
              installKey: entry.installKey,
              mode: entry.defaultMode,
              permissions: entry.permissions,
            });
          }
        }
      } else {
        // No active canvas — close the current one if any
        const active = state.instances.find((i) => i.state === "active" && i.mode === "canvas");
        if (active) {
          rawDispatch({ type: "CLOSE_APP", instanceId: active.instanceId });
        }
      }
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 0);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [ready, rawDispatch, state.instances, registry]);
}

export function AppShell({ initialAppId = "service-map" }: { initialAppId?: string } = {}) {
  const [state, dispatch] = useReducer(shellReducer, initialShellState);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [bootstrapPhase, setBootstrapPhase] = useState("Starting platform");
  const [bootstrapTimedOut, setBootstrapTimedOut] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const messageBus = useRef(createMessageBus()).current;
  const userIdRef = useRef<string | null>(null);
  const initialOpenDone = useRef(false);
  const hasLoadedPrefs = useRef(false);
  const loadedDockRef = useRef<string[] | null>(null);
  const bootstrapPhaseRef = useRef("Starting platform");

  useShellHistory(state, dispatch, registry, ready);

  // Initialize IndexedDB registry + fetch user preferences
  useEffect(() => {
    let mounted = true;
    setReady(false);
    setBootstrapTimedOut(false);
    setBootstrapPhase("Loading application registry");
    bootstrapPhaseRef.current = "Loading application registry";
    const timeout = window.setTimeout(() => {
      if (!mounted) return;
      setBootstrapTimedOut(true);
      console.warn(`[AppShell] bootstrap timeout while ${bootstrapPhaseRef.current}`);
    }, 10000);

    async function initializeShell() {
      let apps: RegistryEntry[] = [];
      try {
        apps = await syncServerRegistry();
      } catch (err) {
        console.error("[AppShell] syncServerRegistry failed:", err);
      }
      if (!mounted) return;
      setRegistry(apps);
      setBootstrapPhase("Loading user preferences");
      bootstrapPhaseRef.current = "Loading user preferences";

      try {
        const data: any = await withTimeout(graphqlClient.request(ME_QUERY), 5000, "User preferences");
        if (!mounted) return;
        const user = data?.me;
        if (user) {
          userIdRef.current = user.id;
          applyTheme(user.preferences?.theme);
          const dockOrder = user.preferences?.dock?.order;
          if (Array.isArray(dockOrder)) {
            loadedDockRef.current = dockOrder;
            dispatch({ type: "SET_DOCK_ORDER", order: dockOrder.length > 0 ? dockOrder : ["service-map"] });
          } else {
            dispatch({ type: "SET_DOCK_ORDER", order: ["service-map"] });
          }
        } else {
          applyTheme(null);
          dispatch({ type: "SET_DOCK_ORDER", order: ["service-map"] });
        }
        hasLoadedPrefs.current = true;
        setReady(true);
      } catch (err) {
        console.error("[AppShell] user preferences failed:", err);
        if (!mounted) return;
        applyTheme(null);
        dispatch({ type: "SET_DOCK_ORDER", order: ["service-map"] });
        hasLoadedPrefs.current = true;
        setReady(true);
      } finally {
        window.clearTimeout(timeout);
      }
    }

    initializeShell();
    return () => {
      mounted = false;
      window.clearTimeout(timeout);
    };
  }, [bootstrapAttempt]);

  // Auto-open default canvas app once on first load — only if nothing is pinned
  useEffect(() => {
    if (!ready || initialOpenDone.current) return;
    const initialApp = registry.find((a) => a.id === initialAppId) || registry.find((a) => a.id === "service-map");
    const routeSpecificInitialApp = initialAppId !== "service-map";
    if (initialApp && state.instances.length === 0 && (routeSpecificInitialApp || state.dockedIds.length === 0)) {
      initialOpenDone.current = true;
      dispatch({
        type: "OPEN_APP",
        id: initialApp.id,
        installKey: initialApp.installKey,
        mode: initialApp.defaultMode,
        permissions: initialApp.permissions,
      });
    }
  }, [initialAppId, ready, registry, state.instances.length, state.dockedIds.length]);

  // Debounced sync dock order to server
  useEffect(() => {
    if (!userIdRef.current || !ready || !hasLoadedPrefs.current) return;
    // Don't sync if dock matches what we just loaded
    if (loadedDockRef.current && JSON.stringify(loadedDockRef.current) === JSON.stringify(state.dockedIds)) {
      loadedDockRef.current = null; // clear so future changes will sync
      return;
    }
    const timer = setTimeout(() => {
      graphqlClient.request(UPDATE_PREFS_MUTATION, {
        preferences: { dock: { order: state.dockedIds } },
      }).catch(() => {
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [state.dockedIds, ready]);

  // Dismiss notifications after 5s
  useEffect(() => {
    if (state.notifications.length === 0) return;
    const timers = state.notifications.map((n) =>
      setTimeout(() => dispatch({ type: "DISMISS_NOTIFICATION", id: n.id }), 5000)
    );
    return () => timers.forEach(clearTimeout);
  }, [state.notifications]);

  useEffect(() => {
    if (!ready) return;

    const openCreateForm = () => {
      const activeAppId = state.activeCanvasId || FALLBACK_CREATE_FORM.appId;
      const tableId = CREATE_FORM_TABLE_BY_APP[activeAppId] || FALLBACK_CREATE_FORM.tableId;
      const tablesEntry = registry.find((entry) => entry.id === "tables");
      if (!tablesEntry) {
        dispatch({
          type: "NOTIFY",
          notification: {
            id: crypto.randomUUID(),
            message: "Tables application is not available for record creation",
            type: "error",
          },
        });
        return;
      }

      dispatch({
        type: "OPEN_APP",
        id: tablesEntry.id,
        installKey: tablesEntry.installKey,
        mode: "window",
        permissions: tablesEntry.permissions,
        window: {
          x: 16,
          y: 16,
          width: Math.max(900, window.innerWidth - 32),
          height: Math.max(640, window.innerHeight - 112),
        },
        launchPayload: { type: "SELECT_TABLE", tableId, mode: "create", createdAt: Date.now(), windowPreset: "large" },
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const isNewFormShortcut = event.key.toLowerCase() === "n"
        && event.altKey
        && !event.shiftKey
        && !event.repeat
        && (event.ctrlKey || event.metaKey);
      if (!isNewFormShortcut) return;
      event.preventDefault();
      openCreateForm();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ready, registry, state.activeCanvasId]);

  useEffect(() => {
    if (!ready) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const isLauncherShortcut = event.key.toLowerCase() === "k"
        && event.shiftKey
        && !event.altKey
        && !event.repeat
        && (event.ctrlKey || event.metaKey);
      if (!isLauncherShortcut || isEditableTarget(event.target)) return;
      event.preventDefault();
      dispatch({ type: "TOGGLE_LAUNCHER" });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ready]);

  useEffect(() => {
    if (!ready) return;

    const closeActiveApp = () => {
      const focusedWindow = state.focusedWindowId
        ? state.instances.find((instance) => instance.instanceId === state.focusedWindowId)
        : null;
      const activeCanvas = state.activeCanvasId
        ? state.instances.find((instance) => instance.mode === "canvas" && instance.id === state.activeCanvasId)
        : null;
      const target = focusedWindow || activeCanvas;
      if (!target) return;
      dispatch({ type: "CLOSE_APP", instanceId: target.instanceId });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const isCloseShortcut = event.key.toLowerCase() === "x"
        && event.shiftKey
        && !event.altKey
        && !event.repeat
        && (event.ctrlKey || event.metaKey);
      if (!isCloseShortcut || isEditableTarget(event.target)) return;
      event.preventDefault();
      closeActiveApp();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ready, state.activeCanvasId, state.focusedWindowId, state.instances]);

  const eventStream = useEventStream();

  if (!ready) {
    return (
      <BootstrapLoading
        label="Loading platform..."
        detail={bootstrapPhase}
        timedOut={bootstrapTimedOut}
        onRetry={() => setBootstrapAttempt((attempt) => attempt + 1)}
      />
    );
  }

  return (
    <ShellContext.Provider value={{ state, dispatch, registry, messageBus, eventBus: eventStream }}>
      <div className="h-screen w-screen bg-gray-950 flex overflow-hidden">
        {/* Main workspace */}
        <div className="flex-1 relative overflow-hidden">
          {/* Canvas apps stay mounted while open; switching only changes visibility. */}
          <div className="h-full w-full">
            <CanvasLayer />
          </div>

          {/* Floating windows — confined to workspace */}
          <WindowLayer registry={registry} />
        </div>

        {/* Chat Panel */}
        <ChatPanel />

        {/* Notifications — offset from right edge when panel is open */}
        <div
          className="fixed top-4 z-[60] space-y-2 transition-[right] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{ right: state.rightPanelOpen ? state.rightPanelWidth + 16 : 16 }}
        >
          {state.notifications.map((n) => (
            <div
              key={n.id}
              className={`flex min-w-72 max-w-md items-start gap-3 px-4 py-2.5 rounded-xl shadow-2xl border text-sm backdrop-blur-xl ${
                n.type === "error"
                  ? "bg-red-900/60 border-red-500/20 text-red-200"
                  : n.type === "success"
                    ? "bg-green-900/60 border-green-500/20 text-green-200"
                    : "bg-gray-900/60 border-white/10 text-gray-200"
              }`}
            >
              <span className="min-w-0 flex-1 leading-5">{n.message}</span>
              <button
                onClick={() => dispatch({ type: "DISMISS_NOTIFICATION", id: n.id })}
                className="ml-auto shrink-0 pt-0.5 text-gray-500 transition-colors hover:text-white"
                aria-label="Dismiss notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* App Launcher modal */}
        <AppLauncher registry={registry} />

        {/* Bottom dock */}
        <AppDock registry={registry} />
      </div>
    </ShellContext.Provider>
  );
}
