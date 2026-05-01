import type React from "react";

export type JSONSchemaType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "integer";

export interface JSONSchemaProperty {
  type: JSONSchemaType;
  description?: string;
  enum?: (string | number | boolean)[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface ChatToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
  };
}

export interface ChatCapability {
  id: string;
  label: string;
  description: string;
  prompt: string;
  icon?: string;
}

export interface AdminPanelDefinition {
  id: string;
  name: string;
  icon: string;
  permissions: string[];
}

export interface AppManifest {
  id: string;
  name: string;
  icon: string;
  iconColor?: string;
  version: string;
  description?: string;
  permissions: string[];
  defaultMode: "canvas" | "window";
  url?: string;
  reactVersion?: string;
  publisher?: string;
  chatTools?: ChatToolDefinition[];
  chatCapabilities?: ChatCapability[];
  events?: string[];
  adminPanels?: AdminPanelDefinition[];
  packageId?: string;
  packageName?: string;
  premium?: boolean;
  entitlementMode?: "included" | "trial" | "paid" | "placeholder";
  bundledWithPlatform?: boolean;
  installStatus?: "available" | "installed" | "installing" | "uninstalling" | "failed" | "uninstalled";
  provisioningJobId?: string;
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

export type EventHandler = (payload: Record<string, unknown>) => void;

export interface ShellAPI {
  installKey: string;
  appId: string;
  isActive: boolean;
  isDormant: boolean;
  launchPayload?: unknown;
  sendMessage: (msg: Omit<AppMessage, "from">) => void;
  onMessage: (handler: (msg: AppMessage) => void) => () => void;
  notify: (message: string, type?: "info" | "success" | "error") => void;
  runChatPrompt: (prompt: string, options?: { autoSend?: boolean }) => void;
  query: (query: string, variables?: Record<string, unknown>) => Promise<any>;
  mutate: (mutation: string, variables?: Record<string, unknown>) => Promise<any>;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  dispatch: React.Dispatch<any>;
  messageBus: {
    subscribe: (handler: (msg: AppMessage) => void) => () => void;
    publish: (msg: AppMessage) => void;
  };
  eventBus: {
    subscribe: (type: string, handler: EventHandler) => () => void;
    connected: boolean;
  };
}
