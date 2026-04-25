"use client";

import { useState, useEffect } from "react";
import type { ShellAPI } from "@/sdk/types";
import { getToken } from "@/lib/auth";
import {
  Layers, Plus, Trash2, Save, X, ChevronLeft, GripVertical, AlertTriangle, Shield, Info
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/graphql";

interface Attribute {
  id?: string;
  name: string;
  displayName: string;
  description: string;
  attrType: string;
  isMandatory: boolean;
  isHealthRequired: boolean;
  isKeyAttribute: boolean;
  defaultValue: string;
  validationRegex: string;
  enumValues: string[];
  referenceClass: string;
  sortOrder: number;
}

interface CIClass {
  id: string;
  name: string;
  displayName: string;
  description: string;
  parentClass: string | null;
  icon: string | null;
  color: string | null;
  isSystem: boolean;
  createdByAppId: string | null;
  attributes: Attribute[];
  inheritedAttributes: Attribute[];
}

const ATTR_TYPES = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "enum", label: "Enum" },
  { value: "date", label: "Date" },
  { value: "json", label: "JSON" },
  { value: "reference", label: "Reference" },
];

export default function CIClassManagerApp(_props: { shell: ShellAPI }) {
  const [classes, setClasses] = useState<CIClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "edit" | "create">("list");
  const [editingClass, setEditingClass] = useState<CIClass | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formParent, setFormParent] = useState("");
  const [formIcon, setFormIcon] = useState("Layers");
  const [formColor, setFormColor] = useState("#6366f1");
  const [formAttributes, setFormAttributes] = useState<Attribute[]>([]);

  useEffect(() => {
    fetchClasses();
  }, []);

  async function fetchClasses() {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({
          query: `query {
            ciClasses {
              id name displayName description parentClass icon color isSystem createdByAppId
              attributes { id name displayName attrType isMandatory isHealthRequired isKeyAttribute defaultValue validationRegex enumValues referenceClass sortOrder }
            }
          }`,
        }),
      });
      const data = await res.json();
      if (data.errors) throw new Error(data.errors[0].message);
      setClasses(data.data.ciClasses);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setFormName("");
    setFormDisplayName("");
    setFormDescription("");
    setFormParent("");
    setFormIcon("Layers");
    setFormColor("#6366f1");
    setFormAttributes([]);
  }

  function startCreate() {
    resetForm();
    setMode("create");
    setEditingClass(null);
  }

  function startEdit(cls: CIClass) {
    setFormName(cls.name);
    setFormDisplayName(cls.displayName);
    setFormDescription(cls.description || "");
    setFormParent(cls.parentClass || "");
    setFormIcon(cls.icon || "Layers");
    setFormColor(cls.color || "#6366f1");
    setFormAttributes(cls.attributes.map((a) => ({ ...a })));
    setMode("edit");
    setEditingClass(cls);
  }

  function addAttribute() {
    setFormAttributes((prev) => [
      ...prev,
      {
        name: "",
        displayName: "",
        description: "",
        attrType: "string",
        isMandatory: false,
        isHealthRequired: false,
        isKeyAttribute: false,
        defaultValue: "",
        validationRegex: "",
        enumValues: [],
        referenceClass: "",
        sortOrder: prev.length,
      },
    ]);
  }

  function updateAttribute(index: number, field: keyof Attribute, value: any) {
    setFormAttributes((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function removeAttribute(index: number) {
    setFormAttributes((prev) => prev.filter((_, i) => i !== index));
  }

  function moveAttribute(index: number, direction: "up" | "down") {
    setFormAttributes((prev) => {
      const next = [...prev];
      const swapIndex = direction === "up" ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= next.length) return prev;
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
      return next.map((a, i) => ({ ...a, sortOrder: i }));
    });
  }

  async function save() {
    if (!formName.trim() || !formDisplayName.trim()) {
      setError("Name and Display Name are required");
      return;
    }
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(formName)) {
      setError("Class name must be PascalCase (e.g., MyClass)");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const attrs = formAttributes.map((a) => ({
        name: a.name,
        displayName: a.displayName,
        description: a.description || undefined,
        attrType: a.attrType,
        isMandatory: a.isMandatory,
        isHealthRequired: a.isHealthRequired,
        isKeyAttribute: a.isKeyAttribute,
        defaultValue: a.defaultValue || undefined,
        validationRegex: a.validationRegex || undefined,
        enumValues: a.enumValues.length > 0 ? a.enumValues : undefined,
        referenceClass: a.referenceClass || undefined,
        sortOrder: a.sortOrder,
      }));

      const mutation = mode === "create"
        ? `mutation CreateClass($input: CreateCIClassInput!) { createCIClass(input: $input) { id } }`
        : `mutation UpdateClass($id: ID!, $input: CreateCIClassInput!) { updateCIClass(id: $id, input: $input) { id } }`;

      const variables = mode === "create"
        ? { input: { name: formName, displayName: formDisplayName, description: formDescription, parentClass: formParent || undefined, icon: formIcon, color: formColor, attributes: attrs } }
        : { id: editingClass!.id, input: { name: formName, displayName: formDisplayName, description: formDescription, parentClass: formParent || undefined, icon: formIcon, color: formColor, attributes: attrs } };

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({ query: mutation, variables }),
      });
      const data = await res.json();
      if (data.errors) throw new Error(data.errors[0].message);

      await fetchClasses();
      setMode("list");
      resetForm();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteClass(cls: CIClass) {
    if (!confirm(`Delete class "${cls.name}"? This cannot be undone.`)) return;
    try {
      const token = getToken();
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({
          query: `mutation DeleteClass($id: ID!) { deleteCIClass(id: $id) }`,
          variables: { id: cls.id },
        }),
      });
      const data = await res.json();
      if (data.errors) throw new Error(data.errors[0].message);
      await fetchClasses();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (mode === "list") {
    return (
      <div className="h-full flex flex-col bg-gray-950 text-gray-100">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <Layers className="w-5 h-5 text-indigo-400" />
            <h1 className="text-lg font-semibold">CI Class Manager</h1>
          </div>
          <button
            onClick={startCreate}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New Class
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 px-4 py-3 bg-red-900/30 border border-red-800 rounded-lg flex items-center gap-2 text-red-300 text-sm">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>
          ) : (
            <div className="space-y-2">
              {classes.map((cls) => (
                <div
                  key={cls.id}
                  className="flex items-center gap-4 px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-700 transition-colors"
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: cls.color ? `${cls.color}20` : "#374151", color: cls.color || "#9ca3af" }}
                  >
                    {cls.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-100">{cls.displayName}</span>
                      <span className="text-xs text-gray-500 font-mono">{cls.name}</span>
                      {cls.isSystem && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-900/30 text-amber-400 border border-amber-800">
                          <Shield className="w-3 h-3" /> System
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {cls.attributes.length} attributes
                      {cls.parentClass && ` · extends ${cls.parentClass}`}
                      {cls.createdByAppId && ` · created by ${cls.createdByAppId}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startEdit(cls)}
                      className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 rounded transition-colors"
                    >
                      Edit
                    </button>
                    {!cls.isSystem && (
                      <button
                        onClick={() => deleteClass(cls)}
                        className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Edit / Create mode
  return (
    <div className="h-full flex flex-col bg-gray-950 text-gray-100">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <button onClick={() => { setMode("list"); resetForm(); }} className="p-1.5 hover:bg-gray-800 rounded transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold">{mode === "create" ? "New CI Class" : `Edit ${editingClass?.name}`}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setMode("list"); resetForm(); }}
            className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-900/30 border border-red-800 rounded-lg flex items-center gap-2 text-red-300 text-sm">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Basic Info */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-medium text-gray-300 flex items-center gap-2">
              <Info className="w-4 h-4" /> Basic Information
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="PascalCaseName"
                  disabled={mode === "edit" && editingClass?.isSystem}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Display Name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  placeholder="Human readable name"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Description</label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="What this class represents..."
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Parent Class</label>
                <select
                  value={formParent}
                  onChange={(e) => setFormParent(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                >
                  <option value="">None</option>
                  {classes.filter((c) => c.name !== formName).map((c) => (
                    <option key={c.name} value={c.name}>{c.displayName}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Icon</label>
                  <input
                    type="text"
                    value={formIcon}
                    onChange={(e) => setFormIcon(e.target.value)}
                    placeholder="Lucide icon name"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Color</label>
                  <input
                    type="color"
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    className="w-12 h-9 bg-gray-800 border border-gray-700 rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Attributes */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                <Layers className="w-4 h-4" /> Attributes ({formAttributes.length})
              </h2>
              <button
                onClick={addAttribute}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Attribute
              </button>
            </div>

            <div className="space-y-3">
              {formAttributes.map((attr, idx) => (
                <div key={idx} className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-gray-600" />
                    <span className="text-xs text-gray-500 font-mono">#{idx + 1}</span>
                    <div className="flex-1" />
                    <button
                      onClick={() => moveAttribute(idx, "up")}
                      disabled={idx === 0}
                      className="p-1 text-gray-500 hover:text-gray-300 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveAttribute(idx, "down")}
                      disabled={idx === formAttributes.length - 1}
                      className="p-1 text-gray-500 hover:text-gray-300 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => removeAttribute(idx)}
                      className="p-1 text-gray-500 hover:text-red-400"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Name</label>
                      <input
                        type="text"
                        value={attr.name}
                        onChange={(e) => updateAttribute(idx, "name", e.target.value)}
                        placeholder="camelCase"
                        className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Display</label>
                      <input
                        type="text"
                        value={attr.displayName}
                        onChange={(e) => updateAttribute(idx, "displayName", e.target.value)}
                        placeholder="Human readable"
                        className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Type</label>
                      <select
                        value={attr.attrType}
                        onChange={(e) => updateAttribute(idx, "attrType", e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500"
                      >
                        {ATTR_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Type-specific fields */}
                  {attr.attrType === "enum" && (
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Enum Values (comma-separated)</label>
                      <input
                        type="text"
                        value={attr.enumValues.join(", ")}
                        onChange={(e) => updateAttribute(idx, "enumValues", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
                        placeholder="value1, value2, value3"
                        className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}
                  {attr.attrType === "reference" && (
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Reference Class</label>
                      <select
                        value={attr.referenceClass}
                        onChange={(e) => updateAttribute(idx, "referenceClass", e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500"
                      >
                        <option value="">Select class...</option>
                        {classes.map((c) => (
                          <option key={c.name} value={c.name}>{c.displayName}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {attr.attrType === "string" && (
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Validation Regex (optional)</label>
                      <input
                        type="text"
                        value={attr.validationRegex}
                        onChange={(e) => updateAttribute(idx, "validationRegex", e.target.value)}
                        placeholder="^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$"
                        className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-4 pt-1">
                    <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={attr.isMandatory}
                        onChange={(e) => updateAttribute(idx, "isMandatory", e.target.checked)}
                        className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
                      />
                      Mandatory
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={attr.isHealthRequired}
                        onChange={(e) => updateAttribute(idx, "isHealthRequired", e.target.checked)}
                        className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
                      />
                      Health Required
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={attr.isKeyAttribute}
                        onChange={(e) => updateAttribute(idx, "isKeyAttribute", e.target.checked)}
                        className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
                      />
                      Key Attribute
                    </label>
                  </div>
                </div>
              ))}
              {formAttributes.length === 0 && (
                <div className="text-center py-8 text-gray-500 text-sm">No attributes defined yet. Click "Add Attribute" to start.</div>
              )}
            </div>
          </div>

          {/* Preview */}
          {formName && formDisplayName && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-medium text-gray-300 mb-3">Preview</h2>
              <div
                className="inline-flex items-center gap-3 px-4 py-3 rounded-lg border"
                style={{ borderColor: formColor, background: `${formColor}10` }}
              >
                <div
                  className="w-8 h-8 rounded flex items-center justify-center text-xs font-bold"
                  style={{ background: `${formColor}30`, color: formColor }}
                >
                  {formName.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="font-medium text-gray-100">{formDisplayName}</div>
                  <div className="text-xs text-gray-500">{formName} · {formAttributes.length} attributes</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
