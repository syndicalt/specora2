"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { REL_COLORS } from "./index";

const REL_TYPES = [
  "PART_OF",
  "DEPENDS_ON",
  "HOSTED_ON",
  "MANAGED_BY",
  "OWNED_BY",
  "LOCATED_AT",
];

interface RelTypePickerProps {
  sourceName: string;
  targetName: string;
  onConfirm: (type: string) => void;
  onCancel: () => void;
}

export function RelTypePicker({ sourceName, targetName, onConfirm, onCancel }: RelTypePickerProps) {
  const [selected, setSelected] = useState("DEPENDS_ON");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-100">Create Relationship</h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 mb-6">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">From:</span>
            <span className="text-gray-200 font-medium">{sourceName}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">To:</span>
            <span className="text-gray-200 font-medium">{targetName}</span>
          </div>
        </div>

        <label className="block text-sm text-gray-400 mb-2">Relationship Type</label>
        <div className="space-y-1 mb-6">
          {REL_TYPES.map((type) => {
            const color = REL_COLORS[type];
            return (
              <button
                key={type}
                onClick={() => setSelected(type)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded text-left text-sm transition-colors ${
                  selected === type
                    ? "bg-gray-800 border border-gray-600"
                    : "text-gray-300 hover:bg-gray-800 border border-transparent"
                }`}
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: color?.stroke || "#6366f1" }}
                />
                <span className={selected === type ? "text-gray-100 font-medium" : ""}>
                  {type}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded text-sm text-gray-300 hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(selected)}
            className="px-4 py-2 rounded text-sm bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
