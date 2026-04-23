import { useEffect } from "react";

export function useKeyboardShortcut(
  key: string,
  callback: (e: KeyboardEvent) => void,
  options?: { ctrl?: boolean; meta?: boolean; shift?: boolean }
) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrlOk = options?.ctrl ? e.ctrlKey || e.metaKey : true;
      const shiftOk = options?.shift ? e.shiftKey : true;
      if (e.key.toLowerCase() === key.toLowerCase() && ctrlOk && shiftOk) {
        e.preventDefault();
        callback(e);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [key, callback, options]);
}
