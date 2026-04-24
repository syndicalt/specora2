"use client";

import { useReducer, useEffect, useState, useRef } from "react";
import { ShellContext, shellReducer, initialShellState } from "./AppContext";
import { CanvasArea, DormantApps, WindowLayer } from "./AppContainers";
import { AppDock } from "./AppDock";
import { AppLauncher } from "./AppLauncher";
import { seedBuiltInApps, getRegistry } from "@/sdk";
import type { RegistryEntry, AppMessage } from "@/sdk/types";
import { X } from "lucide-react";
import { ChatPanel } from "@/components/ChatPanel";
import { graphqlClient } from "@/lib/api";

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

export function AppShell() {
  const [state, dispatch] = useReducer(shellReducer, initialShellState);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [ready, setReady] = useState(false);
  const messageBus = useRef(createMessageBus()).current;
  const userIdRef = useRef<string | null>(null);
  const initialOpenDone = useRef(false);
  const hasLoadedPrefs = useRef(false);
  const loadedDockRef = useRef<string[] | null>(null);

  // Initialize IndexedDB registry + fetch user preferences
  useEffect(() => {
    let mounted = true;
    seedBuiltInApps().then(() => getRegistry()).then((apps) => {
      if (!mounted) return;
      setRegistry(apps);

      // Fetch user preferences for dock order
      graphqlClient.request(ME_QUERY).then((data: any) => {
        if (!mounted) return;
        const user = data?.me;
        if (user) {
          userIdRef.current = user.id;
          const dockOrder = user.preferences?.dock?.order;
          if (Array.isArray(dockOrder)) {
            loadedDockRef.current = dockOrder;
            dispatch({ type: "SET_DOCK_ORDER", order: dockOrder.length > 0 ? dockOrder : ["service-map"] });
          } else {
            dispatch({ type: "SET_DOCK_ORDER", order: ["service-map"] });
          }
        } else {
          dispatch({ type: "SET_DOCK_ORDER", order: ["service-map"] });
        }
        hasLoadedPrefs.current = true;
        setReady(true);
      }).catch(() => {
        if (!mounted) return;
        dispatch({ type: "SET_DOCK_ORDER", order: ["service-map"] });
        hasLoadedPrefs.current = true;
        setReady(true);
      });
    });
    return () => { mounted = false; };
  }, []);

  // Auto-open default canvas app once on first load — only if nothing is pinned
  useEffect(() => {
    if (!ready || initialOpenDone.current) return;
    const serviceMap = registry.find((a) => a.id === "service-map");
    if (serviceMap && state.instances.length === 0 && state.dockedIds.length === 0) {
      initialOpenDone.current = true;
      dispatch({
        type: "OPEN_APP",
        id: serviceMap.id,
        installKey: serviceMap.installKey,
        mode: serviceMap.defaultMode,
        permissions: serviceMap.permissions,
      });
    }
  }, [ready, registry, state.instances.length, state.dockedIds.length]);

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

  if (!ready) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gray-950 text-gray-400">
        Loading platform...
      </div>
    );
  }

  return (
    <ShellContext.Provider value={{ state, dispatch, registry, messageBus }}>
      <div className="h-screen w-screen bg-gray-950 flex overflow-hidden">
        {/* Main workspace */}
        <div className="flex-1 relative overflow-hidden">
          {/* Canvas area */}
          <div className="h-full w-full">
            <CanvasArea />
          </div>

          {/* Dormant canvas apps (state preserved) */}
          <DormantApps />

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
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-2xl border text-sm backdrop-blur-xl ${
                n.type === "error"
                  ? "bg-red-900/60 border-red-500/20 text-red-200"
                  : n.type === "success"
                    ? "bg-green-900/60 border-green-500/20 text-green-200"
                    : "bg-gray-900/60 border-white/10 text-gray-200"
              }`}
            >
              <span>{n.message}</span>
              <button
                onClick={() => dispatch({ type: "DISMISS_NOTIFICATION", id: n.id })}
                className="ml-2 text-gray-500 hover:text-white transition-colors"
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
