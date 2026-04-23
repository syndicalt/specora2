"use client";

import { useState, useRef, useEffect } from "react";
import { useShell } from "./AppContext";
import type { RegistryEntry } from "@/sdk/types";
import { LayoutGrid, LogOut, X } from "lucide-react";
import { removeToken } from "@/lib/auth";

export function UserProfileBadge() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLogout = () => {
    removeToken();
    window.location.href = "/login";
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-700/50 transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-indigo-500/20 flex items-center justify-center text-xs font-semibold text-indigo-300">
          U
        </div>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-40 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

export function AppDock({ registry }: { registry: RegistryEntry[] }) {
  const { state, dispatch } = useShell();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; appId: string } | null>(null);

  const handleDockClick = (id: string) => {
    const instance = state.instances.find((i) => i.id === id);
    if (instance) {
      if (instance.state === "active") {
        dispatch({ type: "MINIMIZE_APP", instanceId: instance.instanceId });
      } else {
        dispatch({ type: "ACTIVATE_APP", instanceId: instance.instanceId });
      }
    } else {
      const entry = registry.find((r) => r.id === id);
      if (entry) {
        dispatch({ type: "OPEN_APP", id: entry.id, installKey: entry.installKey, mode: entry.defaultMode });
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, appId: id });
  };

  const isActive = (id: string) => {
    const instance = state.instances.find((i) => i.id === id);
    return instance?.state === "active";
  };

  return (
    <>
      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-[70] bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              dispatch({ type: "UNPIN_FROM_DOCK", id: contextMenu.appId });
              const instance = state.instances.find((i) => i.id === contextMenu.appId);
              if (instance) {
                dispatch({ type: "CLOSE_APP", instanceId: instance.instanceId });
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
            Close
          </button>
        </div>
      )}

      {/* Click outside to close context menu */}
      {contextMenu && (
        <div className="fixed inset-0 z-[65]" onClick={() => setContextMenu(null)} />
      )}

      {/* Dock */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 px-2 py-1.5 bg-gray-900/90 backdrop-blur-md border border-gray-700/50 rounded-2xl shadow-2xl">
        {/* All Apps */}
        <button
          onClick={() => dispatch({ type: "TOGGLE_LAUNCHER" })}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-gray-700/50 transition-colors"
          title="All Apps"
        >
          <LayoutGrid className="w-5 h-5 text-gray-400" />
        </button>

        <div className="w-px h-6 bg-gray-700/50 mx-1" />

        {/* Docked apps */}
        <div className="flex items-center gap-1">
          {state.dockedIds.map((id) => {
            const entry = registry.find((r) => r.id === id);
            if (!entry) return null;
            const active = isActive(id);
            return (
              <button
                key={id}
                onClick={() => handleDockClick(id)}
                onContextMenu={(e) => handleContextMenu(e, id)}
                className={`relative flex items-center justify-center w-10 h-10 rounded-xl transition-all ${
                  active
                    ? "bg-indigo-500/20 text-indigo-300 ring-2 ring-indigo-500/50"
                    : "hover:bg-gray-700/50 text-gray-400 hover:text-gray-200"
                }`}
                title={entry.name}
              >
                <span className="text-sm font-bold">{entry.icon[0]}</span>
                {state.instances.some((i) => i.id === id && i.mode === "window") && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-indigo-400 rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        <div className="w-px h-6 bg-gray-700/50 mx-1" />

        {/* User profile */}
        <UserProfileBadge />
      </div>
    </>
  );
}
