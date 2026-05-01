"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useShell } from "./AppContext";
import type { RegistryEntry } from "@/sdk/types";
import { APP_ICONS, LogOut, X, MessageSquare, PinOff, Pin } from "@/lib/icons";
import { removeToken } from "@/lib/auth";
import { graphqlClient } from "@/lib/api";
import { appIconColor, appIconTileStyle } from "./appIconStyles";

const ME_QUERY = `query { me { id name email } }`;

type DockUser = {
  id: string;
  name?: string | null;
  email?: string | null;
};

function initialsFor(name?: string | null, email?: string | null) {
  const source = (name || email || "User").trim();
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || "U";
}

export function UserProfileBadge() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<DockUser | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { dispatch } = useShell();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    let mounted = true;
    graphqlClient.request(ME_QUERY)
      .then((data: any) => {
        if (mounted) setUser(data?.me || null);
      })
      .catch(() => {
        if (mounted) setUser(null);
      });

    const profileHandler = (event: Event) => {
      const detail = (event as CustomEvent<DockUser>).detail;
      if (detail) setUser(detail);
    };
    window.addEventListener("specora:user-profile-updated", profileHandler);
    return () => {
      mounted = false;
      window.removeEventListener("specora:user-profile-updated", profileHandler);
    };
  }, []);

  const handleLogout = () => {
    removeToken();
    window.location.href = "/login";
  };

  const openSettings = () => {
    setOpen(false);
    dispatch({ type: "OPEN_APP", id: "settings", installKey: "settings", mode: "window", permissions: ["read:profile", "write:profile"] });
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-xs font-bold shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40 hover:scale-105 transition-all duration-200"
        title={user?.name || user?.email || "User"}
      >
        {initialsFor(user?.name, user?.email)}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-48 bg-gray-900/95 backdrop-blur-xl border border-gray-700/50 rounded-xl shadow-2xl overflow-hidden z-[60]">
          <div className="px-3 py-2.5 border-b border-gray-800">
            <p className="text-xs text-gray-500">Signed in as</p>
            <p className="truncate text-sm font-medium text-gray-200">{user?.name || user?.email || "User"}</p>
            {user?.name && user?.email && <p className="truncate text-xs text-gray-500">{user.email}</p>}
          </div>
          <button
            onClick={openSettings}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <APP_ICONS.Settings className="w-4 h-4 text-gray-500" />
            Settings
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
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
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateDockInset = () => {
      const rect = dockRef.current?.getBoundingClientRect();
      const inset = rect ? Math.ceil(window.innerHeight - rect.top + 16) : 112;
      document.documentElement.style.setProperty("--specora-dock-safe-area", `${inset}px`);
      window.dispatchEvent(new Event("specora:dock-safe-area-change"));
    };

    updateDockInset();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateDockInset) : null;
    if (dockRef.current) observer?.observe(dockRef.current);
    window.addEventListener("resize", updateDockInset);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateDockInset);
    };
  }, [state.dockedIds.length, state.instances.length, state.rightPanelOpen]);

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
        dispatch({ type: "OPEN_APP", id: entry.id, installKey: entry.installKey, mode: entry.defaultMode, permissions: entry.permissions });
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

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    // Required for Firefox
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    if (!id) {
      setDragOverIndex(null);
      setDraggingId(null);
      return;
    }
    const fromIndex = state.dockedIds.indexOf(id);
    if (fromIndex !== -1 && fromIndex !== toIndex) {
      dispatch({ type: "REORDER_DOCK", fromIndex, toIndex });
    }
    setDragOverIndex(null);
    setDraggingId(null);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const isPinned = (id: string) => state.dockedIds.includes(id);

  // Running apps that are not pinned — show in dock after pinned section
  const uniqueRunningUnpinned = useMemo(() => {
    const ids = state.instances
      .filter((i) => !state.dockedIds.includes(i.id))
      .map((i) => i.id);
    return [...new Set(ids)];
  }, [state.instances, state.dockedIds]);

  return (
    <>
      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-[60] bg-gray-900/95 backdrop-blur-xl border border-gray-700/50 rounded-xl shadow-2xl overflow-hidden py-1"
          style={{ left: contextMenu.x, top: contextMenu.y, transform: "translateY(calc(-100% - 8px))" }}
        >
          {isOpen(contextMenu.appId) && (
            <button
              onClick={() => {
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
          )}
          {isPinned(contextMenu.appId) ? (
            <button
              onClick={() => {
                dispatch({ type: "UNPIN_FROM_DOCK", id: contextMenu.appId });
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
            >
              <PinOff className="w-4 h-4" />
              Unpin from Dock
            </button>
          ) : (
            <button
              onClick={() => {
                dispatch({ type: "PIN_TO_DOCK", id: contextMenu.appId });
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
            >
              <Pin className="w-4 h-4" />
              Pin to Dock
            </button>
          )}
        </div>
      )}

      {/* Click outside to close context menu */}
      {contextMenu && (
        <div className="fixed inset-0 z-[55]" onClick={() => setContextMenu(null)} />
      )}

      {/* Dock */}
      <div ref={dockRef} className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
        <div className="mb-2 flex justify-center">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-gray-950/80 px-3 py-1.5 text-[11px] font-medium text-gray-400 shadow-lg shadow-black/30 backdrop-blur-xl">
            <span className="hidden sm:inline-flex items-center gap-1">
              <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-gray-300">Ctrl+Shift+K</kbd>
              Apps
            </span>
            <span className="hidden sm:block h-3 w-px bg-white/10" />
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-gray-300">Ctrl+/</kbd>
              Chat
            </span>
            <span className="h-3 w-px bg-white/10" />
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-gray-300">Ctrl+Shift+X</kbd>
              Close
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-800/95 backdrop-blur-2xl border border-white/15 rounded-[2rem] shadow-[0_12px_40px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.1)] min-w-[280px]">
          {/* All Apps */}
          <button
            onClick={() => dispatch({ type: "TOGGLE_LAUNCHER" })}
            className="flex items-center justify-center w-11 h-11 rounded-2xl text-gray-400 hover:text-white hover:bg-white/10 transition-all duration-200"
            title="All Apps"
          >
            <APP_ICONS.LayoutGrid className="w-5 h-5" />
          </button>

          <div className="w-px h-7 bg-white/10 mx-1" />

          {/* Pinned apps */}
          <div className="flex items-center gap-1">
            {state.dockedIds.map((id, index) => {
              const entry = registry.find((r) => r.id === id);
              if (!entry) return null;
              const active = isActive(id);
              const open = isOpen(id);
              const Icon = APP_ICONS[entry.icon] || APP_ICONS.Network;
              const isDragging = draggingId === id;
              const isDropTarget = dragOverIndex === index;

              return (
                <div key={`pinned-${id}`} className="relative flex items-center">
                  {/* Drop indicator */}
                  {isDropTarget && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-1 h-8 bg-indigo-400 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                  )}
                  <button
                    draggable
                    onClick={() => handleDockClick(id)}
                    onContextMenu={(e) => handleContextMenu(e, id)}
                    onDragStart={(e) => handleDragStart(e, id)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragLeave={handleDragLeave}
                    onDragEnd={() => { setDraggingId(null); setDragOverIndex(null); }}
                    className={`group relative flex items-center justify-center w-11 h-11 rounded-2xl transition-all duration-200 ${
                      active
                        ? "bg-white/15 text-white"
                        : "text-gray-400 hover:text-white hover:bg-white/10"
                    } ${isDragging ? "opacity-40 scale-95" : ""}`}
                    style={appIconTileStyle(entry, { active, elevated: active })}
                    title={entry.name}
                  >
                    <Icon className={`w-5 h-5 transition-transform duration-200 ${active ? "scale-110" : "group-hover:scale-110"}`} />
                    {/* Active indicator dot */}
                    {active && (
                      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ backgroundColor: appIconColor(entry) }} />
                    )}
                    {/* Open but dormant indicator */}
                    {!active && open && (
                      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-gray-500 rounded-full" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Running unpinned apps */}
          {uniqueRunningUnpinned.length > 0 && (
            <>
              <div className="w-px h-7 bg-white/10 mx-1" />
              <div className="flex items-center gap-1">
                {uniqueRunningUnpinned.map((id) => {
                  const entry = registry.find((r) => r.id === id);
                  if (!entry) return null;
                  const active = isActive(id);
                  const Icon = APP_ICONS[entry.icon] || APP_ICONS.Network;

                  return (
                    <button
                      key={`running-${id}`}
                      onClick={() => handleDockClick(id)}
                      onContextMenu={(e) => handleContextMenu(e, id)}
                      className={`group relative flex items-center justify-center w-11 h-11 rounded-2xl transition-all duration-200 ${
                        active
                          ? "bg-white/15 text-white"
                          : "text-gray-400 hover:text-white hover:bg-white/10"
                      }`}
                      style={appIconTileStyle(entry, { active, elevated: active })}
                      title={entry.name}
                    >
                      <Icon className={`w-5 h-5 transition-transform duration-200 ${active ? "scale-110" : "group-hover:scale-110"}`} />
                      {/* Active indicator dot */}
                      {active && (
                        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ backgroundColor: appIconColor(entry) }} />
                      )}
                      {/* Dormant indicator */}
                      {!active && (
                        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-gray-500 rounded-full" />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="w-px h-7 bg-white/10 mx-1 ml-auto" />

          {/* Profile section: Chat + User */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => dispatch({ type: "TOGGLE_RIGHT_PANEL" })}
              className={`group relative flex items-center justify-center w-11 h-11 rounded-2xl transition-all duration-200 ${
                state.rightPanelOpen
                  ? "bg-white/15 text-white"
                  : "text-gray-400 hover:text-white hover:bg-white/10"
              }`}
              title="Chat"
            >
              <MessageSquare className={`w-5 h-5 transition-transform duration-200 ${state.rightPanelOpen ? "scale-110" : "group-hover:scale-110"}`} />
              {state.rightPanelOpen && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-indigo-400 rounded-full shadow-[0_0_6px_rgba(99,102,241,0.6)]" />
              )}
            </button>
            <UserProfileBadge />
          </div>
        </div>
      </div>
    </>
  );
}
