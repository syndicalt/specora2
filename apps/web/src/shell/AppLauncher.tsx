"use client";

import { useShell } from "./AppContext";
import type { RegistryEntry } from "@/sdk/types";
import { X } from "lucide-react";

export function AppLauncher({ registry }: { registry: RegistryEntry[] }) {
  const { state, dispatch } = useShell();

  if (!state.launcherOpen) return null;

  const openAppIds = new Set(state.instances.map((i) => i.id));

  const handleOpen = (entry: RegistryEntry) => {
    dispatch({
      type: "OPEN_APP",
      id: entry.id,
      installKey: entry.installKey,
      mode: entry.defaultMode,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => dispatch({ type: "CLOSE_LAUNCHER" })}>
      <div
        className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-100">All Apps</h2>
          <button
            onClick={() => dispatch({ type: "CLOSE_LAUNCHER" })}
            className="text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {registry.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>No apps installed</p>
            <p className="text-sm mt-1">Apps can be installed via the Specora SDK</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {registry.map((entry) => {
              const isOpen = openAppIds.has(entry.id);
              return (
                <button
                  key={entry.id}
                  onClick={() => handleOpen(entry)}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl bg-gray-800/50 hover:bg-gray-800 border border-transparent hover:border-gray-600 transition-colors group"
                >
                  <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 group-hover:bg-indigo-500/20 transition-colors">
                    <span className="text-xl font-bold">{entry.icon[0]}</span>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-200">{entry.name}</p>
                    {isOpen && (
                      <span className="text-xs text-indigo-400">Open</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
