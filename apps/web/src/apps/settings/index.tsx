"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Eye, EyeOff, Lock, Palette, Save, Trash2, User } from "lucide-react";
import type { ShellAPI } from "@/sdk/types";
import { applyTheme, DEFAULT_THEME, isThemeId, THEME_OPTIONS, type ThemeId } from "@/lib/themes";

const ME_QUERY = `query { me { id name email role preferences authMethod canChangePassword passwordChangeRequired } }`;

const UPDATE_PREFS_MUTATION = `
  mutation UpdatePreferences($preferences: JSON!) {
    updatePreferences(preferences: $preferences) { id preferences }
  }
`;

const UPDATE_PROFILE_MUTATION = `
  mutation UpdateProfile($name: String!) {
    updateProfile(name: $name) { id name email role preferences authMethod canChangePassword passwordChangeRequired }
  }
`;

const CHANGE_PASSWORD_MUTATION = `
  mutation ChangePassword($currentPassword: String!, $newPassword: String!) {
    changePassword(currentPassword: $currentPassword, newPassword: $newPassword) {
      id name email role preferences authMethod canChangePassword passwordChangeRequired
    }
  }
`;

type SettingsUser = {
  id: string;
  email: string;
  name: string;
  role?: string;
  authMethod?: string;
  canChangePassword?: boolean;
  passwordChangeRequired?: boolean;
  preferences?: Record<string, any>;
};

function initialsFor(name?: string, email?: string) {
  const source = (name || email || "User").trim();
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || "U";
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <div className="relative mt-1">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 pr-10 text-sm text-gray-100 outline-none transition-colors focus:border-cyan-400"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
}

export default function SettingsApp({ shell }: { shell: ShellAPI }) {
  const [user, setUser] = useState<SettingsUser | null>(null);
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [displayName, setDisplayName] = useState("");
  const [saved, setSaved] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingTheme, setSavingTheme] = useState<ThemeId | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const themeTouchedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    shell.query(ME_QUERY).then((data) => {
      if (!mounted) return;
      const nextUser = data?.me || null;
      setUser(nextUser);
      setDisplayName(nextUser?.name || "");
      const profileTheme = nextUser?.preferences?.theme;
      if (!themeTouchedRef.current) {
        setTheme(applyTheme(profileTheme));
      }
    }).catch(() => {
      if (!mounted) return;
      if (!themeTouchedRef.current) {
        setTheme(applyTheme(null));
      }
    });
    return () => {
      mounted = false;
    };
  }, [shell]);

  async function selectTheme(nextTheme: ThemeId) {
    themeTouchedRef.current = true;
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

  async function saveProfile() {
    const name = displayName.trim();
    if (!name || name === user?.name) return;
    setSavingProfile(true);
    setSaved(false);
    try {
      const data = await shell.mutate(UPDATE_PROFILE_MUTATION, { name });
      const nextUser = data?.updateProfile;
      if (nextUser) {
        setUser(nextUser);
        setDisplayName(nextUser.name || "");
        window.dispatchEvent(new CustomEvent("specora:user-profile-updated", { detail: nextUser }));
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (error: any) {
      shell.notify(error?.message || "Profile could not be saved", "error");
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword() {
    if (!user?.canChangePassword || savingPassword) return;
    if (newPassword.length < 8) {
      shell.notify("New password must be at least 8 characters", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      shell.notify("New password confirmation does not match", "error");
      return;
    }
    setSavingPassword(true);
    setSaved(false);
    try {
      const data = await shell.mutate(CHANGE_PASSWORD_MUTATION, { currentPassword, newPassword });
      const nextUser = data?.changePassword;
      if (nextUser) setUser(nextUser);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
      shell.notify("Password changed", "success");
      window.setTimeout(() => setSaved(false), 2000);
    } catch (error: any) {
      shell.notify(error?.message || "Password could not be changed", "error");
    } finally {
      setSavingPassword(false);
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
                {initialsFor(user?.name, user?.email)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-200">{user?.name || "User"}</p>
                <p className="truncate text-xs text-gray-500">{user?.email || "-"}</p>
              </div>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Display name</span>
              <div className="mt-1 flex gap-2">
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-cyan-400"
                  autoComplete="name"
                />
                <button
                  type="button"
                  onClick={saveProfile}
                  disabled={savingProfile || !displayName.trim() || displayName.trim() === user?.name}
                  className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  Save
                </button>
              </div>
            </label>
            <div className="grid gap-2 text-xs text-gray-500 sm:grid-cols-2">
              <div className="truncate">Role: <span className="text-gray-400">{user?.role || "-"}</span></div>
              <div className="truncate">Sign-in: <span className="text-gray-400">{user?.authMethod || "-"}</span></div>
              <div className="truncate font-mono sm:col-span-2">ID: {user?.id || "-"}</div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            <Lock className="h-3.5 w-3.5" />
            Password
          </h3>
          <div className="space-y-3 rounded-lg border border-gray-700/50 bg-gray-800/50 p-4">
            {user?.canChangePassword ? (
              <>
                {user.passwordChangeRequired && (
                  <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
                    Your administrator requires a password change before continuing.
                  </div>
                )}
                <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
                <PasswordField label="New password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
                <PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
                <button
                  type="button"
                  onClick={changePassword}
                  disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
                  className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {savingPassword ? "Changing..." : "Change password"}
                </button>
              </>
            ) : (
              <div className="text-sm leading-6 text-gray-400">
                Password changes are managed by your identity provider for this account.
              </div>
            )}
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
