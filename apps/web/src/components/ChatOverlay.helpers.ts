export type ContextChip = {
  key: string;
  label: string;
  detail?: string;
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
  const chips: ContextChip[] = [{ key: "activeApp", label: appLabel(activeApp), detail: "View" }];
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
