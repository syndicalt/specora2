"use client";

import { useReducer, useEffect, useState, useRef } from "react";
import { ShellContext, shellReducer, initialShellState } from "./AppContext";
import { CanvasArea, DormantApps, WindowLayer } from "./AppContainers";
import { AppDock } from "./AppDock";
import { AppLauncher } from "./AppLauncher";
import { seedBuiltInApps, getRegistry } from "@/sdk";
import type { RegistryEntry, AppMessage } from "@/sdk/types";
import { X } from "lucide-react";

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

export function AppShell() {
  const [state, dispatch] = useReducer(shellReducer, initialShellState);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [ready, setReady] = useState(false);
  const messageBus = useRef(createMessageBus()).current;

  // Initialize IndexedDB registry
  useEffect(() => {
    let mounted = true;
    seedBuiltInApps().then(() => getRegistry()).then((apps) => {
      if (mounted) {
        setRegistry(apps);
        setReady(true);
        // Auto-open default canvas app if nothing is open
        const serviceMap = apps.find((a) => a.id === "service-map");
        if (serviceMap && state.instances.length === 0) {
          dispatch({
            type: "OPEN_APP",
            id: serviceMap.id,
            installKey: serviceMap.installKey,
            mode: serviceMap.defaultMode,
          });
        }
      }
    });
    return () => { mounted = false; };
  }, []);

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
      <div className="h-screen w-screen bg-gray-950 relative overflow-hidden">
        {/* Canvas area */}
        <div className="h-full w-full">
          <CanvasArea />
        </div>

        {/* Dormant canvas apps (state preserved) */}
          <DormantApps />

        {/* Floating windows */}
        <WindowLayer registry={registry} />

        {/* Notifications */}
        <div className="fixed top-4 right-4 z-[60] space-y-2">
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
