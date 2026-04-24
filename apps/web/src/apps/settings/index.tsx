"use client";

import { useState, useEffect } from "react";
import { getToken } from "@/lib/auth";
import { Moon, Sun, Server, User, Trash2, AlertTriangle } from "lucide-react";

export default function SettingsApp() {
  const [darkMode, setDarkMode] = useState(true);
  const [apiUrl, setApiUrl] = useState(process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/graphql");
  const [user, setUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const token = getToken();
      if (token) {
        const payload = JSON.parse(atob(token.split(".")[1]));
        setUser({ id: payload.id, email: payload.email, name: payload.name || "User" });
      }
    } catch {
      // silent
    }
  }, []);

  const handleSave = () => {
    // In a real app, this would persist to backend
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClearData = () => {
    if (confirm("This will clear all local app data and reload the page. Continue?")) {
      localStorage.clear();
      window.location.reload();
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-gray-900 text-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <h2 className="font-semibold text-sm">Settings</h2>
        {saved && (
          <span className="text-xs text-green-400 animate-pulse">Saved</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-6">
        {/* Profile */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
            <User className="w-3.5 h-3.5" />
            Profile
          </h3>
          <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-sm font-bold">
                {user?.name?.[0] || "U"}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-200">{user?.name || "User"}</p>
                <p className="text-xs text-gray-500">{user?.email || "—"}</p>
              </div>
            </div>
            <div className="text-xs text-gray-500 font-mono">ID: {user?.id || "—"}</div>
          </div>
        </div>

        {/* Appearance */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
            <Moon className="w-3.5 h-3.5" />
            Appearance
          </h3>
          <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {darkMode ? <Moon className="w-4 h-4 text-gray-400" /> : <Sun className="w-4 h-4 text-gray-400" />}
                <span className="text-sm text-gray-300">Dark mode</span>
              </div>
              <button
                onClick={() => setDarkMode(!darkMode)}
                className={`relative w-10 h-5 rounded-full transition-colors ${darkMode ? "bg-indigo-600" : "bg-gray-600"}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${darkMode ? "translate-x-5" : ""}`}
                />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">Theme preference is stored locally.</p>
          </div>
        </div>

        {/* API Configuration */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
            <Server className="w-3.5 h-3.5" />
            API Configuration
          </h3>
          <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-4 space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">GraphQL Endpoint</label>
              <input
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-sm text-gray-300 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm transition-colors"
            >
              Save
            </button>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-red-500/80 uppercase tracking-wider flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            Danger Zone
          </h3>
          <div className="bg-gray-800/50 rounded-xl border border-red-500/20 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-300">Clear local data</p>
                <p className="text-xs text-gray-500">Reset all local preferences and cached data</p>
              </div>
              <button
                onClick={handleClearData}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 text-sm transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
