"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { SystemPropertyRow, type SystemProperty } from "./components";
import { DEFAULT_PASSWORD_POLICY, normalizePasswordPolicy, type PasswordPolicy } from "@/lib/passwordPolicy";

type SystemPropertiesPanelProps = {
  newPropKey: string;
  setNewPropKey: (value: string) => void;
  newPropValue: string;
  setNewPropValue: (value: string) => void;
  saving: boolean;
  systemProps: SystemProperty[];
  onAdd: (event: FormEvent) => void;
  onUpsert: (key: string, value: string) => void;
  onUpdate: (key: string, value: string) => void;
  onDelete: (key: string) => void;
};

export function SystemPropertiesPanel({
  newPropKey,
  setNewPropKey,
  newPropValue,
  setNewPropValue,
  saving,
  systemProps,
  onAdd,
  onUpsert,
  onUpdate,
  onDelete,
}: SystemPropertiesPanelProps) {
  const storedPasswordPolicy = useMemo(() => {
    const raw = systemProps.find((prop) => prop.key === "security.password_policy")?.value;
    if (!raw) return DEFAULT_PASSWORD_POLICY;
    try {
      return normalizePasswordPolicy(JSON.parse(raw));
    } catch {
      return DEFAULT_PASSWORD_POLICY;
    }
  }, [systemProps]);
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicy>(storedPasswordPolicy);

  useEffect(() => {
    setPasswordPolicy(storedPasswordPolicy);
  }, [storedPasswordPolicy]);

  function savePasswordPolicy() {
    onUpsert("security.password_policy", JSON.stringify(passwordPolicy));
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-gray-300">Password Policy</h2>
            <p className="mt-1 text-sm text-gray-500">
              Applies to local password changes, first-login password rotation, registration, and admin-created temporary passwords.
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={savePasswordPolicy}
            className="flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-cyan-400 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save policy
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs text-gray-500">Minimum length</span>
            <input
              type="number"
              min={8}
              max={128}
              value={passwordPolicy.minLength}
              onChange={(event) => setPasswordPolicy((current) => ({ ...current, minLength: Number(event.target.value) || 8 }))}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-cyan-400 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-500">Maximum length</span>
            <input
              type="number"
              min={8}
              max={256}
              value={passwordPolicy.maxLength}
              onChange={(event) => setPasswordPolicy((current) => ({ ...current, maxLength: Number(event.target.value) || 128 }))}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-cyan-400 focus:outline-none"
            />
          </label>
          <div className="grid gap-2 rounded-lg border border-gray-800 bg-gray-950 p-3">
            {[
              ["requireNumber", "Require number"],
              ["requireSymbol", "Require symbol"],
              ["requireUppercase", "Require uppercase"],
              ["requireLowercase", "Require lowercase"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={Boolean(passwordPolicy[key as keyof PasswordPolicy])}
                  onChange={(event) => setPasswordPolicy((current) => ({ ...current, [key]: event.target.checked }))}
                  className="h-4 w-4 accent-cyan-400"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-300">
          <Plus className="h-4 w-4" /> Add System Property
        </h2>
        <form onSubmit={onAdd} className="flex items-end gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-gray-500">Key</label>
            <input
              type="text"
              value={newPropKey}
              onChange={(event) => setNewPropKey(event.target.value)}
              placeholder="e.g. max_upload_size"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-gray-500">Value</label>
            <input
              type="text"
              value={newPropValue}
              onChange={(event) => setNewPropValue(event.target.value)}
              placeholder="e.g. 10485760"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={saving || !newPropKey || !newPropValue}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Add
          </button>
        </form>
      </div>
      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="px-4 py-2 font-medium">Key</th>
              <th className="px-4 py-2 font-medium">Value</th>
              <th className="px-4 py-2 font-medium">Updated</th>
              <th className="w-16 px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {systemProps.map((prop) => (
              <SystemPropertyRow key={prop.key} prop={prop} onUpdate={onUpdate} onDelete={onDelete} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
