"use client";

import { useEffect, useRef } from "react";

interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-[60] min-w-[180px] bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden py-1"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 border-t border-gray-700" />
        ) : (
          <button
            key={i}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={`w-full px-3 py-2 text-left text-sm transition-colors ${
              item.danger
                ? "text-red-400 hover:bg-red-900/20"
                : "text-gray-200 hover:bg-gray-800"
            }`}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
