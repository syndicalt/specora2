"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "./AppContext";
import type { RegistryEntry } from "@/sdk/types";
import { Search, X } from "lucide-react";
import { APP_ICONS } from "@/lib/icons";
import { getUserRole } from "@/lib/auth";
import { filterRegistryByRole } from "./AppAccess";

export function AppLauncher({ registry }: { registry: RegistryEntry[] }) {
  const { state, dispatch } = useShell();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Hooks must be called unconditionally — move the guard after all hooks
  const role = useMemo(() => getUserRole(), []);
  const visibleRegistry = useMemo(
    () => [...filterRegistryByRole(registry, role)].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [registry, role]
  );
  const filteredRegistry = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return visibleRegistry;
    return visibleRegistry.filter((entry) => {
      return [
        entry.name,
        entry.description || "",
        entry.publisher || "",
        entry.id,
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [query, visibleRegistry]);

  const openAppIds = useMemo(
    () => new Set(state.instances.map((i) => i.id)),
    [state.instances]
  );

  useEffect(() => {
    if (!state.launcherOpen) return;
    setQuery("");
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [state.launcherOpen]);

  if (!state.launcherOpen) return null;

  const handleOpen = (entry: RegistryEntry) => {
    dispatch({
      type: "OPEN_APP",
      id: entry.id,
      installKey: entry.installKey,
      mode: entry.defaultMode,
      permissions: entry.permissions,
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 pb-32 pt-6 backdrop-blur-sm" onClick={() => dispatch({ type: "CLOSE_LAUNCHER" })}>
      <div
        className="flex max-h-[calc(100vh-9rem)] w-full max-w-3xl flex-col rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
        data-testid="app-launcher"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">All Apps</h2>
            <p className="text-xs text-gray-500">{filteredRegistry.length} of {visibleRegistry.length} available</p>
          </div>
          <button
            onClick={() => dispatch({ type: "CLOSE_LAUNCHER" })}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
            aria-label="Close app launcher"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="shrink-0 border-b border-gray-800 px-6 py-4">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search applications"
              className="h-10 w-full rounded-lg border border-gray-700 bg-gray-950 pl-9 pr-9 text-sm text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-indigo-500"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200"
                aria-label="Clear application search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
        </div>

        {visibleRegistry.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">
            <p>No apps available</p>
            <p className="text-sm mt-1">Contact your administrator for access</p>
          </div>
        ) : filteredRegistry.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">
            <p>No matching apps</p>
          </div>
        ) : (
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {filteredRegistry.map((entry) => {
                const isOpen = openAppIds.has(entry.id);
                const Icon = APP_ICONS[entry.icon] || APP_ICONS.Network;

                return (
                  <button
                    key={entry.id}
                    data-testid={`app-launcher-item-${entry.id}`}
                    onClick={() => handleOpen(entry)}
                    className="group flex min-h-32 flex-col items-center gap-2 rounded-xl border border-transparent bg-gray-800/50 p-4 transition-colors hover:border-gray-600 hover:bg-gray-800"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 transition-colors group-hover:bg-indigo-500/20">
                      <Icon className="w-6 h-6" />
                    </div>
                    <div className="min-w-0 text-center">
                      <p className="line-clamp-2 text-sm font-medium leading-tight text-gray-200">{entry.name}</p>
                      {isOpen && (
                        <span className="text-xs text-indigo-400">Open</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
