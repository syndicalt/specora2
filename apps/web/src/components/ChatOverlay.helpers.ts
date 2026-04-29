export type ContextChip = {
  key: string;
  label: string;
  detail?: string;
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
