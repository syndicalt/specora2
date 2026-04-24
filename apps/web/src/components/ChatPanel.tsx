"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useShell } from "@/shell/AppContext";
import { ChatOverlay } from "./ChatOverlay";

const MIN_WIDTH = 320;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 420;
const STORAGE_KEY_OPEN = "specora:chatPanelOpen";
const STORAGE_KEY_WIDTH = "specora:chatPanelWidth";

export function ChatPanel() {
  const { state, dispatch } = useShell();
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const saved = localStorage.getItem(STORAGE_KEY_WIDTH);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const [resizing, setResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  // Persist width to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_WIDTH, String(width));
  }, [width]);

  // Persist open state to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_OPEN, String(state.rightPanelOpen));
  }, [state.rightPanelOpen]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      setResizing(true);
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      e.preventDefault();
    },
    [width]
  );

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const delta = startXRef.current - e.clientX;
      const newWidth = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidthRef.current + delta)
      );
      setWidth(newWidth);
      dispatch({ type: "SET_RIGHT_PANEL_WIDTH", width: newWidth });
    };
    const onUp = () => setResizing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing, dispatch]);

  // Global keyboard shortcut: Ctrl+/ to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        dispatch({ type: "TOGGLE_RIGHT_PANEL" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dispatch]);

  if (!state.rightPanelOpen) {
    return null;
  }

  // Expanded state: resizable right panel
  return (
    <div
      className={`shrink-0 h-full flex bg-gray-900 border-l border-gray-800 relative shadow-[-8px_0_32px_rgba(0,0,0,0.4)] ${
        resizing ? "" : "transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
      }`}
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-3 cursor-col-resize z-10 flex items-center justify-center group/handle"
        onMouseDown={handleResizeStart}
      >
        {/* Visible grab line */}
        <div className="w-px h-12 bg-gray-700 group-hover/handle:bg-indigo-500/60 transition-colors rounded-full" />
      </div>

      {/* Chat content */}
      <div className="flex-1 overflow-hidden ml-3">
        <ChatOverlay />
      </div>
    </div>
  );
}
