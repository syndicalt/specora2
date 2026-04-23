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
        className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-xs font-bold shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40 hover:scale-105 transition-all duration-200"
      >
        U
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-44 bg-gray-900/95 backdrop-blur-xl border border-gray-700/50 rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-gray-800">
            <p className="text-xs text-gray-500">Signed in as</p>
            <p className="text-sm font-medium text-gray-200">User</p>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
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

  const isOpen = (id: string) => {
    return state.instances.some((i) => i.id === id);
  };

  return (
    <>
      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-[70] bg-gray-900/95 backdrop-blur-xl border border-gray-700/50 rounded-xl shadow-2xl overflow-hidden py-1"
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
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50">
        <div className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-900/70 backdrop-blur-2xl border border-white/10 rounded-[2rem] shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)]">
          {/* All Apps */}
          <button
            onClick={() => dispatch({ type: "TOGGLE_LAUNCHER" })}
            className="flex items-center justify-center w-11 h-11 rounded-2xl text-gray-400 hover:text-white hover:bg-white/10 transition-all duration-200"
            title="All Apps"
          >
            <LayoutGrid className="w-5 h-5" />
          </button>

          <div className="w-px h-7 bg-white/10 mx-1" />

          {/* Docked apps */}
          <div className="flex items-center gap-1">
            {state.dockedIds.map((id) => {
              const entry = registry.find((r) => r.id === id);
              if (!entry) return null;
              const active = isActive(id);
              const open = isOpen(id);
              return (
                <button
                  key={id}
                  onClick={() => handleDockClick(id)}
                  onContextMenu={(e) => handleContextMenu(e, id)}
                  className={`group relative flex items-center justify-center w-11 h-11 rounded-2xl transition-all duration-200 ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:text-white hover:bg-white/5"
                  }`}
                  title={entry.name}
                >
                  <span className={`text-lg font-bold transition-transform duration-200 ${active ? "scale-110" : "group-hover:scale-110"}`}>
                    {entry.icon[0]}
                  </span>
                  {/* Active indicator dot */}
                  {active && (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-indigo-400 rounded-full shadow-[0_0_6px_rgba(99,102,241,0.6)]" />
                  )}
                  {/* Open but dormant indicator */}
                  {!active && open && (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-gray-500 rounded-full" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="w-px h-7 bg-white/10 mx-1" />

          {/* User profile */}
          <UserProfileBadge />
        </div>
      </div>
    </>
  );
}
