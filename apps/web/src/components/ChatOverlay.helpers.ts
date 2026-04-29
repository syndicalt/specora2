export type ContextChip = {
  key: string;
  label: string;
  detail?: string;
};

export type ScreenContext = {
  appId: string;
  appName: string;
  screenName?: string;
  purpose: string;
  primaryActions: string[];
  boundaries?: string[];
  state?: Record<string, string | number | boolean | null | undefined>;
};

export type WorkStep = {
  id: string;
  label: string;
  status: "active" | "completed" | "error";
};

export type PendingApproval = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  risk: "high";
  reason: string;
};

export type ResultCard =
  | {
      id: string;
      type: "ci";
      ci: {
        id: string;
        name: string;
        class?: string;
        environment?: string;
        relationships?: Array<{ type?: string; direction?: string; target?: { id?: string; name?: string; class?: string } }>;
      };
    }
  | {
      id: string;
      type: "service-map";
      rootId: string;
      nodes: Array<{ id: string; name?: string; class?: string }>;
      edges: Array<{ type?: string; sourceId?: string; targetId?: string }>;
    };

export type DisplayChatMessage = {
  role: "user" | "assistant";
  text: string;
  cards?: ResultCard[];
};

export type StoredChatMessage = {
  id?: string;
  role: string;
  content?: string;
  tool_calls?: unknown;
  tool_call_id?: string | null;
  created_at?: string;
};

export function parseActions(text: string) {
  const actionRegex = /\[\[action\|([^|]+)\|([^|]+)\|([^\[\]]+)\]\]/g;
  const actions: { type: string; payload: string; label: string }[] = [];
  let match;
  while ((match = actionRegex.exec(text)) !== null) {
    actions.push({ type: match[1], payload: match[2], label: match[3] });
  }
  const cleanText = text.replace(actionRegex, "").trim();
  return { cleanText, actions };
}

