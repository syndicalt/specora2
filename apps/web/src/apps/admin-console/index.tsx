"use client";

import { useState, useEffect } from "react";
import { getToken } from "@/lib/auth";
import { Shield, Plus, Trash2, Save, Loader2 } from "lucide-react";
import ChangeStateMachinePanel from "@/apps/change-manager/StateMachinePanel";

interface Permission {
  id: string;
  role: string;
  resource: string;
  action: string;
}

interface SystemProperty {
  key: string;
  value: string;
  updated_at: string;
}

interface AdminPanel {
  id: string;
  name: string;
  icon: string;
  permissions: string[];
  appId?: string;
}



const PANEL_COMPONENTS: Record<string, React.ComponentType<{ shell: any }>> = {
  "change-manager-state-machine": ChangeStateMachinePanel,
};

export default function AdminConsoleApp({ shell }: { shell: any }) {
  const [activeTab, setActiveTab] = useState<string>("rbac");
  const [panels, setPanels] = useState<AdminPanel[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [systemProps, setSystemProps] = useState<SystemProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [newRole, setNewRole] = useState("");
  const [newResource, setNewResource] = useState("");
  const [newAction, setNewAction] = useState("");
  const [newPropKey, setNewPropKey] = useState("");
  const [newPropValue, setNewPropValue] = useState("");

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const [permRes, propRes, panelRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/permissions`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/system-properties`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/panels`, { headers: { Authorization: `Bearer ${token || ""}` } }),
      ]);

      if (!permRes.ok) throw new Error("Failed to fetch permissions");
      if (!propRes.ok) throw new Error("Failed to fetch system properties");

      const permData = await permRes.json();
      const propData = await propRes.json();
      const panelData = panelRes.ok ? await panelRes.json() : { panels: [] };

      setPermissions(permData.permissions || []);
      setSystemProps(propData.properties || []);
      setPanels(panelData.panels || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function addPermission(e: React.FormEvent) {
    e.preventDefault();
    if (!newRole || !newResource || !newAction) return;
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({ role: newRole, resource: newResource, action: newAction }),
      });
      if (!res.ok) throw new Error("Failed to add permission");
      setNewRole(""); setNewResource(""); setNewAction("");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deletePermission(id: string) {
    if (!confirm("Delete this permission?")) return;
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/permissions/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      if (!res.ok) throw new Error("Failed to delete permission");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function addSystemProperty(e: React.FormEvent) {
    e.preventDefault();
    if (!newPropKey || !newPropValue) return;
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/system-properties`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({ key: newPropKey, value: newPropValue }),
      });
      if (!res.ok) throw new Error("Failed to add system property");
      setNewPropKey(""); setNewPropValue("");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateSystemProperty(key: string, value: string) {
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/system-properties/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("Failed to update system property");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteSystemProperty(key: string) {
    if (!confirm(`Delete system property "${key}"?`)) return;
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/system-properties/${key}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      if (!res.ok) throw new Error("Failed to delete system property");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const roles = Array.from(new Set(permissions.map((p) => p.role)));

  const renderTabContent = () => {
    if (activeTab === "rbac") {
      return (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Permission
            </h2>
            <form onSubmit={addPermission} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Role</label>
                <input type="text" value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="e.g. operator"
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Resource</label>
                <input type="text" value={newResource} onChange={(e) => setNewResource(e.target.value)} placeholder="e.g. cmdb"
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Action</label>
                <input type="text" value={newAction} onChange={(e) => setNewAction(e.target.value)} placeholder="e.g. write"
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <button type="submit" disabled={saving || !newRole || !newResource || !newAction}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Add
              </button>
            </form>
          </div>
          {roles.map((role) => (
            <div key={role} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800">
                <h3 className="text-sm font-medium text-gray-200 capitalize">{role}</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                    <th className="px-4 py-2 font-medium">Resource</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.filter((p) => p.role === role).map((p) => (
                    <tr key={p.id} className="border-b border-gray-800/50 last:border-0">
                      <td className="px-4 py-2 text-gray-300">{p.resource}</td>
                      <td className="px-4 py-2 text-gray-300">{p.action}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => deletePermission(p.id)} className="text-gray-500 hover:text-red-400 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      );
    }

    if (activeTab === "system-properties") {
      return (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add System Property
            </h2>
            <form onSubmit={addSystemProperty} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Key</label>
                <input type="text" value={newPropKey} onChange={(e) => setNewPropKey(e.target.value)} placeholder="e.g. max_upload_size"
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Value</label>
                <input type="text" value={newPropValue} onChange={(e) => setNewPropValue(e.target.value)} placeholder="e.g. 10485760"
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <button type="submit" disabled={saving || !newPropKey || !newPropValue}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Add
              </button>
            </form>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                  <th className="px-4 py-2 font-medium">Key</th>
                  <th className="px-4 py-2 font-medium">Value</th>
                  <th className="px-4 py-2 font-medium">Updated</th>
                  <th className="px-4 py-2 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody>
                {systemProps.map((prop) => (
                  <SystemPropertyRow key={prop.key} prop={prop} onUpdate={updateSystemProperty} onDelete={deleteSystemProperty} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // Dynamic panel
    const PanelComponent = PANEL_COMPONENTS[activeTab];
    if (PanelComponent) {
      return <PanelComponent shell={shell} />;
    }

    return <div className="text-gray-500 text-center py-12">Unknown panel: {activeTab}</div>;
  };

  const allTabs = [
    { id: "rbac", name: "RBAC", icon: "Shield" },
    { id: "system-properties", name: "System Properties", icon: "Settings" },
    ...panels.map((p) => ({ id: p.id, name: p.name, icon: p.icon })),
  ];

  return (
    <div className="h-full flex flex-col bg-gray-950 text-gray-100">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-indigo-400" />
          <h1 className="text-lg font-semibold">Admin Console</h1>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto">
          {allTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 pb-24">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">{error}</div>
        )}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          </div>
        ) : (
          renderTabContent()
        )}
      </div>
    </div>
  );
}

function SystemPropertyRow({
  prop,
  onUpdate,
  onDelete,
}: {
  prop: SystemProperty;
  onUpdate: (key: string, value: string) => void;
  onDelete: (key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(prop.value);

  return (
    <tr className="border-b border-gray-800/50 last:border-0">
      <td className="px-4 py-2 text-gray-300 font-mono text-xs">{prop.key}</td>
      <td className="px-4 py-2">
        {editing ? (
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => { setEditing(false); if (value !== prop.value) onUpdate(prop.key, value); }}
            onKeyDown={(e) => { if (e.key === "Enter") { setEditing(false); if (value !== prop.value) onUpdate(prop.key, value); } }}
            autoFocus
            className="w-full px-2 py-1 rounded bg-gray-800 border border-indigo-500 text-sm text-gray-200 focus:outline-none"
          />
        ) : (
          <span onClick={() => setEditing(true)} className="text-gray-300 cursor-pointer hover:text-indigo-400 transition-colors">
            {prop.value}
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-gray-500 text-xs">{new Date(prop.updated_at).toLocaleDateString()}</td>
      <td className="px-4 py-2">
        <button onClick={() => onDelete(prop.key)} className="text-gray-500 hover:text-red-400 transition-colors" title="Delete property">
          <Trash2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}
