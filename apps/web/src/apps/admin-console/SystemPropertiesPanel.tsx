"use client";

import { type FormEvent } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { SystemPropertyRow, type SystemProperty } from "./components";

type SystemPropertiesPanelProps = {
  newPropKey: string;
  setNewPropKey: (value: string) => void;
  newPropValue: string;
  setNewPropValue: (value: string) => void;
  saving: boolean;
  systemProps: SystemProperty[];
  onAdd: (event: FormEvent) => void;
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
  onUpdate,
  onDelete,
}: SystemPropertiesPanelProps) {
  return (
    <div className="space-y-6">
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
