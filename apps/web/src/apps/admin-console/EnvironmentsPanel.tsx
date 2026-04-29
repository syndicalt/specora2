"use client";

import { type Dispatch, type SetStateAction } from "react";
import { Database } from "lucide-react";
import { FieldInput } from "./components";
import type { EnvironmentChoice } from "./types";

export type EnvironmentDraft = {
  code: string;
  name: string;
  active: boolean;
  sortOrder: string;
  isProductionLike: boolean;
};

type EnvironmentSaveInput = EnvironmentDraft;

type EnvironmentsPanelProps = {
  environmentDraft: EnvironmentDraft;
  setEnvironmentDraft: Dispatch<SetStateAction<EnvironmentDraft>>;
  environmentChoices: EnvironmentChoice[];
  setEnvironmentChoices: Dispatch<SetStateAction<EnvironmentChoice[]>>;
  saving: boolean;
  onSave: (input?: EnvironmentSaveInput) => void;
  onDelete: (id: string) => void;
};

export function EnvironmentsPanel({
  environmentDraft,
  setEnvironmentDraft,
  environmentChoices,
  setEnvironmentChoices,
  saving,
  onSave,
  onDelete,
}: EnvironmentsPanelProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="mb-4">
          <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <Database className="h-4 w-4 text-cyan-300" />
            Add environment
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Environment choices appear in CMDB and Tables pickers. Existing discovered string values are still preserved.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px_auto_auto]">
          <FieldInput label="Name" value={environmentDraft.name} onChange={(value) => setEnvironmentDraft((current) => ({ ...current, name: value }))} placeholder="Production" />
          <FieldInput label="Code" value={environmentDraft.code} onChange={(value) => setEnvironmentDraft((current) => ({ ...current, code: value }))} placeholder="production" help="Optional. Generated from name if blank." />
          <FieldInput label="Sort" value={environmentDraft.sortOrder} onChange={(value) => setEnvironmentDraft((current) => ({ ...current, sortOrder: value }))} type="number" />
          <label className="flex items-end gap-2 pb-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={environmentDraft.isProductionLike}
              onChange={(event) => setEnvironmentDraft((current) => ({ ...current, isProductionLike: event.target.checked }))}
              className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
            />
            Production-like
          </label>
          <button
            type="button"
            onClick={() => onSave()}
            disabled={saving || !environmentDraft.name.trim()}
            className="self-end rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-gray-500">
            <tr className="border-b border-gray-800">
              <th className="px-4 py-3">Environment</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Sort</th>
              <th className="px-4 py-3">Flags</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {environmentChoices.map((choice) => (
              <tr key={choice.id} className="border-b border-gray-800/70">
                <td className="px-4 py-3">
                  <input
                    value={choice.name}
                    onChange={(event) => setEnvironmentChoices((current) => current.map((item) => item.id === choice.id ? { ...item, name: event.target.value } : item))}
                    className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-indigo-500"
                  />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-400">{choice.code}</td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    value={choice.sortOrder}
                    onChange={(event) => setEnvironmentChoices((current) => current.map((item) => item.id === choice.id ? { ...item, sortOrder: Number(event.target.value) || 0 } : item))}
                    className="w-24 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-indigo-500"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950 px-2 py-1 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={choice.active}
                        onChange={(event) => setEnvironmentChoices((current) => current.map((item) => item.id === choice.id ? { ...item, active: event.target.checked } : item))}
                        className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
                      />
                      Active
                    </label>
                    <label className="inline-flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950 px-2 py-1 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={choice.isProductionLike}
                        onChange={(event) => setEnvironmentChoices((current) => current.map((item) => item.id === choice.id ? { ...item, isProductionLike: event.target.checked } : item))}
                        className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
                      />
                      Prod-like
                    </label>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onSave({ code: choice.code, name: choice.name, active: choice.active, sortOrder: String(choice.sortOrder), isProductionLike: choice.isProductionLike })}
                      disabled={saving}
                      className="rounded-lg border border-indigo-500/30 px-3 py-2 text-xs text-indigo-100 hover:bg-indigo-500/10 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(choice.id)}
                      disabled={saving}
                      className="rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!environmentChoices.length && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                  No environments configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