export function appLabel(value: string | undefined) {
  if (!value || value === "none") return "No active app";
  return value
    .replace(/^builtin_/, "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const SCREEN_CONTEXTS: Record<string, Omit<ScreenContext, "appId" | "appName"> & { appName: string }> = {
  "admin-console": {
    appName: "Admin Console",
    purpose: "Governance workspace for platform administration: users, access policy, credentials, identity providers, edge enrollment, environments, number sequences, packages, and system properties.",
    primaryActions: [
      "Manage platform users and roles",
      "Issue and revoke edge enrollment tokens",
      "Review enrolled edge collectors and runtime configuration",
      "Analyze RBAC, app, tool, table, and field access",
      "Manage credentials, identity providers, environments, number sequences, packages, and system properties",
    ],
    boundaries: [
      "It is not the CMDB Explorer, Service Map, Incident Manager, Change Manager, Asset Command Center, Customer Portal, or Knowledge Core workspace.",
      "Do not claim this screen directly browses CIs, handles incidents, manages changes, edits assets, or authors knowledge unless the user opens the corresponding app.",
    ],
  },
  "cmdb-explorer": {
    appName: "CMDB Explorer",
    purpose: "Browse, search, inspect, and steward configuration items and their relationship/data-quality posture.",
    primaryActions: ["Search and filter CIs", "Inspect CI details", "Open related service maps", "Review health/data-quality flags"],
  },
  "service-map": {
    appName: "Service Map",
    purpose: "Visualize CI dependency graphs and service impact paths.",
    primaryActions: ["Set a root CI", "Inspect upstream and downstream dependencies", "Add, edit, or remove relationships", "Open linked CI records"],
  },
  discovery: {
    appName: "Discovery",
    purpose: "Build and run discovery ingestion pipelines from files, samples, and edge collector observations.",
    primaryActions: ["Select discovery sources or runs", "Profile datasets", "Draft and edit mappings", "Preview, approve, and commit staged records"],
  },
  "discovery-insights": {
    appName: "Discovery Insights",
    purpose: "Review discovery coverage, freshness, and evidence quality across CMDB data.",
    primaryActions: ["Analyze coverage gaps", "Review stale or missing discovery evidence", "Prioritize discovery remediation"],
  },
  "health-monitor": {
    appName: "Health Monitor",
    purpose: "Monitor CMDB health rules, quality findings, orphaned CIs, and stale records.",
    primaryActions: ["Review health findings", "Open affected CIs", "Prioritize remediation suggestions", "Track structural quality"],
  },
  "audit-log": {
    appName: "Audit Log",
    purpose: "Review platform audit events and change history.",
    primaryActions: ["Search audit events", "Inspect actor/action metadata", "Verify administrative and CMDB changes"],
  },
  "change-manager": {
    appName: "Change Manager",
    purpose: "Create, review, schedule, approve, and govern change requests.",
    primaryActions: ["Create RFCs", "Assess affected CIs", "Manage approval and state transitions", "Plan implementation and rollback"],
  },
  "incident-manager": {
    appName: "Incident Command Center",
    purpose: "Create, triage, coordinate, and remediate incidents.",
    primaryActions: ["Create incidents", "Run triage", "Draft stakeholder updates", "Track timeline and remediation work"],
  },
  "knowledge-core": {
    appName: "Knowledge Core",
    purpose: "Answer, draft, review, and publish governed operational knowledge.",
    primaryActions: ["Answer from knowledge", "Draft knowledge articles", "Review stewardship queues", "Publish governed content"],
  },
  "prevention-center": {
    appName: "Prevention Center",
    purpose: "Identify recurring operational patterns and convert them into prevention work.",
    primaryActions: ["Detect prevention candidates", "Propose corrective actions", "Create known errors", "Track incident-reduction work"],
  },
  "asset-command": {
    appName: "Asset Command Center",
    purpose: "Manage asset, contract, entitlement, scan, and software-license posture.",
    primaryActions: ["Review asset exceptions", "Ingest contracts and procurement records", "Record scan evidence", "Run SAM reconciliation"],
  },
  "customer-portal": {
    appName: "Customer Portal",
    purpose: "Self-service front door for requests, support, knowledge answers, and escalation.",
    primaryActions: ["Resolve user intent", "Browse/request services", "Submit requests", "Create support handoffs"],
  },
  "engage-agent-workspace": {
    appName: "Engage Agent Workspace",
    purpose: "Agent-facing workspace for support engagement, handoffs, and customer context.",
    primaryActions: ["Review support context", "Coordinate handoffs", "Use chat to draft next steps"],
  },
  reporting: {
    appName: "Reporting",
    purpose: "Build, review, and publish operational reports from platform data.",
    primaryActions: ["Browse report definitions", "Preview report data", "Configure report API surfaces"],
  },
  tables: {
    appName: "Tables",
    purpose: "Browse and edit table-backed platform records with filters, columns, references, and record forms.",
    primaryActions: ["Search tables", "Filter records", "Edit records", "Manage columns and exports"],
  },
  "ci-class-manager": {
    appName: "CI Class Manager",
    purpose: "Define CI classes, fields, reference behavior, reconciliation rules, and class metadata.",
    primaryActions: ["Create and edit CI classes", "Manage fields", "Configure display fields and reconciliation", "Review class schema"],
  },
  "data-foundations": {
    appName: "Data Foundations",
    purpose: "Manage platform reference data and graph relationship foundations.",
    primaryActions: ["Manage relationship types", "Review reference data", "Configure data foundation records"],
  },
  arc: {
    appName: "Specora Arc",
    purpose: "Manage app ecosystem installation, review, and provisioning.",
    primaryActions: ["Browse apps", "Review submissions", "Install or uninstall packages", "Inspect provisioning jobs"],
  },
  settings: {
    appName: "Profile Settings",
    purpose: "Manage personal profile preferences such as theme and account display preferences.",
    primaryActions: ["Change theme", "Review profile metadata", "Manage user preferences"],
  },
};

export function screenContextForApp(activeApp: string, uiContext: Record<string, any>): ScreenContext {
  const dynamic = uiContext.screenContext && typeof uiContext.screenContext === "object" ? uiContext.screenContext : {};
  const appId = String(dynamic.appId || activeApp || "none");
  const base = SCREEN_CONTEXTS[appId] || {
    appName: appLabel(appId),
    purpose: "Active Specora application surface.",
    primaryActions: ["Use the visible app controls", "Ask chat for context-specific guidance"],
  };
  const state = dynamic.state && typeof dynamic.state === "object" ? dynamic.state : undefined;
  return {
    appId,
    appName: String(dynamic.appName || base.appName),
    screenName: dynamic.screenName ? String(dynamic.screenName) : undefined,
    purpose: String(dynamic.purpose || base.purpose),
    primaryActions: Array.isArray(dynamic.primaryActions) && dynamic.primaryActions.length
      ? dynamic.primaryActions.map(String)
      : base.primaryActions,
    boundaries: Array.isArray(dynamic.boundaries) && dynamic.boundaries.length
      ? dynamic.boundaries.map(String)
      : base.boundaries,
    state,
  };
}

export function screenContextLines(activeApp: string, uiContext: Record<string, any>): string[] {
  const context = screenContextForApp(activeApp, uiContext);
  const lines = [
    `Active app/view: ${context.appId}`,
    `Screen: ${context.screenName ? `${context.appName} - ${context.screenName}` : context.appName}`,
    `Screen purpose: ${context.purpose}`,
    `Available screen actions: ${context.primaryActions.join("; ")}`,
  ];
  if (context.boundaries?.length) {
    lines.push(`Screen boundaries: ${context.boundaries.join(" ")}`);
  }
  if (context.state && Object.keys(context.state).length > 0) {
    lines.push(`Screen state: ${Object.entries(context.state).map(([key, value]) => `${key}=${String(value ?? "")}`).join("; ")}`);
  }
  return lines;
}

export function toolLabel(name: string) {
  return name
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function updateWorkStep(steps: WorkStep[], next: WorkStep) {
  const index = steps.findIndex((step) => step.id === next.id);
  if (index === -1) return [...steps, next];
  return steps.map((step, itemIndex) => itemIndex === index ? { ...step, ...next } : step);
}

export function contextChips(uiContext: Record<string, any>, activeApp: string): ContextChip[] {
  const screenContext = screenContextForApp(activeApp, uiContext);
  const chips: ContextChip[] = [{ key: "activeApp", label: screenContext.screenName || screenContext.appName, detail: "View" }];
  if (uiContext.selectedCI) {
    chips.push({
      key: "selectedCI",
      label: uiContext.selectedCI.name || uiContext.selectedCI.id,
      detail: uiContext.selectedCI.class || "Selected CI",
    });
  }
  if (uiContext.selectedRootCI) chips.push({ key: "selectedRootCI", label: uiContext.selectedRootCI, detail: "Service root" });
  if (uiContext.focusedCI) chips.push({ key: "focusedCI", label: uiContext.focusedCI, detail: "Focused CI" });
  return chips.filter((chip, index, list) => list.findIndex((item) => item.key === chip.key && item.label === chip.label) === index);
}

export function followUpPrompts(uiContext: Record<string, any>, activeApp: string) {
  const prompts = [
    { label: "Summarize risks", prompt: "Summarize the top risks and recommended next actions from this answer." },
    { label: "Create an action plan", prompt: "Turn this into a concise action plan with owners, checks, and rollback considerations." },
  ];
  if (uiContext.selectedCI || uiContext.focusedCI || uiContext.selectedRootCI) {
    prompts.unshift(
      { label: "Show relationships", prompt: "Show the important upstream and downstream relationships for the current CI context." },
      { label: "Explain health", prompt: "Explain the health and data quality signals for the current CI context." }
    );
  }
  if (activeApp.includes("service-map")) prompts.unshift({ label: "Impact path", prompt: "Identify the most important impact paths in this service map context." });
  if (activeApp.includes("tables")) prompts.unshift({ label: "Check data quality", prompt: "Review this table context for data quality gaps and recommended cleanup steps." });
  return prompts.slice(0, 4);
}

export function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const elapsed = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return "Just now";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function sanitizeXml(text: string): string {
  if (!text) return text;
  return text
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, "")
    .replace(/<invoke\s+[^>]*>[\s\S]*?<\/invoke>/gi, "")
    .replace(/<result>[\s\S]*?<\/result>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function resultCardForTool(name: string, result: any, idSeed = `${Date.now()}`): ResultCard | null {
  if (!result || typeof result !== "object" || result.error) return null;
  if (name === "get_ci_details" && result.id && result.name) {
    return {
      id: `ci:${result.id}:${idSeed}`,
      type: "ci",
      ci: {
        id: String(result.id),
        name: String(result.name),
        class: result.class ? String(result.class) : undefined,
        environment: result.environment ? String(result.environment) : undefined,
        relationships: Array.isArray(result.relationships) ? result.relationships : [],
      },
    };
  }
  if (name === "get_service_map" && result.rootId && Array.isArray(result.nodes) && Array.isArray(result.edges)) {
    return {
      id: `service-map:${result.rootId}:${idSeed}`,
      type: "service-map",
      rootId: String(result.rootId),
      nodes: result.nodes,
      edges: result.edges,
    };
  }
  return null;
}

export function appendCardToLatestAssistant(messages: DisplayChatMessage[], card: ResultCard): DisplayChatMessage[] {
  let lastAssistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      lastAssistantIndex = index;
      break;
    }
  }
  if (lastAssistantIndex === -1) return [...messages, { role: "assistant", text: "", cards: [card] }];
  return messages.map((message, index) => {
    if (index !== lastAssistantIndex) return message;
    return { ...message, cards: [...(message.cards || []), card] };
  });
}

export function displayMessagesFromStored(messages: StoredChatMessage[]): DisplayChatMessage[] {
  const visibleMessages: DisplayChatMessage[] = [];
  const toolMetadataByCallId = new Map<string, { name: string; messageIndex: number }>();

  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") {
      visibleMessages.push({
        role: message.role as "user" | "assistant",
        text: message.content || "",
      });
    }

    if (message.role === "assistant") {
      const toolCalls = parseMaybeJson(message.tool_calls);
      if (Array.isArray(toolCalls)) {
        const messageIndex = visibleMessages.length - 1;
        for (const call of toolCalls) {
          if (!call || typeof call !== "object") continue;
          const item = call as { id?: unknown; function?: { name?: unknown } };
          if (typeof item.id === "string" && typeof item.function?.name === "string") {
            toolMetadataByCallId.set(item.id, { name: item.function.name, messageIndex });
          }
        }
      }
    }

    if (message.role === "tool" && message.tool_call_id) {
      const metadata = toolMetadataByCallId.get(message.tool_call_id);
      if (!metadata) continue;
      const result = parseMaybeJson(message.content || "");
      const card = resultCardForTool(metadata.name, result, message.id || message.tool_call_id);
      if (card && visibleMessages[metadata.messageIndex]) {
        const visible = visibleMessages[metadata.messageIndex];
        visibleMessages[metadata.messageIndex] = { ...visible, cards: [...(visible.cards || []), card] };
      }
    }
  }

  return visibleMessages;
}

export function resultCardsFromStoredMessages(messages: StoredChatMessage[]): ResultCard[] {
  return displayMessagesFromStored(messages).flatMap((message) => message.cards || []);
}

export function parseSseChunk(chunk: string) {
  const data = chunk
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
