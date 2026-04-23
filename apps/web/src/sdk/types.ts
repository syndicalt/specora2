export interface AppManifest {
  id: string;
  name: string;
  icon: string;
  version: string;
  permissions: string[];
  defaultMode: "canvas" | "window";
}

export interface RegistryEntry extends AppManifest {
  installKey: string;
  source: "built-in" | "external";
  installedAt: number;
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
}
