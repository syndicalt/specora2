"use client";

import { useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";

export type SystemProperty = {
  key: string;
  value: string;
  updated_at: string;
};

export type NumberSequence = {
  id: string;
  app_id: string | null;
  table_name: string;
  record_type: string;
  prefix: string;
  next_value: number;
  padding: number;
  enabled: boolean;
};

export function SystemPropertyRow({
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
            onBlur={() => {
              setEditing(false);
              if (value !== prop.value) onUpdate(prop.key, value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setEditing(false);
                if (value !== prop.value) onUpdate(prop.key, value);
              }
            }}
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

export function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  help,
  trailing,
  autoComplete,
  inputName,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  help?: string;
  trailing?: ReactNode;
  autoComplete?: string;
  inputName?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">{label}</label>
      <div className="relative">
        <input
          name={inputName}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          className={`w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none ${trailing ? "pr-10" : ""}`}
        />
        {trailing && <div className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</div>}
      </div>
      {help && <div className="mt-1 text-xs leading-5 text-gray-600">{help}</div>}
    </div>
  );
}

export function ReadOnlyField({ label, value, help, muted = false }: { label: string; value: string; help?: string; muted?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">{label}</label>
      <div className={`w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm ${muted ? "text-gray-600" : "text-indigo-200"}`}>
        {value}
      </div>
      {help && <div className="mt-1 text-xs leading-5 text-gray-600">{help}</div>}
    </div>
  );
}

export function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-900 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-600">{label}</div>
      <div className="mt-1 text-sm font-medium text-gray-200">{value}</div>
    </div>
  );
}

export function FieldSelect({
  label,
  value,
  onChange,
  options,
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  help?: string;
}) {
  const id = `admin-select-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-gray-500">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none"
      >
        {!options.length && <option value="">No registered options</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {help && <div className="mt-1 text-xs leading-5 text-gray-600">{help}</div>}
    </div>
  );
}

export function NumberSequenceRow({ sequence, onUpdate }: { sequence: NumberSequence; onUpdate: (id: string, patch: Partial<NumberSequence>) => void }) {
  return (
    <tr className="border-b border-gray-800/50 last:border-0">
      <td className="px-4 py-2 font-mono text-sm text-indigo-200">{sequence.prefix}</td>
      <td className="px-4 py-2">
        <div className="font-mono text-xs text-gray-300">{sequence.table_name}</div>
        {sequence.app_id && <div className="text-xs text-gray-500">{sequence.app_id}</div>}
      </td>
      <td className="px-4 py-2 text-gray-300">{sequence.record_type}</td>
      <td className="px-4 py-2">
        <input
          type="number"
          min={1}
          value={sequence.next_value}
          onChange={(event) => onUpdate(sequence.id, { next_value: Number(event.target.value) || 1 })}
          className="w-28 rounded bg-gray-800 px-2 py-1 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          min={0}
          value={sequence.padding}
          onChange={(event) => onUpdate(sequence.id, { padding: Number(event.target.value) || 0 })}
          className="w-20 rounded bg-gray-800 px-2 py-1 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </td>
      <td className="px-4 py-2">
        <label className="inline-flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={sequence.enabled}
            onChange={(event) => onUpdate(sequence.id, { enabled: event.target.checked })}
            className="rounded border-gray-700 bg-gray-800 text-indigo-500"
          />
          {sequence.enabled ? "Enabled" : "Disabled"}
        </label>
      </td>
    </tr>
  );
}
