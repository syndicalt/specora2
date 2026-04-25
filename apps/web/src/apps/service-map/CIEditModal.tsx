"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { graphqlClient } from "@/lib/api";

interface AttrDef {
  name: string;
  displayName: string;
  attrType: string;
  enumValues?: string[];
  referenceClass?: string;
  defaultValue?: string | null;
}

interface CIEditModalProps {
  ci: {
    id: string;
    name: string;
    class: string;
    environment?: string;
    attributes?: Record<string, any>;
  } | null;
  onSave: (id: string, input: { name: string; environment?: string; attributes?: Record<string, any> }) => void;
  onClose: () => void;
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

  useEffect(() => {
    if (!ci) return;
    setName(ci.name);
    setEnvironment(ci.environment || "");
    const initialAttrs = ci.attributes || {};

    graphqlClient
      .request(
        `query($name: String!) {
          ciClass(name: $name) {
            displayName
            attributes { name displayName attrType enumValues referenceClass defaultValue }
          }
        }`,
        { name: ci.class }
      )
      .then((data) => {
        const cls = (data as any).ciClass;
        const defs = ((cls?.attributes || []) as AttrDef[]).sort(
          (a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name)
        );
        setAttrDefs(defs);
        setClassDisplayName(cls?.displayName || ci.class);

        const values: Record<string, any> = {};
        const extra: Record<string, any> = {};
        for (const [k, v] of Object.entries(initialAttrs)) {
          if (defs.some((d) => d.name === k)) {
            values[k] = v;
          } else {
            extra[k] = v;
          }
        }
        // Apply defaults for missing class-defined attrs
        for (const d of defs) {
          if (values[d.name] === undefined && d.defaultValue != null) {
            values[d.name] = d.defaultValue;
          }
        }
        setAttrValues(values);
        setExtraJson(JSON.stringify(extra, null, 2));
        setShowExtra(Object.keys(extra).length > 0);
      })
      .catch(() => {
        setAttrDefs([]);
        setAttrValues(initialAttrs);
        setExtraJson("{}");
      })
      .finally(() => setLoading(false));
  }, [ci?.id, ci?.class]);

  if (!ci) return null;

  const handleSave = () => {
    try {
      const extra = JSON.parse(extraJson);
      const allAttrs = { ...attrValues, ...extra };
      // Remove empty values
      const cleaned: Record<string, any> = {};
      for (const [k, v] of Object.entries(allAttrs)) {
        if (v !== undefined && v !== null && v !== "") cleaned[k] = v;
      }
      onSave(ci.id, { name, environment: environment || undefined, attributes: cleaned });
    } catch {
      // Invalid extra JSON — ignore or alert
      onSave(ci.id, { name, environment: environment || undefined, attributes: attrValues });
    }
  };

  const updateValue = (key: string, val: any) => {
    setAttrValues((prev) => ({ ...prev, [key]: val }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-100">Edit Configuration Item</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Class</label>
              <input value={classDisplayName || ci.class} disabled className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-gray-500 text-sm" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Environment</label>
              <input
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                placeholder="Production, Staging, etc."
                className="w-full px-3 py-2 rounded bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-gray-500 animate-pulse">Loading class schema...</div>
          ) : attrDefs.length > 0 ? (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Attributes</h4>
              {attrDefs.map((def) => (
                <div key={def.name}>
                  <label className="block text-sm text-gray-400 mb-1">
                    {def.displayName || def.name}
                  </label>
                  {def.attrType === "enum" && def.enumValues && def.enumValues.length > 0 ? (
                    <select
                      value={attrValues[def.name] || ""}
                      onChange={(e) => updateValue(def.name, e.target.value)}
                      className="w-full px-3 py-2 rounded bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">—</option>
                      {def.enumValues.map((ev) => (
                        <option key={ev} value={ev}>{ev}</option>
                      ))}
                    </select>
                  ) : def.attrType === "boolean" ? (
                    <select
                      value={String(attrValues[def.name] ?? "")}
                      onChange={(e) => updateValue(def.name, e.target.value === "true")}
                      className="w-full px-3 py-2 rounded bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-indigo-500"
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
                      className="w-full px-3 py-2 rounded bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  ) : def.attrType === "date" ? (
                    <input
                      type="date"
                      value={attrValues[def.name] || ""}
                      onChange={(e) => updateValue(def.name, e.target.value)}
                      className="w-full px-3 py-2 rounded bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  ) : (
                    <input
                      type="text"
                      value={attrValues[def.name] || ""}
                      onChange={(e) => updateValue(def.name, e.target.value)}
                      className="w-full px-3 py-2 rounded bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <div>
            <button
              type="button"
              onClick={() => setShowExtra((s) => !s)}
              className="text-xs text-indigo-400 hover:text-indigo-300 underline"
            >
              {showExtra ? "Hide extra attributes (JSON)" : "Show extra attributes (JSON)"}
            </button>
            {showExtra && (
              <textarea
                value={extraJson}
                onChange={(e) => setExtraJson(e.target.value)}
                rows={4}
                className="w-full mt-2 px-3 py-2 rounded bg-gray-950 border border-gray-700 text-gray-100 text-sm font-mono focus:outline-none focus:border-indigo-500"
              />
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm text-gray-300 hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded text-sm bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
