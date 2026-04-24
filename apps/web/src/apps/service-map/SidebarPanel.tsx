"use client";

import { useState, useRef, useEffect } from "react";
import { X, GripHorizontal } from "lucide-react";
import { REL_COLORS } from "./index";

interface SidebarPanelProps {
  ci: {
    id: string;
    name: string;
    class: string;
    environment?: string;
    attributes?: Record<string, any>;
    relationships?: {
      id: string;
      type: string;
      target: { id: string; name: string; class: string };
    }[];
  } | null;
  onClose: () => void;
}

export function SidebarPanel({ ci, onClose }: SidebarPanelProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panelStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      setPos({
        x: panelStart.current.x + (e.clientX - dragStart.current.x),
        y: panelStart.current.y + (e.clientY - dragStart.current.y),
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    dragStart.current = { x: e.clientX, y: e.clientY };
    panelStart.current = { x: pos.x, y: pos.y };
    setDragging(true);
  };

  if (!ci) return null;

  const attrs = ci.attributes || {};
  const hasAttrs = Object.keys(attrs).length > 0;

  return (
    <div
      className="absolute z-30 w-72 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
      style={{ top: 80 + pos.y, right: 16 - pos.x }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-gray-800 cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="w-3.5 h-3.5 text-gray-600" />
          <h3 className="font-semibold text-sm text-gray-100 truncate">{ci.name}</h3>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">ID</span>
            <span className="text-gray-300 font-mono text-xs">{ci.id}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Class</span>
            <span className="text-gray-300">{ci.class}</span>
          </div>
          {ci.environment && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Environment</span>
              <span className="text-gray-300">{ci.environment}</span>
            </div>
          )}
        </div>

        {hasAttrs && (
          <>
            <div className="border-t border-gray-800" />
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Attributes</h4>
              <div className="space-y-1">
                {Object.entries(attrs).map(([key, value]) => (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="text-gray-500">{key}</span>
                    <span className="text-gray-300 text-xs">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {ci.relationships && ci.relationships.length > 0 && (
          <>
            <div className="border-t border-gray-800" />
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Relationships ({ci.relationships.length})
              </h4>
              <div className="space-y-1.5">
                {ci.relationships.map((rel) => {
                  const color = REL_COLORS[rel.type];
                  return (
                    <div key={rel.id} className="flex items-center justify-between text-sm">
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          color: color?.stroke || "#6366f1",
                          backgroundColor: color ? `${color.stroke}20` : "rgba(99,102,241,0.12)",
                        }}
                      >
                        {rel.type}
                      </span>
                      <span className="text-gray-300 truncate ml-2">{rel.target.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
