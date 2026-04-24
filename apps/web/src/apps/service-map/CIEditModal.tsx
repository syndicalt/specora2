"use client";

import { useState } from "react";
import { X } from "lucide-react";

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
  const [attributesJson, setAttributesJson] = useState(
    ci?.attributes ? JSON.stringify(ci.attributes, null, 2) : "{}"
  );
  const [error, setError] = useState("");

  if (!ci) return null;

  const handleSave = () => {
    try {
      const attrs = JSON.parse(attributesJson);
      onSave(ci.id, { name, environment: environment || undefined, attributes: attrs });
    } catch {
      setError("Invalid JSON in attributes field");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-100">Edit Configuration Item</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">ID</label>
            <input
              value={ci.id}
              disabled
              className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-gray-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Class</label>
            <input
              value={ci.class}
              disabled
              className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-gray-500 text-sm"
            />
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

          <div>
            <label className="block text-sm text-gray-400 mb-1">Attributes (JSON)</label>
            <textarea
              value={attributesJson}
              onChange={(e) => { setAttributesJson(e.target.value); setError(""); }}
              rows={5}
              className="w-full px-3 py-2 rounded bg-gray-950 border border-gray-700 text-gray-100 text-sm font-mono focus:outline-none focus:border-indigo-500"
            />
            {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
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
