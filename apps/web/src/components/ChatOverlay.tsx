"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/auth";
import { getApiBase } from "@/lib/runtimeApi";
import { useShell } from "@/shell/AppContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Calendar, Check, ChevronDown, ChevronRight, Clipboard, Clock, Compass, Plus, RotateCcw, Search, Send, Sparkles, Square, Trash2, X } from "lucide-react";
import { contextChips, followUpPrompts, formatSessionTime, parseActions, sanitizeXml } from "./ChatOverlay.helpers";

const API_URL = getApiBase();

const STARTER_PROMPTS = [
  { label: "Investigate a CI", prompt: "Help me investigate the currently selected CI and summarize risk, relationships, and recommended next steps." },
  { label: "Explain this screen", prompt: "Explain what I am looking at and what actions are available from this app." },
  { label: "Map service impact", prompt: "Help me understand service impact for the current CI or service map context." },
  { label: "Draft remediation", prompt: "Draft a remediation plan using the current platform context." },
];

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface Session {
  id: string;
  title: string;
  updated_at: string;
}

interface Capability {
  id: string;
  label: string;
  description: string;
  prompt: string;
  icon?: string;
}

interface AppCapabilityGroup {
  appId: string;
  appName: string;
  capabilities: Capability[];
}

type WorkStep = {
  id: string;
  label: string;
  status: "active" | "completed" | "error";
};

type PendingApproval = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  risk: "high";
  reason: string;
};

function DatePickerWidget({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dateRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return;
    const formatted = time ? `${date}T${time}` : date;
    onSubmit(formatted);
  };

  return (
    <div className="mt-2 p-3 rounded-xl bg-gray-950 border border-gray-700/60 shadow-lg max-w-sm">
      <p className="text-xs text-gray-400 mb-2 font-medium">Pick a date and time</p>
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
          <input
            ref={dateRef}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
            required
          />
        </div>
        <div className="relative flex-1 min-w-0">
          <Clock className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <button
          type="submit"
          disabled={!date}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors disabled:opacity-50 shrink-0"
        >
          Confirm
        </button>
      </form>
    </div>
  );
}

