"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { getToken } from "@/lib/auth";
import { useShell } from "@/shell/AppContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Plus, Trash2, X, ChevronDown, ChevronRight, Calendar, Clock } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace("/graphql", "") || "http://localhost:4000";

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

function parseActions(text: string) {
  const actionRegex = /\[\[action\|([^|]+)\|([^|]+)\|([^\[\]]+)\]\]/g;
  const actions: { type: string; payload: string; label: string }[] = [];
  let match;
  while ((match = actionRegex.exec(text)) !== null) {
    actions.push({ type: match[1], payload: match[2], label: match[3] });
  }
  const cleanText = text.replace(actionRegex, "").trim();
  return { cleanText, actions };
}

function sanitizeXml(text: string): string {
  if (!text) return text;
  return text
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, "")
    .replace(/<invoke\s+[^>]*>[\s\S]*?<\/invoke>/gi, "")
    .replace(/<result>[\s\S]*?<\/result>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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

export function ChatOverlay() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: "Welcome to Specora. How can I help you today?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [capabilityGroups, setCapabilityGroups] = useState<AppCapabilityGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shell = useShell();
  const [uiContext, setUiContext] = useState<Record<string, any>>({});
  const [forceDatePicker, setForceDatePicker] = useState(false);
  const doSendRef = useRef<(text: string) => Promise<void>>(async () => {});

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
      const res = await fetch(`${API_URL}/api/chat/sessions`, {
        headers: { Authorization: `Bearer ${getToken() || ""}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch {
      // silent
    }
  }

  async function loadCapabilities() {
    try {
      const res = await fetch(`${API_URL}/api/chat/capabilities`, {
        headers: { Authorization: `Bearer ${getToken() || ""}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setCapabilityGroups(data.capabilities || []);
    } catch {
      // silent
    }
  }

  async function createNewSession() {
    try {
      const res = await fetch(`${API_URL}/api/chat/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() || ""}`,
        },
        body: JSON.stringify({ title: "New Chat" }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setSessionId(data.session.id);
      setMessages([{ role: "assistant", text: "Welcome to Specora. How can I help you today?" }]);
      setDropdownOpen(false);
      await loadSessions();
    } catch {
      // silent
    }
  }

  async function loadSession(id: string) {
    setSessionId(id);
    setLoading(true);
    setDropdownOpen(false);
    try {
      const res = await fetch(`${API_URL}/api/chat/sessions/${id}/messages`, {
        headers: { Authorization: `Bearer ${getToken() || ""}` },
      });
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
      const res = await fetch(`${API_URL}/api/chat/sessions/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken() || ""}` },
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

  const doSend = useCallback(async (text: string) => {
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

    const activeApp = shell.state.activeCanvasId || shell.state.focusedWindowId || uiContext.activeApp || "none";
    const contextParts: string[] = [`Active app/view: ${activeApp}`];
    if (uiContext.selectedRootCI) contextParts.push(`Selected root CI in Service Map: ${uiContext.selectedRootCI}`);
    if (uiContext.focusedCI) contextParts.push(`Focused CI in CMDB Explorer: ${uiContext.focusedCI}`);
    if (uiContext.selectedCI) contextParts.push(`Selected CI in CMDB Explorer: ${uiContext.selectedCI.name} (${uiContext.selectedCI.id})`);
    const uiContextString = contextParts.join("\n");

    // Use non-streaming endpoint for reliable tool calling
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() || ""}`,
        },
        body: JSON.stringify({
          messages: apiMessages,
          sessionId: sessionId || undefined,
          uiContext: uiContextString,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const text = sanitizeXml(data.content || "");
      const { actions } = parseActions(text);
      // Only add assistant message if it has text or actions (buttons)
      if (text.trim() || actions.length > 0) {
        setMessages((prev) => [...prev, { role: "assistant", text }]);
      }

      if (data.sessionId && !sessionId) {
        setSessionId(data.sessionId);
        await loadSessions();
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Error: ${err.message || "Failed to reach AI backend"}` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [messages, loading, sessionId, shell.state.activeCanvasId, shell.state.focusedWindowId, uiContext]);
  doSendRef.current = doSend;

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    await doSend(input);
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

  return (
    <div className="flex flex-col h-full w-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((prev) => !prev)}
              className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition-colors"
            >
              <span className="font-medium truncate max-w-[140px]">{currentTitle}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
            </button>
            {dropdownOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-64 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50">
                <div className="p-2 border-b border-gray-700">
                  <button
                    onClick={createNewSession}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    New Chat
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => loadSession(s.id)}
                      className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                        sessionId === s.id ? "bg-gray-700/60 text-white" : "text-gray-400 hover:bg-gray-700/40 hover:text-gray-200"
                      }`}
                    >
                      <span className="truncate flex-1">{s.title}</span>
                      <button
                        onClick={(e) => deleteSession(s.id, e)}
                        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity ml-2"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {sessions.length === 0 && (
                    <div className="px-3 py-4 text-center text-xs text-gray-500">No sessions yet</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => shell.dispatch({ type: "TOGGLE_RIGHT_PANEL" })}
          className="text-gray-400 hover:text-white transition-colors"
          title="Collapse panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.map((m, i) => {
          if (m.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="px-3 py-2 rounded-lg text-sm max-w-[80%] whitespace-pre-wrap bg-indigo-600 text-white">
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
              <div className="max-w-[95%] space-y-2">
                {cleanText && (
                  <div className="px-3 py-2 rounded-lg text-sm bg-gray-800 text-gray-200 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:bg-gray-950 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-gray-950 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:text-xs [&_a]:text-indigo-400 [&_a]:underline [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-gray-600 [&_blockquote]:pl-3 [&_blockquote]:italic [&_hr]:border-gray-700">
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
                        className="px-3 py-1.5 rounded-full text-xs bg-indigo-900/40 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-900/60 transition-colors"
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
                {showPickerForThisMsg && (
                  <DatePickerWidget onSubmit={(val) => doSend(val)} />
                )}
              </div>
            </div>
          );
        })}
        {/* Capability accordion — shown when conversation is fresh */}
        {!loading && messages.filter((m) => m.role === "user").length === 0 && capabilityGroups.length > 0 && (
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
            <div className="px-3 py-2 rounded-lg text-sm bg-gray-800 text-gray-400 animate-pulse">
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="p-3 border-t border-gray-800 shrink-0">
        <div className="relative">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your CMDB, incidents, or services..."
            className="w-full px-3 py-2.5 rounded-lg bg-gray-950 border border-gray-700 focus:outline-none focus:border-indigo-500 text-sm transition-colors pr-10"
            disabled={loading}
          />
          {showDatePicker && (
            <button
              type="button"
              onClick={() => {
                const today = new Date().toISOString().slice(0, 10);
                setInput((prev) => (prev ? prev : today));
                inputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-indigo-400 transition-colors"
              title="Insert today's date"
            >
              <Calendar className="w-4 h-4" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
