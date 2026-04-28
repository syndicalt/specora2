"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";

export type ReferenceOption = {
  id: string;
  label: string;
  sublabel?: string;
};

type ReferenceTypeaheadProps = {
  disabled?: boolean;
  referenceClass?: string;
  value: string;
  options: ReferenceOption[];
  onChange: (value: string) => void;
  inputClassName?: string;
};

export function ReferenceTypeahead({
  disabled = false,
  referenceClass,
  value,
  options,
  onChange,
  inputClassName = "w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 pr-9 text-sm text-gray-100 outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500",
}: ReferenceTypeaheadProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find((option) => option.id === value);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = needle
      ? options.filter((option) => [option.label, option.sublabel, option.id].some((item) => String(item || "").toLowerCase().includes(needle)))
      : options;
    return matches.slice(0, 50);
  }, [options, search]);
  const displayValue = open ? search : selected ? selected.label : "";
  const placeholder = referenceClass ? `Search ${referenceClass}` : "Search reference";

  function choose(option: ReferenceOption) {
    onChange(option.id);
    setSearch("");
    setOpen(false);
  }

  return (
    <div className="relative">
      <div className="relative">
        <input
          disabled={disabled}
          value={displayValue}
          onFocus={() => {
            setOpen(true);
            setSearch("");
          }}
          onChange={(event) => {
            setOpen(true);
            setSearch(event.target.value);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              setOpen(false);
              setSearch("");
            }, 120);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              setSearch("");
            } else if (event.key === "Enter" && open && filtered[0]) {
              event.preventDefault();
              choose(filtered[0]);
            } else if (event.key === "Backspace" && !open && value) {
              onChange("");
            }
          }}
          placeholder={placeholder}
          className={inputClassName}
        />
        {value && !disabled && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange("");
              setSearch("");
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-gray-200"
            aria-label="Clear reference"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && !disabled && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-700 bg-gray-950 py-1 shadow-xl shadow-black/40">
          {filtered.length > 0 ? filtered.map((option) => (
            <button
              key={option.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-indigo-600/20 ${option.id === value ? "text-indigo-200" : "text-gray-200"}`}
            >
              <div className="truncate">{option.label}</div>
              {option.sublabel && <div className="truncate text-xs text-gray-500">{option.sublabel}</div>}
            </button>
          )) : (
            <div className="px-3 py-3 text-sm text-gray-500">No matching records.</div>
          )}
        </div>
      )}
    </div>
  );
}
