"use client";

import { useState, useRef, useEffect } from "react";
import { useKeyboardShortcut } from "@/hooks/useKeyboardShortcut";
import { getToken } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace("/graphql", "") || "http://localhost:4000";

export function ChatOverlay() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([
    { role: "assistant", text: "Welcome to Specora. How can I help you today?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useKeyboardShortcut("k", () => setOpen((prev) => !prev), { ctrl: true });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");
    const newMessages = [...messages, { role: "user" as const, text: userMsg }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() || ""}`,
        },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.text })),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
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

  if (!open) {
    return (
      <div className="fixed bottom-4 right-4 text-xs text-gray-500">
        Press <kbd className="px-1 py-0.5 rounded bg-gray-800 border border-gray-700">Ctrl K</kbd> to chat
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="font-semibold text-sm">Specora Assistant</h2>
          <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`px-3 py-2 rounded-lg text-sm max-w-[80%] whitespace-pre-wrap ${
                  m.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-200"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="px-3 py-2 rounded-lg text-sm bg-gray-800 text-gray-400 animate-pulse">
                Thinking...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <form onSubmit={sendMessage} className="p-3 border-t border-gray-800">
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your CMDB, incidents, or services..."
            className="w-full px-3 py-2 rounded bg-gray-950 border border-gray-700 focus:outline-none focus:border-indigo-500 text-sm"
            disabled={loading}
          />
        </form>
      </div>
    </div>
  );
}
