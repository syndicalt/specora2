"use client";

import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { FieldInput, FieldSelect, NumberSequenceRow, type NumberSequence } from "./components";
import type { NumberSequenceOption } from "./types";

type NewNumberSequenceDraft = {
  appId: string;
  tableName: string;
  recordType: string;
  prefix: string;
  nextValue: string;
  padding: string;
};

type NumberSequencesPanelProps = {
  newSequence: NewNumberSequenceDraft;
  setNewSequence: Dispatch<SetStateAction<NewNumberSequenceDraft>>;
  saving: boolean;
  appOptions: [string, string][];
  tableOptions: NumberSequenceOption[];
  recordTypeOptions: NumberSequenceOption[];
  availableSequenceOptions: NumberSequenceOption[];
  numberSequences: NumberSequence[];
  canAddSequence: boolean;
  onAdd: (event: FormEvent) => void;
  onSelectApp: (appId: string) => void;
  onSelectTable: (tableName: string) => void;
  onSelectRecordType: (recordType: string) => void;
  onUpdate: (id: string, patch: Partial<NumberSequence>) => void;
};

export function NumberSequencesPanel({
  newSequence,
  setNewSequence,
  saving,
  appOptions,
  tableOptions,
  recordTypeOptions,
  availableSequenceOptions,
  numberSequences,
  canAddSequence,
  onAdd,
  onSelectApp,
  onSelectTable,
  onSelectRecordType,
  onUpdate,
}: NumberSequencesPanelProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-300">
          <Plus className="h-4 w-4" /> Register Sequence
        </h2>
        <form onSubmit={onAdd} className="grid grid-cols-[1fr_1fr_1fr_120px_90px_90px_auto] items-end gap-3">
          <FieldSelect
            label="App"
            value={newSequence.appId}
            onChange={onSelectApp}
            options={appOptions.map(([value, label]) => ({ value, label }))}
          />
          <FieldSelect
            label="Table"
            value={newSequence.tableName}
            onChange={onSelectTable}
            options={tableOptions.map((option) => ({ value: option.tableName, label: option.tableName }))}
          />
          <FieldSelect
            label="Record Type"
            value={newSequence.recordType}
            onChange={onSelectRecordType}
            options={recordTypeOptions.map((option) => ({ value: option.recordType, label: option.recordType }))}
          />
          <FieldInput
            label="Prefix"
            value={newSequence.prefix}
            onChange={(value) => setNewSequence((sequence) => ({ ...sequence, prefix: value.toUpperCase() }))}
            placeholder="INC"
          />
          <FieldInput label="Next" value={newSequence.nextValue} onChange={(value) => setNewSequence((sequence) => ({ ...sequence, nextValue: value }))} type="number" />
          <FieldInput label="Padding" value={newSequence.padding} onChange={(value) => setNewSequence((sequence) => ({ ...sequence, padding: value }))} type="number" />
          <button
            type="submit"
            disabled={saving || !canAddSequence}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Add
          </button>
        </form>
        {!availableSequenceOptions.length && (
          <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-400">
            All registered counter-capable app records already have number sequences.
          </div>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="px-4 py-2 font-medium">Prefix</th>
              <th className="px-4 py-2 font-medium">Table</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Next</th>
              <th className="px-4 py-2 font-medium">Padding</th>
              <th className="px-4 py-2 font-medium">Enabled</th>
            </tr>
          </thead>
          <tbody>
            {numberSequences.map((sequence) => (
              <NumberSequenceRow key={sequence.id} sequence={sequence} onUpdate={onUpdate} />
            ))}
            {!numberSequences.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                  No number sequences are registered yet. Register one from the platform-owned app/table/type list above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
