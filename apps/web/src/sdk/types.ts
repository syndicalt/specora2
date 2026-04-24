import type React from "react";

export interface AppManifest {
  id: string;
  name: string;
  icon: string;
  version: string;
  description?: string;
  permissions: string[];
  defaultMode: "canvas" | "window";
  url?: string;
  reactVersion?: string;
  publisher?: string;
}

export interface RegistryEntry extends AppManifest {
  installKey: string;
  source: "built-in" | "external";
  installedAt: number;
  clearDataOnUninstall?: boolean;
}

export interface AppMessage {
  from: string;
  to: string;
  type: string;
  payload?: any;
}

export interface ShellAPI {
  installKey: string;
  appId: string;
  isActive: boolean;
  isDormant: boolean;
  sendMessage: (msg: Omit<AppMessage, "from">) => void;
  onMessage: (handler: (msg: AppMessage) => void) => () => void;
  notify: (message: string, type?: "info" | "success" | "error") => void;
  dispatch: React.Dispatch<any>;
  messageBus: {
    subscribe: (handler: (msg: AppMessage) => void) => () => void;
    publish: (msg: AppMessage) => void;
  };
}
