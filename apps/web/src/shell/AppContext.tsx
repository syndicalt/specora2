import { createContext, useContext } from "react";
import type { RegistryEntry, AppMessage } from "@/sdk/types";

export type AppMode = "canvas" | "window";

export type AppInstance = {
  id: string;
  instanceId: string;
  installKey: string;
  state: "active" | "dormant";
  mode: AppMode;
  permissions: string[];
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
  rightPanelOpen: boolean;
  rightPanelWidth: number;
};

export type ShellAction =
  | { type: "OPEN_APP"; id: string; installKey: string; mode: AppMode; permissions: string[] }
  | { type: "ACTIVATE_APP"; instanceId: string }
  | { type: "MINIMIZE_APP"; instanceId: string }
  | { type: "CLOSE_APP"; instanceId: string }
  | { type: "TOGGLE_LAUNCHER" }
  | { type: "CLOSE_LAUNCHER" }
  | { type: "PIN_TO_DOCK"; id: string }
  | { type: "UNPIN_FROM_DOCK"; id: string }
  | { type: "REORDER_DOCK"; fromIndex: number; toIndex: number }
  | { type: "SET_DOCK_ORDER"; order: string[] }
  | { type: "FOCUS_WINDOW"; instanceId: string }
  | { type: "MOVE_WINDOW"; instanceId: string; x: number; y: number }
  | { type: "RESIZE_WINDOW"; instanceId: string; width: number; height: number }
  | { type: "SEND_MESSAGE"; message: AppMessage }
  | { type: "NOTIFY"; notification: Notification }
  | { type: "DISMISS_NOTIFICATION"; id: string }
  | { type: "TOGGLE_RIGHT_PANEL" }
  | { type: "SET_RIGHT_PANEL_WIDTH"; width: number };

function getNextZIndex(instances: AppInstance[]): number {
  return Math.max(10, ...instances.map((i) => i.window?.zIndex ?? 0)) + 1;
}

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "OPEN_APP": {
      const existing = state.instances.find((i) => i.id === action.id);
      const nextZ = getNextZIndex(state.instances);
      if (existing) {
        return {
          ...state,
          instances: state.instances.map((i) =>
            i.instanceId === existing.instanceId
              ? { ...i, state: "active" as const, window: i.window ? { ...i.window, zIndex: nextZ, minimized: false } : undefined }
              : i.state === "active" && i.mode === "canvas"
                ? { ...i, state: "dormant" as const }
                : i
          ),
          activeCanvasId: action.mode === "canvas" ? existing.id : state.activeCanvasId,
          focusedWindowId: action.mode === "window" ? existing.instanceId : state.focusedWindowId,
          launcherOpen: false,
        };
      }
      const newInstance: AppInstance = {
        id: action.id,
        instanceId: `${action.id}_${Date.now()}`,
        installKey: action.installKey,
        state: "active",
        mode: action.mode,
        permissions: action.permissions,
        window: action.mode === "window"
          ? { x: 0, y: 0, width: 600, height: 400, zIndex: nextZ, minimized: false }
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
        launcherOpen: false,
      };
    }

    case "ACTIVATE_APP": {
      const target = state.instances.find((i) => i.instanceId === action.instanceId);
      if (!target) return state;
      const nextZ = getNextZIndex(state.instances);
      return {
        ...state,
        instances: state.instances.map((i) => {
          if (i.instanceId === action.instanceId) return { ...i, state: "active" as const, window: i.window ? { ...i.window, zIndex: nextZ, minimized: false } : undefined };
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

    case "REORDER_DOCK": {
      const next = [...state.dockedIds];
      const [moved] = next.splice(action.fromIndex, 1);
      next.splice(action.toIndex, 0, moved);
      return { ...state, dockedIds: next };
    }

    case "SET_DOCK_ORDER":
      return { ...state, dockedIds: action.order };

    case "FOCUS_WINDOW": {
      const nextZ = getNextZIndex(state.instances);
      return {
        ...state,
        focusedWindowId: action.instanceId,
        instances: state.instances.map((i) =>
          i.instanceId === action.instanceId && i.window
            ? { ...i, window: { ...i.window, zIndex: nextZ } }
            : i
        ),
      };
    }

    case "MOVE_WINDOW":
      return {
        ...state,
        instances: state.instances.map((i) =>
          i.instanceId === action.instanceId && i.window
            ? { ...i, window: { ...i.window, x: action.x, y: action.y } }
            : i
        ),
      };

    case "RESIZE_WINDOW":
      return {
        ...state,
        instances: state.instances.map((i) =>
          i.instanceId === action.instanceId && i.window
            ? { ...i, window: { ...i.window, width: action.width, height: action.height } }
            : i
        ),
      };

    case "SEND_MESSAGE":
      return state;

    case "NOTIFY":
      return { ...state, notifications: [...state.notifications, action.notification] };

    case "DISMISS_NOTIFICATION":
      return { ...state, notifications: state.notifications.filter((n) => n.id !== action.id) };

    case "TOGGLE_RIGHT_PANEL":
      return { ...state, rightPanelOpen: !state.rightPanelOpen };

    case "SET_RIGHT_PANEL_WIDTH":
      return { ...state, rightPanelWidth: action.width };

    default:
      return state;
  }
}

export const initialShellState: ShellState = {
  instances: [],
  dockedIds: [],
  activeCanvasId: null,
  launcherOpen: false,
  focusedWindowId: null,
  notifications: [],
  rightPanelOpen: false,
  rightPanelWidth: 420,
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
