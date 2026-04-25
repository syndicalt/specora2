"use client";

import { useEffect, useCallback } from "react";
import type { ShellAPI } from "@/sdk/types";

export interface NodeDecorator {
  id: string;
  type: "rfc" | "incident" | "alert";
  count: number;
  severity: "low" | "medium" | "high" | "critical";
}

/**
 * Hook for apps to register node decorators with the Service Map.
 *
 * Usage (in RFC app, Incident app, etc.):
 *
 *   const { updateDecorators } = useServiceMapDecorators(shell, "rfc-app");
 *
 *   // Update decorators for specific nodes
 *   updateDecorators({
 *     "ci-id-1": [{ id: "rfc-app", type: "rfc", count: 2, severity: "high" }],
 *     "ci-id-2": [{ id: "rfc-app", type: "rfc", count: 1, severity: "medium" }],
 *   });
 *
 * If the Service Map app is not installed, this hook silently does nothing.
 */
export function useServiceMapDecorators(shell: ShellAPI, appId: string) {
  // Register on mount
  useEffect(() => {
    shell.sendMessage({
      type: "REGISTER_NODE_DECORATOR",
      to: "service-map",
      payload: { appId, decoratorType: appId, label: appId },
    });
  }, [shell, appId]);

  const updateDecorators = useCallback(
    (decorators: Record<string, NodeDecorator[]>) => {
      shell.sendMessage({
        type: "NODE_DECORATOR_UPDATE",
        to: "service-map",
        payload: { decorators },
      });
    },
    [shell]
  );

  const clearDecorators = useCallback(() => {
    shell.sendMessage({
      type: "CLEAR_NODE_DECORATORS",
      to: "service-map",
      payload: { appId },
    });
  }, [shell, appId]);

  return { updateDecorators, clearDecorators };
}
