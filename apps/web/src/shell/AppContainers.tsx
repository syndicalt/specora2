"use client";

import type { AppInstance } from "./AppContext";
import type { RegistryEntry } from "@/sdk/types";
import type { ShellAPI } from "@/sdk/types";
import { useShell } from "./AppContext";
import ServiceMapApp from "@/apps/service-map";

const APP_COMPONENTS: Record<string, React.ComponentType<{ shell: ShellAPI }>> = {
  "service-map": ServiceMapApp,
};

function buildShellAPI(instance: AppInstance, dispatch: React.Dispatch<any>, bus: { publish: (m: any) => void; subscribe: (h: any) => () => void }): ShellAPI {
  return {
    installKey: instance.installKey,
    appId: instance.id,
    isActive: instance.state === "active",
    isDormant: instance.state === "dormant",
    sendMessage: (msg) => bus.publish({ from: instance.installKey, ...msg }),
    onMessage: (handler) => bus.subscribe((m: any) => {
      if (m.to === instance.installKey || m.to === "*") handler(m);
    }),
    notify: (message, type = "info") => {
      dispatch({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message, type } });
    },
  };
}

export function CanvasArea() {
  const { state, dispatch, messageBus } = useShell();
  const activeInstance = state.instances.find(
    (i) => i.id === state.activeCanvasId && i.mode === "canvas"
  );

  if (!activeInstance) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-500">
        <div className="text-center space-y-2">
          <p className="text-lg font-medium">No app active</p>
          <p className="text-sm">Click &quot;All Apps&quot; on the dock to get started</p>
        </div>
      </div>
    );
  }

  const AppComponent = APP_COMPONENTS[activeInstance.id];
  if (!AppComponent) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-500">
        Unknown app: {activeInstance.id}
      </div>
    );
  }

  const shellAPI = buildShellAPI(activeInstance, dispatch, messageBus);

  return (
    <div className="h-full w-full">
      <AppComponent shell={shellAPI} />
    </div>
  );
}

export function DormantApps() {
  const { state, dispatch, messageBus } = useShell();
  const dormantInstances = state.instances.filter((i) => i.state === "dormant" && i.mode === "canvas");

  return (
    <div className="hidden">
      {dormantInstances.map((instance) => {
        const AppComponent = APP_COMPONENTS[instance.id];
        if (!AppComponent) return null;
        const shellAPI = buildShellAPI(instance, dispatch, messageBus);
        return (
          <div key={instance.instanceId} id={`dormant-${instance.instanceId}`}>
            <AppComponent shell={shellAPI} />
          </div>
        );
      })}
    </div>
  );
}

export function WindowLayer({ registry }: { registry: RegistryEntry[] }) {
  const { state, dispatch, messageBus } = useShell();
  const windowInstances = state.instances.filter((i) => i.mode === "window");

  if (windowInstances.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-40">
      {windowInstances.map((instance) => {
        const AppComponent = APP_COMPONENTS[instance.id];
        if (!AppComponent) return null;

        const shellAPI = buildShellAPI(instance, dispatch, messageBus);
        const isActive = instance.state === "active";
        const zIndex = instance.window?.zIndex || 10;
        const isMinimized = instance.window?.minimized ?? false;

        return (
          <div
            key={instance.instanceId}
            className="absolute pointer-events-auto"
            style={{
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: instance.window?.width || 600,
              height: instance.window?.height || 400,
              zIndex,
              display: isMinimized ? "none" : "block",
            }}
          >
            <div className="h-full flex flex-col bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
              {/* Title bar */}
              <div
                className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700 cursor-pointer select-none"
                onClick={() => dispatch({ type: "FOCUS_WINDOW", instanceId: instance.instanceId })}
              >
                <span className="text-sm font-medium text-gray-200">
                  {registry.find((r) => r.id === instance.id)?.name || instance.id}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: "MINIMIZE_APP", instanceId: instance.instanceId });
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 text-xs"
                  >
                    −
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: "CLOSE_APP", instanceId: instance.instanceId });
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-900/50 text-gray-400 hover:text-red-400 text-xs"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {/* Content */}
              <div className={`flex-1 overflow-hidden ${!isActive ? "opacity-50" : ""}`}>
                <AppComponent shell={shellAPI} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
