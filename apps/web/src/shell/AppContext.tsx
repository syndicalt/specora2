import { createContext, useContext } from "react";
import type { RegistryEntry, AppMessage } from "@/sdk/types";

export type AppMode = "canvas" | "window";

export type AppInstance = {
  id: string;
  instanceId: string;
  installKey: string;
  state: "active" | "dormant";
  mode: AppMode;
  window?: {
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    minimized: boolean;
  };
};

export type Notification = {
  id: string;
  message: string;
  type: "info" | "success" | "error";
};

export type ShellState = {
  instances: AppInstance[];
  dockedIds: string[];
  activeCanvasId: string | null;
  launcherOpen: boolean;
  focusedWindowId: string | null;
  notifications: Notification[];
};

export type ShellAction =
  | { type: "OPEN_APP"; id: string; installKey: string; mode: AppMode }
  | { type: "ACTIVATE_APP"; instanceId: string }
  | { type: "MINIMIZE_APP"; instanceId: string }
  | { type: "CLOSE_APP"; instanceId: string }
  | { type: "TOGGLE_LAUNCHER" }
  | { type: "CLOSE_LAUNCHER" }
  | { type: "PIN_TO_DOCK"; id: string }
  | { type: "UNPIN_FROM_DOCK"; id: string }
  | { type: "FOCUS_WINDOW"; instanceId: string }
  | { type: "SEND_MESSAGE"; message: AppMessage }
  | { type: "NOTIFY"; notification: Notification }
  | { type: "DISMISS_NOTIFICATION"; id: string };

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "OPEN_APP": {
      const existing = state.instances.find((i) => i.id === action.id);
      if (existing) {
        // App already open: activate it
        return {
          ...state,
          instances: state.instances.map((i) =>
            i.instanceId === existing.instanceId
              ? { ...i, state: "active" as const }
              : i.state === "active" && i.mode === "canvas"
                ? { ...i, state: "dormant" as const }
                : i
          ),
          activeCanvasId: action.mode === "canvas" ? existing.id : state.activeCanvasId,
          focusedWindowId: action.mode === "window" ? existing.instanceId : state.focusedWindowId,
          dockedIds: state.dockedIds.includes(action.id) ? state.dockedIds : [...state.dockedIds, action.id],
        };
      }
      const newInstance: AppInstance = {
        id: action.id,
        instanceId: `${action.id}_${Date.now()}`,
        installKey: action.installKey,
        state: "active",
        mode: action.mode,
        window: action.mode === "window"
          ? { x: 0, y: 0, width: 600, height: 400, zIndex: 10, minimized: false }
          : undefined,
      };
      return {
        ...state,
        instances: [
          ...state.instances.map((i) =>
            i.state === "active" && i.mode === "canvas" ? { ...i, state: "dormant" as const } : i
          ),
          newInstance,
        ],
        activeCanvasId: action.mode === "canvas" ? action.id : state.activeCanvasId,
        focusedWindowId: action.mode === "window" ? newInstance.instanceId : state.focusedWindowId,
        dockedIds: state.dockedIds.includes(action.id) ? state.dockedIds : [...state.dockedIds, action.id],
        launcherOpen: false,
      };
    }

    case "ACTIVATE_APP": {
      const target = state.instances.find((i) => i.instanceId === action.instanceId);
      if (!target) return state;
      return {
        ...state,
        instances: state.instances.map((i) => {
          if (i.instanceId === action.instanceId) return { ...i, state: "active" as const, window: i.window ? { ...i.window, minimized: false } : undefined };
          if (i.state === "active" && i.mode === "canvas") return { ...i, state: "dormant" as const };
          return i;
        }),
        activeCanvasId: target.mode === "canvas" ? target.id : state.activeCanvasId,
        focusedWindowId: target.mode === "window" ? target.instanceId : state.focusedWindowId,
      };
    }

    case "MINIMIZE_APP": {
      const target = state.instances.find((i) => i.instanceId === action.instanceId);
      if (!target) return state;
      return {
        ...state,
        instances: state.instances.map((i) =>
          i.instanceId === action.instanceId
            ? { ...i, state: "dormant" as const, window: i.window ? { ...i.window, minimized: true } : undefined }
            : i
        ),
        activeCanvasId: target.mode === "canvas" ? null : state.activeCanvasId,
        focusedWindowId: null,
      };
    }

    case "CLOSE_APP": {
      const target = state.instances.find((i) => i.instanceId === action.instanceId);
      if (!target) return state;
      const nextInstances = state.instances.filter((i) => i.instanceId !== action.instanceId);
      const nextActiveCanvasId = target.mode === "canvas"
        ? (nextInstances.find((i) => i.mode === "canvas")?.id ?? null)
        : state.activeCanvasId;
      return {
        ...state,
        instances: nextInstances,
        activeCanvasId: nextActiveCanvasId,
        focusedWindowId: state.focusedWindowId === action.instanceId ? null : state.focusedWindowId,
      };
    }

    case "TOGGLE_LAUNCHER":
      return { ...state, launcherOpen: !state.launcherOpen };
    case "CLOSE_LAUNCHER":
      return { ...state, launcherOpen: false };

    case "PIN_TO_DOCK":
      return state.dockedIds.includes(action.id)
        ? state
        : { ...state, dockedIds: [...state.dockedIds, action.id] };

    case "UNPIN_FROM_DOCK": {
      const nextDocked = state.dockedIds.filter((id) => id !== action.id);
      return { ...state, dockedIds: nextDocked };
    }

    case "FOCUS_WINDOW":
      return { ...state, focusedWindowId: action.instanceId };

    case "SEND_MESSAGE":
      // Messages are handled via event bus, not stored in state
      return state;

    case "NOTIFY":
      return { ...state, notifications: [...state.notifications, action.notification] };

    case "DISMISS_NOTIFICATION":
      return { ...state, notifications: state.notifications.filter((n) => n.id !== action.id) };

    default:
      return state;
  }
}

export const initialShellState: ShellState = {
  instances: [],
  dockedIds: ["service-map"],
  activeCanvasId: null,
  launcherOpen: false,
  focusedWindowId: null,
  notifications: [],
};

export interface ShellContextValue {
  state: ShellState;
  dispatch: React.Dispatch<ShellAction>;
  registry: RegistryEntry[];
  messageBus: {
    subscribe: (handler: (msg: AppMessage) => void) => () => void;
    publish: (msg: AppMessage) => void;
  };
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within AppShell");
  return ctx;
}
