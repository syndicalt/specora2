"use client";

import { useState, useRef, useEffect } from "react";
import { getToken } from "@/lib/auth";
import { useShell } from "@/shell/AppContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Plus, Trash2, X, ChevronDown } from "lucide-react";

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

export function ChatOverlay() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: "Welcome to Specora. How can I help you today?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shell = useShell();
  const [uiContext, setUiContext] = useState<Record<string, any>>({});

  // Auto-focus input on mount (panel opened) and when session changes
  useEffect(() => {
    // small delay to ensure DOM is ready after animation
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    loadSessions();
  }, []);

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

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");
    const newMessages = [...messages, { role: "user" as const, text: userMsg }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const apiMessages = newMessages.map((m) => ({ role: m.role, content: m.text }));

      // Build UI context string
      const activeApp = shell.state.activeCanvasId || shell.state.focusedWindowId || uiContext.activeApp || "none";
      const contextParts: string[] = [`Active app/view: ${activeApp}`];
      if (uiContext.selectedRootCI) contextParts.push(`Selected root CI in Service Map: ${uiContext.selectedRootCI}`);
      if (uiContext.focusedCI) contextParts.push(`Focused CI in CMDB Explorer: ${uiContext.focusedCI}`);
      const uiContextString = contextParts.join("\n");

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
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.sessionId && !sessionId) {
        setSessionId(data.sessionId);
        await loadSessions();
      }
      setMessages((prev) => [...prev, { role: "assistant", text: data.content }]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Error: ${err.message || "Failed to reach AI backend"}` },
      ]);
    } finally {
      setLoading(false);
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
      shell.dispatch({ type: "OPEN_APP", id: "cmdb-explorer", installKey: "cmdb-explorer", mode: "window", permissions: ["read:cmdb"] });
      if (id) {
        setTimeout(() => {
          shell.messageBus.publish({ type: "FOCUS_CI", from: "chat", to: "cmdb-explorer", payload: { id } });
        }, 500);
      }
    }
  };

  const currentTitle = sessions.find((s) => s.id === sessionId)?.title || "New Chat";

  return (
    <div className="flex flex-col h-full w-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          {/* Session dropdown trigger */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((prev) => !prev)}
              className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition-colors"
            >
              <span className="font-medium truncate max-w-[140px]">{currentTitle}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {/* Dropdown */}
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
                        sessionId === s.id
                          ? "bg-gray-700/60 text-white"
                          : "text-gray-400 hover:bg-gray-700/40 hover:text-gray-200"
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
                    <div className="px-3 py-4 text-center text-xs text-gray-500">
                      No sessions yet
                    </div>
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

          const { cleanText, actions } = parseActions(m.text);
          return (
            <div key={i} className="flex justify-start">
              <div className="max-w-[95%] space-y-2">
                <div className="px-3 py-2 rounded-lg text-sm bg-gray-800 text-gray-200 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:bg-gray-950 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-gray-950 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:text-xs [&_a]:text-indigo-400 [&_a]:underline [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-gray-600 [&_blockquote]:pl-3 [&_blockquote]:italic [&_hr]:border-gray-700">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {cleanText}
                  </ReactMarkdown>
                </div>
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
              </div>
            </div>
          );
        })}
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
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your CMDB, incidents, or services..."
          className="w-full px-3 py-2.5 rounded-lg bg-gray-950 border border-gray-700 focus:outline-none focus:border-indigo-500 text-sm transition-colors"
          disabled={loading}
        />
      </form>
    </div>
  );
}
