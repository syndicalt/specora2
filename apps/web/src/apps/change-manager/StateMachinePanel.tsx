"use client";

import { useState, useEffect } from "react";
import { getToken } from "@/lib/auth";
import { getApiBase } from "@/lib/runtimeApi";
import { Save, Plus, Trash2, Loader2, GitBranch } from "lucide-react";

interface Transition {
  from: string;
  to: string;
  roles: string[];
}

interface StateMachineConfig {
  states: string[];
  transitions: Transition[];
}

const DEFAULT_ROLES = ["viewer", "operator", "change_manager", "approver", "admin", "security_admin"];

export default function ChangeStateMachinePanel({ shell: _shell }: { shell: any }) {
  const [config, setConfig] = useState<StateMachineConfig>({ states: [], transitions: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const API_URL = getApiBase();

  useEffect(() => {
    fetchConfig();
  }, []);

  async function fetchConfig() {
    setLoading(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/state-machine/change-manager`, {
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      if (!res.ok) throw new Error("Failed to fetch state machine config");
      const data = await res.json();
      setConfig(data.config || { states: [], transitions: [] });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/state-machine/change-manager`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token || ""}`,
        },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error("Failed to save config");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const addState = () => {
    const name = prompt("New state name (snake_case):");
    if (!name) return;
    if (config.states.includes(name)) {
      setError(`State '${name}' already exists`);
      return;
    }
    setConfig((prev) => ({ ...prev, states: [...prev.states, name] }));
  };

  const removeState = (state: string) => {
    setConfig((prev) => ({
      states: prev.states.filter((s) => s !== state),
      transitions: prev.transitions.filter((t) => t.from !== state && t.to !== state),
    }));
  };

  const addTransition = () => {
    setConfig((prev) => ({
      ...prev,
      transitions: [...prev.transitions, { from: prev.states[0] || "", to: prev.states[1] || "", roles: [] }],
    }));
  };

  const updateTransition = (index: number, field: keyof Transition, value: any) => {
    setConfig((prev) => {
      const transitions = [...prev.transitions];
      transitions[index] = { ...transitions[index], [field]: value };
      return { ...prev, transitions };
    });
  };

  const removeTransition = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      transitions: prev.transitions.filter((_, i) => i !== index),
    }));
  };

  const toggleRole = (index: number, role: string) => {
    setConfig((prev) => {
      const transitions = [...prev.transitions];
      const roles = transitions[index].roles;
      transitions[index] = {
        ...transitions[index],
        roles: roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role],
      };
      return { ...prev, transitions };
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* States */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <GitBranch className="w-4 h-4" /> States
          </h3>
          <button
            onClick={addState}
            className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs transition-colors"
          >
            <Plus className="w-3 h-3" /> Add State
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {config.states.map((state) => (
            <span
              key={state}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-800 text-gray-300 text-sm border border-gray-700"
            >
              {state}
              <button
                onClick={() => removeState(state)}
                className="text-gray-500 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Transitions */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-300">Transitions</h3>
          <button
            onClick={addTransition}
            disabled={config.states.length < 2}
            className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs transition-colors disabled:opacity-50"
          >
            <Plus className="w-3 h-3" /> Add Transition
          </button>
        </div>
        <div className="space-y-3">
          {config.transitions.map((t, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-gray-800/50 border border-gray-800">
              <select
                value={t.from}
                onChange={(e) => updateTransition(i, "from", e.target.value)}
                className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-sm text-gray-200"
              >
                {config.states.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <span className="text-gray-500">→</span>
              <select
                value={t.to}
                onChange={(e) => updateTransition(i, "to", e.target.value)}
                className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-sm text-gray-200"
              >
                {config.states.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <div className="flex-1 flex flex-wrap gap-1">
                {DEFAULT_ROLES.map((role) => (
                  <button
                    key={role}
                    onClick={() => toggleRole(i, role)}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${
                      t.roles.includes(role)
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
              <button
                onClick={() => removeTransition(i)}
                className="text-gray-500 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={saveConfig}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save State Machine
        </button>
      </div>
    </div>
  );
}
