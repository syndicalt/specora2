"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Save, X } from "lucide-react";
import { graphqlClient } from "@/lib/api";
import { CLASS_STYLES } from "./ServiceMapNode";

interface AttrDef {
  name: string;
  displayName: string;
  attrType: string;
  isMandatory?: boolean;
  isHealthRequired?: boolean;
  isKeyAttribute?: boolean;
  enumValues?: string[];
  referenceClass?: string;
  defaultValue?: string | null;
}

type ReferenceOption = {
  id: string;
  label: string;
  sublabel?: string;
};

type ReferenceClassMeta = {
  displayField?: string | null;
  secondaryDisplayFields?: string[];
  attributes?: AttrDef[];
};

interface CIEditModalProps {
  ci: {
    id: string;
    name: string;
    class: string;
    classDisplayName?: string;
    environment?: string;
    attributes?: Record<string, any>;
    health?: { overall: number } | null;
  } | null;
  onSave: (id: string, input: { name: string; environment?: string; attributes?: Record<string, any> }) => void | Promise<void>;
  onClose: () => void;
}

const REFERENCE_OPTIONS_LIMIT = 100;

function cleanAttributes(attrs: Record<string, any>) {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null && value !== "") cleaned[key] = value;
  }
  return cleaned;
}

function displayValueForRecord(record: any, field?: string | null) {
  if (!field) return undefined;
  if (field === "id" || field === "name" || field === "environment" || field === "class") return record[field];
  return record.attributes?.[field] ?? record[field];
}

function firstDisplayValue(record: any, fields: Array<string | null | undefined>) {
  for (const field of fields) {
    const value = displayValueForRecord(record, field);
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
  }
  return undefined;
}

function referenceOptionForCI(meta: ReferenceClassMeta | undefined, record: any): ReferenceOption {
  const attrs = record.attributes || {};
  const keyAttrs = meta?.attributes?.filter((attr) => attr.isKeyAttribute).map((attr) => attr.name) || [];
  const mandatoryStringAttrs = meta?.attributes?.filter((attr) => attr.isMandatory && attr.attrType === "string").map((attr) => attr.name) || [];
  const legacyFields = ["code", "departmentCode", "email"];
  const label = firstDisplayValue(record, [meta?.displayField, "name", ...keyAttrs, ...mandatoryStringAttrs, ...legacyFields, "id"]) || String(record.id);
  const configuredSecondary = (meta?.secondaryDisplayFields || [])
    .map((field) => displayValueForRecord(record, field))
    .filter((item) => item !== undefined && item !== null && String(item).trim() !== "" && String(item) !== label)
    .map((item) => String(item));
  const fallbackSecondary = [attrs.code, attrs.departmentCode, attrs.email, record.environment, record.id]
    .filter((item) => item !== undefined && item !== null && String(item).trim() !== "" && String(item) !== label)
    .map((item) => String(item))[0];
  return {
    id: String(record.id),
    label,
    sublabel: configuredSecondary.length > 0 ? configuredSecondary.join(" | ") : fallbackSecondary,
  };
}

function Section({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-950/30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</span>
        <span className="ml-auto rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">{count}</span>
      </button>
      {open && <div className="space-y-3 border-t border-gray-800 px-4 py-4">{children}</div>}
    </section>
  );
}

