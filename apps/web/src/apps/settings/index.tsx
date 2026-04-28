"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Palette, Trash2, User } from "lucide-react";
import type { ShellAPI } from "@/sdk/types";
import { applyTheme, DEFAULT_THEME, isThemeId, THEME_OPTIONS, type ThemeId } from "@/lib/themes";

const ME_QUERY = `query { me { id name email preferences } }`;

const UPDATE_PREFS_MUTATION = `
  mutation UpdatePreferences($preferences: JSON!) {
    updatePreferences(preferences: $preferences) { id preferences }
  }
`;

type SettingsUser = {
  id: string;
  email: string;
  name: string;
  preferences?: Record<string, any>;
};

export default function SettingsApp({ shell }: { shell: ShellAPI }) {
  const [user, setUser] = useState<SettingsUser | null>(null);
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [saved, setSaved] = useState(false);
  const [savingTheme, setSavingTheme] = useState<ThemeId | null>(null);

  useEffect(() => {
    let mounted = true;
    shell.query(ME_QUERY).then((data) => {
      if (!mounted) return;
      const nextUser = data?.me || null;
      setUser(nextUser);
      const profileTheme = nextUser?.preferences?.theme;
      setTheme(applyTheme(profileTheme));
    }).catch(() => {
      if (!mounted) return;
      setTheme(applyTheme(null));
    });
    return () => {
      mounted = false;
    };
  }, [shell]);

  async function selectTheme(nextTheme: ThemeId) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
    setSavingTheme(nextTheme);
    setSaved(false);
    try {
      const preferences = { ...(user?.preferences || {}), theme: nextTheme };
      const data = await shell.mutate(UPDATE_PREFS_MUTATION, { preferences: { theme: nextTheme } });
      setUser((current) => current ? { ...current, preferences: data?.updatePreferences?.preferences || preferences } : current);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (error: any) {
      const previousTheme = isThemeId(user?.preferences?.theme) ? user.preferences.theme : DEFAULT_THEME;
      setTheme(applyTheme(previousTheme));
      shell.notify(error?.message || "Theme preference could not be saved", "error");
    } finally {
      setSavingTheme(null);
    }
  }

  const handleClearData = () => {
    if (confirm("This will clear local app data and reload the page. Continue?")) {
      localStorage.clear();
      window.location.reload();
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gray-900 text-gray-100">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-4 py-3">
        <h2 className="text-sm font-semibold">Settings</h2>
        {saved && <span className="text-xs text-green-400">Saved</span>}
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-4 pb-24">
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            <User className="h-3.5 w-3.5" />
            Profile
          </h3>
          <div className="space-y-3 rounded-lg border border-gray-700/50 bg-gray-800/50 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">
                {user?.name?.[0] || "U"}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-200">{user?.name || "User"}</p>
                <p className="truncate text-xs text-gray-500">{user?.email || "-"}</p>
              </div>
            </div>
            <div className="truncate font-mono text-xs text-gray-500">ID: {user?.id || "-"}</div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            <Palette className="h-3.5 w-3.5" />
            Appearance
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {THEME_OPTIONS.map((option) => {
              const selected = option.id === theme;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => selectTheme(option.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    selected
                      ? "border-indigo-400 bg-indigo-500/10"
                      : "border-gray-700/60 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-gray-100">{option.name}</div>
                      <div className="mt-1 text-xs leading-5 text-gray-500">{option.description}</div>
                    </div>
                    <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-indigo-300 text-indigo-200" : "border-gray-700 text-transparent"}`}>
                      <Check className="h-3.5 w-3.5" />
                    </div>
                  </div>
                  <div className="mt-3 flex gap-1.5">
                    {option.swatches.map((swatch) => (
                      <span key={swatch} className="h-4 flex-1 rounded-sm border border-white/10" style={{ backgroundColor: swatch }} />
                    ))}
                  </div>
                  {savingTheme === option.id && <div className="mt-2 text-xs text-gray-500">Saving...</div>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-red-500/80">
            <AlertTriangle className="h-3.5 w-3.5" />
            Danger Zone
          </h3>
          <div className="rounded-lg border border-red-500/20 bg-gray-800/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-gray-300">Clear local data</p>
                <p className="text-xs text-gray-500">Reset local cache and browser-stored tokens</p>
              </div>
              <button
                onClick={handleClearData}
                className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
