"use client";

import { useState, useEffect, useRef } from "react";
import type { AppInstance } from "./AppContext";
import type { RegistryEntry, ShellAPI } from "@/sdk/types";
import { useShell } from "./AppContext";
import ServiceMapApp from "@/apps/service-map";
import CMDBExplorerApp from "@/apps/cmdb-explorer";
import SettingsApp from "@/apps/settings";
import DiscoveryApp from "@/apps/discovery";
import ArcApp from "@/apps/arc";

const BUILT_IN_COMPONENTS: Record<string, React.ComponentType<{ shell: ShellAPI }>> = {
  "service-map": ServiceMapApp,
  "cmdb-explorer": CMDBExplorerApp,
  "settings": SettingsApp,
  "discovery": DiscoveryApp,
  "arc": ArcApp,
};

const externalCache = new Map<string, React.ComponentType<{ shell: ShellAPI }>>();

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
  "read:cmdb": ["sendMessage", "onMessage", "notify"],
  "write:cmdb": ["sendMessage", "onMessage", "notify"],
  "read:relationships": ["sendMessage", "onMessage", "notify"],
  "read:discovery": ["sendMessage", "onMessage", "notify"],
  "write:discovery": ["sendMessage", "onMessage", "notify"],
  "read:profile": ["sendMessage", "onMessage", "notify"],
  "read:chat": ["sendMessage", "onMessage", "notify"],
};

function buildShellAPI(
  instance: AppInstance,
  dispatch: React.Dispatch<any>,
  bus: { publish: (m: any) => void; subscribe: (h: any) => () => void }
): ShellAPI {
  const allowed = new Set(
    instance.permissions.flatMap((p) => PERMISSION_CAPABILITIES[p] || [])
  );

  return {
    installKey: instance.installKey,
    appId: instance.id,
    isActive: instance.state === "active",
    isDormant: instance.state === "dormant",
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
    dispatch: allowed.has("dispatch") ? dispatch : () => {},
    messageBus: bus,
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
      if (mounted) setComponent(() => builtIn);
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

export function CanvasArea() {
  const { state, dispatch, messageBus, registry } = useShell();
  const activeInstance = state.instances.find(
    (i) => i.id === state.activeCanvasId && i.mode === "canvas"
  );

  if (!activeInstance) {
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

  const entry = registry.find((r) => r.id === activeInstance.id);
  if (!entry) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-500">
        Unknown app: {activeInstance.id}
      </div>
    );
  }

  const shellAPI = buildShellAPI(activeInstance, dispatch, messageBus);

  return (
    <div className="h-full w-full">
      <AppLoader entry={entry} shellAPI={shellAPI} />
    </div>
  );
}

export function DormantApps() {
  const { state, dispatch, messageBus, registry } = useShell();
  const dormantInstances = state.instances.filter((i) => i.state === "dormant" && i.mode === "canvas");

  return (
    <div className="hidden">
      {dormantInstances.map((instance) => {
        const entry = registry.find((r) => r.id === instance.id);
        if (!entry) return null;
        const shellAPI = buildShellAPI(instance, dispatch, messageBus);
        return (
          <div key={instance.instanceId} id={`dormant-${instance.instanceId}`}>
            <AppLoader entry={entry} shellAPI={shellAPI} />
          </div>
        );
      })}
    </div>
  );
}

const WINDOW_STATE_KEY = "specora_window_state";

function loadWindowState(appId: string) {
  try {
    const raw = localStorage.getItem(WINDOW_STATE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, { x: number; y: number; width: number; height: number }>;
    return data[appId] ?? null;
  } catch {
    return null;
  }
}

function saveWindowState(appId: string, state: { x: number; y: number; width: number; height: number }) {
  try {
    const raw = localStorage.getItem(WINDOW_STATE_KEY) || "{}";
    const data = JSON.parse(raw) as Record<string, { x: number; y: number; width: number; height: number }>;
    data[appId] = state;
    localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(data));
  } catch {
    /* silent */
  }
}

function WindowFrame({
  instance,
  entry,
  shellAPI,
}: {
  instance: AppInstance;
  entry: RegistryEntry;
  shellAPI: ShellAPI;
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

    const persisted = loadWindowState(instance.id);
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
          <AppLoader entry={entry} shellAPI={shellAPI} />
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
  const { state, dispatch, messageBus } = useShell();
  const windowInstances = state.instances.filter((i) => i.mode === "window");

  if (windowInstances.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-40">
      {windowInstances.map((instance) => {
        const entry = registry.find((r) => r.id === instance.id);
        if (!entry) return null;
        const shellAPI = buildShellAPI(instance, dispatch, messageBus);
        return (
          <WindowFrame
            key={instance.instanceId}
            instance={instance}
            entry={entry}
            shellAPI={shellAPI}
          />
        );
      })}
    </div>
  );
}