function ReferenceTypeahead({
  referenceClass,
  value,
  options,
  onChange,
}: {
  referenceClass?: string;
  value: string;
  options: ReferenceOption[];
  onChange: (value: string) => void;
}) {
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
          className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 pr-9 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
        />
        {value && (
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
      {open && (
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

export function CIEditModal({ ci, onSave, onClose }: CIEditModalProps) {
  const [name, setName] = useState(ci?.name || "");
  const [environment, setEnvironment] = useState(ci?.environment || "");
  const [attrDefs, setAttrDefs] = useState<AttrDef[]>([]);
  const [attrValues, setAttrValues] = useState<Record<string, any>>({});
  const [extraJson, setExtraJson] = useState("{}");
  const [showExtra, setShowExtra] = useState(false);
  const [classDisplayName, setClassDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [jsonError, setJsonError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState("");
  const [referenceOptions, setReferenceOptions] = useState<Record<string, ReferenceOption[]>>({});

  useEffect(() => {
    if (!ci) return;
    setName(ci.name);
    setEnvironment(ci.environment || "");
    setClassDisplayName(ci.classDisplayName || ci.class);
    setLoading(true);
    setSaving(false);
    setJsonError("");
    setSaveError("");
    setSaved(false);
    const initialAttrs = ci.attributes || {};

    graphqlClient
      .request(
        `query($name: String!) {
          ciClass(name: $name) {
            displayName
            attributes {
              name
              displayName
              attrType
              isMandatory
              isHealthRequired
              isKeyAttribute
              enumValues
              referenceClass
              defaultValue
            }
          }
        }`,
        { name: ci.class }
      )
      .then((data) => {
        const cls = (data as any).ciClass;
        const defs = ((cls?.attributes || []) as AttrDef[]).sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));
        const defNames = new Set(defs.map((def) => def.name));
        const values: Record<string, any> = {};
        const extra: Record<string, any> = {};

        for (const [key, value] of Object.entries(initialAttrs)) {
          if (defNames.has(key)) values[key] = value;
          else extra[key] = value;
        }
        for (const def of defs) {
          if (values[def.name] === undefined && def.defaultValue != null) values[def.name] = def.defaultValue;
        }

        setAttrDefs(defs);
        setClassDisplayName(cls?.displayName || ci.classDisplayName || ci.class);
        setAttrValues(values);
        setExtraJson(JSON.stringify(extra, null, 2));
        setShowExtra(Object.keys(extra).length > 0);
        setInitialSnapshot(JSON.stringify({ name: ci.name, environment: ci.environment || "", attributes: cleanAttributes({ ...values, ...extra }) }));
      })
      .catch(() => {
        setAttrDefs([]);
        setAttrValues(initialAttrs);
        setExtraJson("{}");
        setClassDisplayName(ci.classDisplayName || ci.class);
        setInitialSnapshot(JSON.stringify({ name: ci.name, environment: ci.environment || "", attributes: cleanAttributes(initialAttrs) }));
      })
      .finally(() => setLoading(false));
  }, [ci?.id, ci?.class, ci?.classDisplayName]);

  useEffect(() => {
    const classes = Array.from(new Set(attrDefs
      .filter((def) => def.attrType === "reference" && def.referenceClass)
      .map((def) => def.referenceClass!))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    if (classes.length === 0) {
      setReferenceOptions({});
      return;
    }
    let mounted = true;
    Promise.all(classes.map(async (className) => {
      try {
        const data = await graphqlClient.request(
          `query($className: String!, $limit: Int!) {
            ciClass(name: $className) {
              displayField
              secondaryDisplayFields
              attributes {
                name
                displayName
                attrType
                isMandatory
                isKeyAttribute
              }
            }
            cis(filter: { class: $className }, limit: $limit) {
              id
              name
              class
              environment
              attributes
            }
          }`,
          { className, limit: REFERENCE_OPTIONS_LIMIT }
        );
        const cls = (data as any).ciClass as ReferenceClassMeta | undefined;
        const records = Array.isArray((data as any).cis) ? (data as any).cis : [];
        return [className, records.map((record: any) => referenceOptionForCI(cls, record))] as const;
      } catch {
        return [className, []] as const;
      }
    })).then((entries) => {
      if (mounted) setReferenceOptions(Object.fromEntries(entries));
    });
    return () => {
      mounted = false;
    };
  }, [attrDefs]);

  const groupedDefs = useMemo(() => {
    const required = attrDefs.filter((def) => def.isMandatory);
    const requiredNames = new Set(required.map((def) => def.name));
    const key = attrDefs.filter((def) => !requiredNames.has(def.name) && def.isKeyAttribute);
    const keyNames = new Set([...requiredNames, ...key.map((def) => def.name)]);
    const health = attrDefs.filter((def) => !keyNames.has(def.name) && def.isHealthRequired);
    const groupedNames = new Set([...keyNames, ...health.map((def) => def.name)]);
    const additional = attrDefs.filter((def) => !groupedNames.has(def.name));
    return { required, key, health, additional };
  }, [attrDefs]);

  if (!ci) return null;

  let parsedExtra: Record<string, any> = {};
  try {
    parsedExtra = JSON.parse(extraJson || "{}");
  } catch {
    parsedExtra = {};
  }

  const currentSnapshot = JSON.stringify({
    name,
    environment,
    attributes: cleanAttributes({ ...attrValues, ...parsedExtra }),
  });
  const dirty = currentSnapshot !== initialSnapshot;
  const style = CLASS_STYLES[ci.class] || CLASS_STYLES.Group;
  const Icon = style.icon;

  const updateValue = (key: string, val: any) => {
    setSaved(false);
    setSaveError("");
    setAttrValues((prev) => ({ ...prev, [key]: val }));
  };

  const validate = () => {
    for (const def of attrDefs) {
      if (def.isMandatory && (attrValues[def.name] === undefined || attrValues[def.name] === null || attrValues[def.name] === "")) {
        return `${def.displayName || def.name} is required.`;
      }
    }
    try {
      JSON.parse(extraJson || "{}");
      setJsonError("");
      return "";
    } catch {
      setJsonError("Advanced attributes must be valid JSON.");
      return "Advanced attributes must be valid JSON.";
    }
  };

  const handleSave = async () => {
    const error = validate();
    if (error) {
      setSaveError(error);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const extra = JSON.parse(extraJson || "{}");
      const cleaned = cleanAttributes({ ...attrValues, ...extra });
      await onSave(ci.id, { name, environment: environment || undefined, attributes: cleaned });
      setInitialSnapshot(JSON.stringify({ name, environment, attributes: cleaned }));
      setSaved(true);
    } catch {
      setSaveError("Unable to save this CI.");
    } finally {
      setSaving(false);
    }
  };

  const renderField = (def: AttrDef) => (
    <div key={def.name} className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-gray-300">
          {def.displayName || def.name}
          {def.isMandatory && <span className="ml-1 text-red-400">*</span>}
        </label>
        <span className="truncate font-mono text-[10px] text-gray-600">{def.name}</span>
      </div>
      {def.attrType === "enum" && def.enumValues && def.enumValues.length > 0 ? (
        <select
          value={attrValues[def.name] || ""}
          onChange={(e) => updateValue(def.name, e.target.value)}
          className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
        >
          <option value="">—</option>
          {def.enumValues.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
        </select>
      ) : def.attrType === "reference" ? (
        <ReferenceTypeahead
          referenceClass={def.referenceClass}
          value={String(attrValues[def.name] ?? "")}
          options={
            referenceOptions[def.referenceClass || ""]?.some((option) => option.id === String(attrValues[def.name] ?? "")) || !attrValues[def.name]
              ? referenceOptions[def.referenceClass || ""] || []
              : [{ id: String(attrValues[def.name]), label: String(attrValues[def.name]) }, ...(referenceOptions[def.referenceClass || ""] || [])]
          }
          onChange={(value) => updateValue(def.name, value)}
        />
      ) : def.attrType === "boolean" ? (
        <select
          value={String(attrValues[def.name] ?? "")}
          onChange={(e) => updateValue(def.name, e.target.value === "true")}
          className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
        >
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : def.attrType === "number" ? (
        <input
          type="number"
          value={attrValues[def.name] ?? ""}
          onChange={(e) => updateValue(def.name, e.target.value === "" ? undefined : Number(e.target.value))}
          className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
        />
      ) : def.attrType === "date" ? (
        <input
          type="date"
          value={attrValues[def.name] || ""}
          onChange={(e) => updateValue(def.name, e.target.value)}
          className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
        />
      ) : (
        <input
          type="text"
          value={attrValues[def.name] || ""}
          onChange={(e) => updateValue(def.name, e.target.value)}
          className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
        />
      )}
    </div>
  );

  return (
    <aside className="absolute right-0 top-0 z-50 flex h-full w-[420px] flex-col border-l border-gray-800 bg-gray-950 shadow-2xl">
      <header className="shrink-0 border-b border-gray-800 bg-gray-950 px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: style.badgeBg }}>
            <Icon className="h-5 w-5" style={{ color: style.badgeText }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Edit Configuration Item</div>
            <h2 className="mt-1 truncate text-base font-semibold text-gray-100" title={ci.name}>{ci.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md px-2 py-0.5 text-xs" style={{ color: style.badgeText, background: style.badgeBg }}>{classDisplayName || ci.class}</span>
              {ci.environment && <span className="rounded-md bg-gray-800 px-2 py-0.5 text-xs text-gray-300">{ci.environment}</span>}
              <span className="font-mono text-[10px] text-gray-600">{ci.id}</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-800 hover:text-gray-200" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <section className="space-y-3 rounded-lg border border-gray-800 bg-gray-950/30 px-4 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Identity</h3>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">Name</label>
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); setSaved(false); }}
                className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">Class</label>
                <div className="truncate rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-400">{classDisplayName || ci.class}</div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">Environment</label>
                <input
                  value={environment}
                  onChange={(e) => { setEnvironment(e.target.value); setSaved(false); }}
                  placeholder="Production"
                  className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="rounded-lg border border-gray-800 px-4 py-6 text-sm text-gray-500">Loading class schema...</div>
        ) : (
          <>
            <Section title="Required Attributes" count={groupedDefs.required.length}>
              {groupedDefs.required.map(renderField)}
            </Section>
            <Section title="Key Attributes" count={groupedDefs.key.length}>
              {groupedDefs.key.map(renderField)}
            </Section>
            <Section title="Operational Attributes" count={groupedDefs.health.length}>
              {groupedDefs.health.map(renderField)}
            </Section>
            <Section title="Additional Attributes" count={groupedDefs.additional.length} defaultOpen={false}>
              {groupedDefs.additional.map(renderField)}
            </Section>
          </>
        )}

        <section className="rounded-lg border border-gray-800 bg-gray-950/30">
          <button
            type="button"
            onClick={() => setShowExtra((value) => !value)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left"
          >
            {showExtra ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Advanced Attributes</span>
          </button>
          {showExtra && (
            <div className="space-y-2 border-t border-gray-800 px-4 py-4">
              <textarea
                value={extraJson}
                onChange={(e) => {
                  setExtraJson(e.target.value);
                  setSaved(false);
                  setJsonError("");
                }}
                rows={7}
                className={`w-full rounded-md border bg-gray-950 px-3 py-2 font-mono text-xs text-gray-100 focus:outline-none ${
                  jsonError ? "border-red-500 focus:border-red-400" : "border-gray-700 focus:border-indigo-500"
                }`}
              />
              {jsonError && <div className="flex items-center gap-2 text-xs text-red-300"><AlertTriangle className="h-3.5 w-3.5" />{jsonError}</div>}
            </div>
          )}
        </section>

        {saveError && <div className="flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200"><AlertTriangle className="h-4 w-4" />{saveError}</div>}
        {saved && <div className="flex items-center gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200"><Check className="h-4 w-4" />Saved</div>}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-800 bg-gray-950 px-4 py-3">
        <div className="text-xs text-gray-500">{dirty ? "Unsaved changes" : "No changes"}</div>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving || !name.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </footer>
    </aside>
  );
}