function toolLabel(name: string) {
  return name
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function updateWorkStep(steps: WorkStep[], next: WorkStep) {
  const index = steps.findIndex((step) => step.id === next.id);
  if (index === -1) return [...steps, next];
  return steps.map((step, itemIndex) => itemIndex === index ? { ...step, ...next } : step);
}

function WorkingTrace({ steps }: { steps: WorkStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="rounded-2xl rounded-bl-md border border-gray-800 bg-gray-900/80 px-3 py-2 text-xs text-gray-400">
      <div className="mb-1.5 flex items-center gap-2 font-medium text-gray-300">
        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300" />
        Working steps
      </div>
      <div className="space-y-1">
        {steps.map((step) => (
          <div key={step.id} className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${step.status === "completed" ? "bg-emerald-300" : step.status === "error" ? "bg-red-300" : "bg-cyan-300"}`} />
            <span className={step.status === "active" ? "text-gray-200" : "text-gray-500"}>{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApprovalCard({
  approval,
  onApprove,
  onCancel,
}: {
  approval: PendingApproval;
  onApprove: (approval: PendingApproval) => void;
  onCancel: (id: string) => void;
}) {
  const visibleArgs = Object.entries(approval.arguments)
    .filter(([key]) => !key.startsWith("_"))
    .slice(0, 4);
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-amber-300">Approval Required</div>
          <div className="mt-1 font-medium text-amber-50">{toolLabel(approval.name)}</div>
        </div>
        <span className="rounded-full bg-amber-400/15 px-2 py-1 text-[11px] font-semibold uppercase text-amber-200">{approval.risk} risk</span>
      </div>
      <p className="text-xs leading-5 text-amber-100/80">{approval.reason}</p>
      {visibleArgs.length > 0 && (
        <div className="mt-2 rounded-xl border border-amber-400/20 bg-gray-950/50 p-2">
          {visibleArgs.map(([key, value]) => (
            <div key={key} className="flex gap-2 text-xs">
              <span className="w-24 shrink-0 text-amber-300/70">{key}</span>
              <span className="min-w-0 truncate text-amber-50/90">{typeof value === "string" ? value : JSON.stringify(value)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onCancel(approval.id)}
          className="rounded-lg border border-amber-400/20 px-3 py-1.5 text-xs text-amber-100/80 transition-colors hover:bg-amber-400/10"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onApprove(approval)}
          className="rounded-lg bg-amber-300 px-3 py-1.5 text-xs font-medium text-gray-950 transition-colors hover:bg-amber-200"
        >
          Approve
        </button>
      </div>
    </div>
  );
}

function parseSseChunk(chunk: string) {
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

export function ChatOverlay() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: "Welcome to Specora. How can I help you today?" },
  ]);
  const [input, setInput] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [capabilityGroups, setCapabilityGroups] = useState<AppCapabilityGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const shell = useShell();
  const [uiContext, setUiContext] = useState<Record<string, any>>({});
  const [forceDatePicker, setForceDatePicker] = useState(false);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [workSteps, setWorkSteps] = useState<WorkStep[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const doSendRef = useRef<(text: string, options?: { approvedToolNames?: string[] }) => Promise<void>>(async () => {});
  const activeApp = shell.state.activeCanvasId || shell.state.focusedWindowId || uiContext.activeApp || "none";
  const chips = contextChips(uiContext, activeApp);
  const followUps = followUpPrompts(uiContext, activeApp);
  const filteredSessions = sessions.filter((session) => session.title.toLowerCase().includes(sessionQuery.trim().toLowerCase()));

  // Auto-focus input on mount (panel opened) and when session changes
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [sessionId]);

  // Refocus after loading completes
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
  }, [input]);

  useEffect(() => {
    loadSessions();
    loadCapabilities();
  }, []);

  useEffect(() => {
    const onPrefill = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: string; autoSend?: boolean }>).detail;
      const prompt = detail?.prompt;
      if (!prompt) return;
      setInput(prompt);
      setTimeout(() => inputRef.current?.focus(), 50);
      if (detail?.autoSend) {
        setTimeout(() => doSendRef.current(prompt), 80);
      }
    };
    window.addEventListener("specora:chat-prefill", onPrefill);
    return () => window.removeEventListener("specora:chat-prefill", onPrefill);
  }, []);

  // Subscribe to real-time events for toast notifications
  useEffect(() => {
    const unsubCreated = shell.eventBus.subscribe("ci.created", (_payload: any) => {
      shell.dispatch({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: "CI created", type: "success" } });
    });
    const unsubUpdated = shell.eventBus.subscribe("ci.updated", (_payload: any) => {
      shell.dispatch({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: "CI updated", type: "info" } });
    });
    const unsubDeleted = shell.eventBus.subscribe("ci.deleted", (_payload: any) => {
      shell.dispatch({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: "CI deleted", type: "info" } });
    });
    const unsubRelCreated = shell.eventBus.subscribe("relationship.created", (_payload: any) => {
      shell.dispatch({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: "Relationship created", type: "success" } });
    });
    return () => {
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
      unsubRelCreated();
    };
  }, [shell]);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!dropdownOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [dropdownOpen]);

  // Subscribe to shell message bus to capture UI context
  useEffect(() => {
    const unsubscribe = shell.messageBus.subscribe((msg: any) => {
      if (msg.type === "SET_ROOT_CI") {
        setUiContext((prev) => ({ ...prev, activeApp: "service-map", selectedRootCI: msg.payload?.rootId }));
      } else if (msg.type === "FOCUS_CI") {
        setUiContext((prev) => ({ ...prev, activeApp: "cmdb-explorer", focusedCI: msg.payload?.id }));
      } else if (msg.type === "APP_ACTIVATED") {
        setUiContext((prev) => ({ ...prev, activeApp: msg.payload?.appId }));
      } else if (msg.type === "CI_SELECTED" && msg.from === "cmdb-explorer") {
        const ci = msg.payload?.ci;
        if (ci) {
          setUiContext((prev) => ({ ...prev, selectedCI: ci }));
          // Auto-send CI selection to LLM so it can continue the workflow
          doSendRef.current(`Selected CI: ${ci.name} (${ci.id})`);
        }
      }
    });
    return unsubscribe;
  }, [shell.messageBus]);

  async function loadSessions() {
    try {
      const res = await authFetch(`${API_URL}/api/chat/sessions`);
      if (!res.ok) return;
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch {
      // silent
    }
  }

  async function loadCapabilities() {
    try {
      const res = await authFetch(`${API_URL}/api/chat/capabilities`);
      if (!res.ok) return;
      const data = await res.json();
      setCapabilityGroups(data.capabilities || []);
    } catch {
      // silent
    }
  }

  async function createNewSession() {
    try {
      const res = await authFetch(`${API_URL}/api/chat/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "New Chat" }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setSessionId(data.session.id);
      setMessages([{ role: "assistant", text: "Welcome to Specora. How can I help you today?" }]);
      setDropdownOpen(false);
      setSessionQuery("");
      await loadSessions();
    } catch {
      // silent
    }
  }

  async function loadSession(id: string) {
    setSessionId(id);
    setLoading(true);
    setDropdownOpen(false);
    setSessionQuery("");
    try {
      const res = await authFetch(`${API_URL}/api/chat/sessions/${id}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      const loaded = data.messages.map((m: any) => ({ role: m.role, text: m.content }));
      setMessages(loaded.length ? loaded : [{ role: "assistant", text: "Welcome to Specora. How can I help you today?" }]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const res = await authFetch(`${API_URL}/api/chat/sessions/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      if (sessionId === id) {
        setSessionId(null);
        setMessages([{ role: "assistant", text: "Welcome to Specora. How can I help you today?" }]);
      }
      await loadSessions();
    } catch {
      // silent
    }
  }

  function removeContextChip(key: string) {
    setUiContext((prev) => {
      const next = { ...prev };
      delete next[key];
      if (key === "activeApp") delete next.activeApp;
      return next;
    });
  }

  function stopResponse() {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }

  async function copyMessage(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(sanitizeXml(parseActions(text).cleanText || text));
      setCopiedMessageIndex(index);
      window.setTimeout(() => setCopiedMessageIndex((current) => current === index ? null : current), 1400);
    } catch {
      shell.dispatch({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: "Unable to copy response", type: "error" } });
    }
  }

  function retryLastUserMessage() {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (lastUser) void doSend(lastUser.text);
  }

  function approveAction(approval: PendingApproval) {
    setPendingApprovals((items) => items.filter((item) => item.id !== approval.id));
    void doSend(`Approved action: ${approval.name}`, { approvedToolNames: [approval.name] });
  }

  function cancelAction(id: string) {
    setPendingApprovals((items) => items.filter((item) => item.id !== id));
  }

  const doSend = useCallback(async (text: string, options: { approvedToolNames?: string[] } = {}) => {
    const userMsg = text.trim();
    if (!userMsg || loading) return;

    // Fast-path: explicit navigation commands that don't need the backend
    const lower = userMsg.toLowerCase();
    if ((lower === "open service map" || lower === "show service map") && (uiContext.selectedCI?.id || uiContext.selectedRootCI || uiContext.focusedCI)) {
      const rootId = uiContext.selectedCI?.id || uiContext.selectedRootCI || uiContext.focusedCI;
      handleAction("open-service-map", `rootId=${rootId}`);
      return;
    }

    setForceDatePicker(false);
    setInput("");
    const newMessages: ChatMessage[] = [...messages, { role: "user" as const, text: userMsg }];
    setMessages(newMessages);
    setLoading(true);

    const apiMessages = newMessages.map((m) => ({ role: m.role, content: m.text }));

    const contextParts: string[] = [`Active app/view: ${activeApp}`];
    if (uiContext.selectedRootCI) contextParts.push(`Selected root CI in Service Map: ${uiContext.selectedRootCI}`);
    if (uiContext.focusedCI) contextParts.push(`Focused CI in CMDB Explorer: ${uiContext.focusedCI}`);
    if (uiContext.selectedCI) contextParts.push(`Selected CI in CMDB Explorer: ${uiContext.selectedCI.name} (${uiContext.selectedCI.id})`);
    const uiContextString = contextParts.join("\n");

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      timeoutId = setTimeout(() => controller.abort(), 120000);
      setWorkSteps([{ id: "context", label: "Preparing platform context", status: "active" }]);

      const res = await authFetch(`${API_URL}/api/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: apiMessages,
          sessionId: sessionId || undefined,
          uiContext: uiContextString,
          approvedToolNames: options.approvedToolNames || [],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Chat failed with ${res.status}`);
      if (!res.body) throw new Error("Chat stream unavailable");

      setWorkSteps((steps) => updateWorkStep(updateWorkStep(steps, { id: "context", label: "Preparing platform context", status: "completed" }), { id: "assistant", label: "Asking assistant", status: "active" }));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const event = parseSseChunk(chunk);
          if (!event) continue;

          if (event.type === "token") {
            streamedText += event.content || "";
            setWorkSteps((steps) => updateWorkStep(steps, { id: "assistant", label: "Drafting response", status: "active" }));
            setMessages((prev) => {
              const next = [...prev];
              if (next[next.length - 1]?.role === "assistant") {
                next[next.length - 1] = { role: "assistant", text: streamedText };
              } else {
                next.push({ role: "assistant", text: streamedText });
              }
              return next;
            });
          } else if (event.type === "tool_call") {
            const id = `tool:${event.name}`;
            setWorkSteps((steps) => updateWorkStep(updateWorkStep(steps, { id: "assistant", label: "Asking assistant", status: "completed" }), { id, label: `Running ${toolLabel(event.name)}`, status: "active" }));
          } else if (event.type === "tool_result") {
            const id = `tool:${event.name}`;
            setWorkSteps((steps) => updateWorkStep(steps, { id, label: `Ran ${toolLabel(event.name)}`, status: "completed" }));
          } else if (event.type === "approval_required") {
            const approval: PendingApproval = {
              id: `${event.name}:${Date.now()}`,
              name: event.name,
              arguments: event.arguments || {},
              risk: event.risk || "high",
              reason: event.reason || "This action can mutate platform data.",
            };
            setPendingApprovals((items) => [...items, approval]);
            setWorkSteps((steps) => updateWorkStep(steps, { id: `tool:${event.name}`, label: `Waiting for approval: ${toolLabel(event.name)}`, status: "error" }));
          } else if (event.type === "done") {
            const text = sanitizeXml(event.content || streamedText);
            const { actions } = parseActions(text);
            if (text.trim() || actions.length > 0) {
              setMessages((prev) => {
                const next = [...prev];
                if (next[next.length - 1]?.role === "assistant") {
                  next[next.length - 1] = { role: "assistant", text };
                } else {
                  next.push({ role: "assistant", text });
                }
                return next;
              });
            }
            if (event.sessionId && !sessionId) {
              setSessionId(event.sessionId);
              await loadSessions();
            }
            setWorkSteps((steps) => updateWorkStep(steps, { id: "assistant", label: "Drafted response", status: "completed" }));
          } else if (event.type === "error") {
            throw new Error(event.message || "Chat failed");
          }
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setWorkSteps((steps) => updateWorkStep(steps, { id: "assistant", label: "Stopped response", status: "error" }));
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "Stopped." },
        ]);
        return;
      }
      setWorkSteps((steps) => updateWorkStep(steps, { id: "assistant", label: "Chat failed", status: "error" }));
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Error: ${err.message || "Failed to reach AI backend"}` },
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      abortRef.current = null;
      setLoading(false);
      window.setTimeout(() => setWorkSteps([]), 1600);
    }
  }, [activeApp, messages, loading, sessionId, uiContext]);
  doSendRef.current = doSend;

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    await doSend(input);
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void doSend(input);
    }
  };

  const handleAction = (type: string, payload: string) => {
    if (type === "open-service-map") {
      const params = new URLSearchParams(payload);
      const rootId = params.get("rootId");
      shell.dispatch({ type: "OPEN_APP", id: "service-map", installKey: "service-map", mode: "canvas", permissions: ["read:cmdb", "read:relationships"] });
      if (rootId) {
        setTimeout(() => {
          shell.messageBus.publish({ type: "SET_ROOT_CI", from: "chat", to: "service-map", payload: { rootId } });
        }, 500);
      }
    } else if (type === "open-ci-details") {
      const params = new URLSearchParams(payload);
      const id = params.get("id");
      shell.dispatch({ type: "OPEN_APP", id: "cmdb-explorer", installKey: "builtin_cmdb-explorer", mode: "canvas", permissions: ["read:cmdb", "read:relationships"] });
      if (id) {
        setTimeout(() => {
          shell.messageBus.publish({ type: "SET_CMDB_VIEW", from: "chat", to: "cmdb-explorer", payload: { focusCiId: id } });
        }, 300);
      }
    } else if (type === "open-cmdb-explorer") {
      const params = new URLSearchParams(payload);
      const queue = params.get("queue") || undefined;
      const query = params.get("query") || undefined;
      const classFilter = params.get("class") || undefined;
      const envFilter = params.get("environment") || undefined;
      const focusCiId = params.get("id") || undefined;
      shell.dispatch({ type: "OPEN_APP", id: "cmdb-explorer", installKey: "builtin_cmdb-explorer", mode: "canvas", permissions: ["read:cmdb", "read:relationships"] });
      setTimeout(() => {
        shell.messageBus.publish({ type: "SET_CMDB_VIEW", from: "chat", to: "cmdb-explorer", payload: { queue, query, classFilter, envFilter, focusCiId } });
      }, 300);
    } else if (type === "select-ci") {
      const params = new URLSearchParams(payload);
      const context = params.get("context") || "default";
      shell.dispatch({ type: "OPEN_APP", id: "cmdb-explorer", installKey: "builtin_cmdb-explorer", mode: "canvas", permissions: ["read:cmdb", "read:relationships"] });
      setTimeout(() => {
        shell.messageBus.publish({ type: "START_CI_SELECTION", from: "chat", to: "cmdb-explorer", payload: { context, callbackChannel: "chat" } });
      }, 300);
    } else if (type === "open-change-manager") {
      const params = new URLSearchParams(payload);
      const rfcId = params.get("rfcId");
      shell.dispatch({ type: "OPEN_APP", id: "change-manager", installKey: "change-manager", mode: "canvas", permissions: ["itsm:change:read", "itsm:change:write"] });
      if (rfcId) {
        setTimeout(() => {
          shell.messageBus.publish({ type: "FOCUS_RFC", from: "chat", to: "change-manager", payload: { rfcId } });
        }, 500);
      }
    } else if (type === "open-incident-manager") {
      const params = new URLSearchParams(payload);
      const incidentId = params.get("incidentId");
      shell.dispatch({ type: "OPEN_APP", id: "incident-manager", installKey: "builtin_incident-manager", mode: "canvas", permissions: ["itsm:incident:read", "itsm:incident:write"] });
      if (incidentId) {
        setTimeout(() => {
          shell.messageBus.publish({ type: "FOCUS_INCIDENT", from: "chat", to: "incident-manager", payload: { incidentId } });
        }, 500);
      }
    } else if (type === "open-knowledge-core") {
      const params = new URLSearchParams(payload);
      const knowledgeId = params.get("knowledgeId");
      shell.dispatch({ type: "OPEN_APP", id: "knowledge-core", installKey: "builtin_knowledge-core", mode: "canvas", permissions: ["itsm:knowledge:read", "itsm:knowledge:write"] });
      if (knowledgeId) {
        setTimeout(() => {
          shell.messageBus.publish({ type: "FOCUS_KNOWLEDGE", from: "chat", to: "knowledge-core", payload: { knowledgeId } });
        }, 500);
      }
    } else if (type === "open-prevention-center") {
      const params = new URLSearchParams(payload);
      const preventionId = params.get("preventionId");
      shell.dispatch({ type: "OPEN_APP", id: "prevention-center", installKey: "builtin_prevention-center", mode: "canvas", permissions: ["itsm:prevention:read", "itsm:prevention:write"] });
      if (preventionId) {
        setTimeout(() => {
          shell.messageBus.publish({ type: "FOCUS_PREVENTION", from: "chat", to: "prevention-center", payload: { preventionId } });
        }, 500);
      }
    } else if (type === "open-asset-command") {
      const params = new URLSearchParams(payload);
      const assetId = params.get("assetId");
      shell.dispatch({ type: "OPEN_APP", id: "asset-command", installKey: "builtin_asset-command", mode: "canvas", permissions: ["itsm:asset:read", "itsm:asset:write"] });
      if (assetId) {
        setTimeout(() => {
          shell.messageBus.publish({ type: "FOCUS_ASSET", from: "chat", to: "asset-command", payload: { assetId } });
        }, 500);
      }
    } else if (type === "open-customer-portal") {
      const params = new URLSearchParams(payload);
      const requestId = params.get("requestId");
      shell.dispatch({ type: "OPEN_APP", id: "customer-portal", installKey: "builtin_customer-portal", mode: "canvas", permissions: ["customer-portal:read", "customer-portal:write"], launchPayload: requestId ? { requestId } : undefined });
      if (requestId) {
        setTimeout(() => {
          shell.messageBus.publish({ type: "FOCUS_PORTAL_REQUEST", from: "chat", to: "customer-portal", payload: { requestId } });
        }, 500);
      }
    } else if (type === "pick-date") {
      setForceDatePicker(true);
      // Focus the input so user knows something happened
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const currentTitle = sessions.find((s) => s.id === sessionId)?.title || "New Chat";

  const showDatePicker = !loading && forceDatePicker;
  const hasUserMessages = messages.some((message) => message.role === "user");

  return (
    <div className="flex flex-col h-full w-full bg-gray-950">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-800 bg-gray-900/95 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((prev) => !prev)}
              className="flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-white"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-cyan-200">
                <Bot className="h-4 w-4" />
              </span>
              <span className="font-medium truncate max-w-[140px]">{currentTitle}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
            </button>
            {dropdownOpen && (
              <div className="absolute top-full left-0 z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-gray-700 bg-gray-800 shadow-2xl">
                <div className="p-2 border-b border-gray-700">
                  <button
                    onClick={createNewSession}
                    className="flex w-full items-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-sm text-gray-950 transition-colors hover:bg-cyan-400"
                  >
                    <Plus className="w-4 h-4" />
                    New Chat
                  </button>
                </div>
                {sessions.length > 0 && (
                  <div className="border-b border-gray-700 p-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                      <input
                        value={sessionQuery}
                        onChange={(event) => setSessionQuery(event.target.value)}
                        placeholder="Search chats"
                        className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2 pl-8 pr-3 text-sm text-gray-100 outline-none placeholder:text-gray-600 focus:border-cyan-500"
                      />
                    </div>
                  </div>
                )}
                <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
                  {filteredSessions.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => loadSession(s.id)}
                      className={`group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                        sessionId === s.id ? "bg-gray-700/60 text-white" : "text-gray-400 hover:bg-gray-700/40 hover:text-gray-200"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{s.title}</span>
                        <span className="block truncate text-[11px] text-gray-600">{formatSessionTime(s.updated_at)}</span>
                      </span>
                      <button
                        onClick={(e) => deleteSession(s.id, e)}
                        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity ml-2"
                        title="Delete chat"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {sessions.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-gray-500">No sessions yet</div>
                  ) : filteredSessions.length === 0 && (
                    <div className="px-3 py-4 text-center text-xs text-gray-500">No matching chats</div>
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => shell.dispatch({ type: "TOGGLE_RIGHT_PANEL" })}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
            title="Collapse panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {chips.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5">
            {chips.map((chip) => (
              <span
                key={`${chip.key}:${chip.label}`}
                className="inline-flex max-w-[220px] shrink-0 items-center gap-1.5 rounded-full border border-gray-700 bg-gray-950 px-2.5 py-1 text-xs text-gray-300"
                title={chip.detail ? `${chip.detail}: ${chip.label}` : chip.label}
              >
                <span className="truncate">
                  {chip.detail && <span className="text-gray-500">{chip.detail}: </span>}
                  {chip.label}
                </span>
                {chip.key !== "activeApp" && (
                  <button
                    type="button"
                    onClick={() => removeContextChip(chip.key)}
                    className="rounded-full p-0.5 text-gray-500 hover:bg-gray-800 hover:text-gray-200"
                    aria-label={`Remove ${chip.label} context`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.map((m, i) => {
          if (m.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[82%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-cyan-500 px-3 py-2 text-sm text-gray-950 shadow-lg shadow-cyan-950/20">
                  {m.text}
                </div>
              </div>
            );
          }

          const sanitizedText = sanitizeXml(m.text);
          const { cleanText, actions } = parseActions(sanitizedText);
          const isLatestAssistant = i === messages.length - 1 || (i === messages.length - 2 && messages[messages.length - 1]?.role === "user");
          const showPickerForThisMsg = isLatestAssistant && !loading && forceDatePicker;

          // Skip rendering assistant messages that have no text and no actions
          if (!cleanText && actions.length === 0) return null;

          return (
            <div key={i} className="flex justify-start">
              <div className="max-w-[96%] space-y-2">
                {cleanText && (
                  <div className="rounded-2xl rounded-bl-md border border-gray-800 bg-gray-900/90 px-3.5 py-3 text-sm leading-6 text-gray-200 shadow-sm [&_a]:text-cyan-300 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-gray-600 [&_blockquote]:pl-3 [&_blockquote]:italic [&_code]:rounded [&_code]:bg-gray-950 [&_code]:px-1 [&_code]:py-0.5 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_hr]:border-gray-700 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-gray-950 [&_pre]:p-3 [&_pre]:text-xs [&_ul]:list-disc [&_ul]:pl-4">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {cleanText}
                    </ReactMarkdown>
                  </div>
                )}
                {actions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {actions.map((a, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleAction(a.type, a.payload)}
                        className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 transition-colors hover:bg-cyan-500/20"
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
                {showPickerForThisMsg && (
                  <DatePickerWidget onSubmit={(val) => doSend(val)} />
                )}
                {cleanText && (
                  <div className="flex flex-wrap items-center gap-1.5 pl-1">
                    <button
                      type="button"
                      onClick={() => copyMessage(cleanText, i)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-gray-500 transition-colors hover:bg-gray-900 hover:text-gray-200"
                    >
                      {copiedMessageIndex === i ? <Check className="h-3 w-3 text-emerald-300" /> : <Clipboard className="h-3 w-3" />}
                      {copiedMessageIndex === i ? "Copied" : "Copy"}
                    </button>
                    {isLatestAssistant && hasUserMessages && !loading && (
                      <button
                        type="button"
                        onClick={retryLastUserMessage}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-gray-500 transition-colors hover:bg-gray-900 hover:text-gray-200"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Retry
                      </button>
                    )}
                  </div>
                )}
                {isLatestAssistant && hasUserMessages && !loading && followUps.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {followUps.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => doSend(item.prompt)}
                        className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-100"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!loading && !hasUserMessages && (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-3 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-200">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-200">
                <Sparkles className="h-4 w-4" />
              </span>
              Start with platform context
            </div>
            <div className="grid gap-2">
              {STARTER_PROMPTS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => doSend(item.prompt)}
                  className="group flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-950 px-3 py-2 text-left text-sm text-gray-300 transition-colors hover:border-cyan-500/40 hover:text-gray-100"
                >
                  <Compass className="h-4 w-4 shrink-0 text-gray-500 group-hover:text-cyan-300" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {pendingApprovals.length > 0 && (
          <div className="space-y-3">
            {pendingApprovals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                onApprove={approveAction}
                onCancel={cancelAction}
              />
            ))}
          </div>
        )}
        {/* Capability accordion — shown when conversation is fresh */}
        {!loading && !hasUserMessages && capabilityGroups.length > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">What you can do</p>
            {capabilityGroups.map((group) => {
              const isOpen = expandedGroups.has(group.appId);
              return (
                <div key={group.appId} className="border border-gray-800 rounded-lg overflow-hidden">
                  <button
                    onClick={() => {
                      setExpandedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.appId)) next.delete(group.appId);
                        else next.add(group.appId);
                        return next;
                      });
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-300 hover:bg-gray-800/50 transition-colors"
                  >
                    <span className="font-medium">{group.appName}</span>
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-2 space-y-1">
                      {group.capabilities.map((cap) => (
                        <button
                          key={cap.id}
                          onClick={() => doSend(cap.prompt)}
                          className="w-full text-left px-2 py-1.5 rounded-md text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                          title={cap.description}
                        >
                          {cap.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {loading && (
          <div className="flex justify-start">
            <WorkingTrace steps={workSteps.length > 0 ? workSteps : [{ id: "assistant", label: "Working with platform context", status: "active" }]} />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="shrink-0 border-t border-gray-800 bg-gray-900/95 p-3">
        <div className="rounded-2xl border border-gray-700 bg-gray-950 p-2 shadow-inner shadow-black/30 transition-colors focus-within:border-cyan-500/70">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Ask about your CMDB, incidents, or services..."
            rows={1}
            className="max-h-36 min-h-[48px] w-full resize-none overflow-y-auto bg-transparent px-2 py-2 text-sm leading-5 text-gray-100 outline-none placeholder:text-gray-600"
            disabled={loading}
          />
          <div className="flex items-center justify-between gap-2 border-t border-gray-800 px-1 pt-2">
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-gray-600">
              {chips.length > 0 && <span className="truncate">{chips.length} context {chips.length === 1 ? "item" : "items"}</span>}
            </div>
            <div className="flex items-center gap-1.5">
              {input.trim() && !loading && (
                <button
                  type="button"
                  onClick={() => {
                    setInput("");
                    inputRef.current?.focus();
                  }}
                  className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-900 hover:text-gray-200"
                  title="Clear draft"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {showDatePicker && (
                <button
                  type="button"
                  onClick={() => {
                    const today = new Date().toISOString().slice(0, 10);
                    setInput((prev) => (prev ? prev : today));
                    inputRef.current?.focus();
                  }}
                  className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-900 hover:text-cyan-300"
                  title="Insert today's date"
                >
                  <Calendar className="h-4 w-4" />
                </button>
              )}
              {loading ? (
                <button
                  type="button"
                  onClick={stopResponse}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-400/30 bg-red-500/10 text-red-200 transition-colors hover:bg-red-500/20"
                  title="Stop response"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-400 text-gray-950 transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-600"
                  title="Send message"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
