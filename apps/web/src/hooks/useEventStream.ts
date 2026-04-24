"use client";

import { useEffect, useRef, useCallback } from "react";
import { getToken } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace("/graphql", "") || "http://localhost:4000";
const WS_URL = API_URL.replace(/^http/, "ws") + "/api/events/live";

export type EventHandler = (payload: Record<string, unknown>) => void;

interface EventStream {
  subscribe: (type: string, handler: EventHandler) => () => void;
  connected: boolean;
}

export function useEventStream(): EventStream {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedRef = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPollTimeRef = useRef<string>(new Date(0).toISOString());
  const mountedRef = useRef(true);

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;
    const token = getToken();
    if (!token) return;

    let ticket: string | null = null;
    try {
      const res = await fetch(`${API_URL}/api/ws-ticket`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        ticket = data.ticket;
      }
    } catch {
      // ticket exchange failed, fall back to polling
      startPolling();
      return;
    }
    if (!ticket) {
      startPolling();
      return;
    }

    try {
      const ws = new WebSocket(`${WS_URL}?ticket=${ticket}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        reconnectAttemptsRef.current = 0;
        connectedRef.current = true;
        // Subscribe to all types apps have registered
        const types = Array.from(handlersRef.current.keys());
        if (types.length > 0) {
          ws.send(JSON.stringify({ action: "subscribe", types }));
        }
        // Stop polling if active
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "ping") {
            ws.send(JSON.stringify({ action: "pong" }));
            return;
          }
          if (msg.type && msg.payload) {
            const handlers = handlersRef.current.get(msg.type);
            if (handlers) {
              handlers.forEach((h) => {
                try { h(msg.payload); } catch (e) { console.error("Event handler failed:", e); }
              });
            }
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        connectedRef.current = false;
        wsRef.current = null;

        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
        const maxRetries = 5;
        if (reconnectAttemptsRef.current < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current++;
          reconnectTimerRef.current = setTimeout(connect, delay);
        } else {
          // Fall back to REST polling
          startPolling();
        }
      };

      ws.onerror = () => {
        // onclose will handle reconnection
      };
    } catch {
      // WebSocket creation failed, try reconnect or polling
      if (reconnectAttemptsRef.current < 5) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current++;
        reconnectTimerRef.current = setTimeout(connect, delay);
      } else {
        startPolling();
      }
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    const poll = async () => {
      try {
        const res = await fetch(`${API_URL}/api/events?since=${encodeURIComponent(lastPollTimeRef.current)}`, {
          headers: { Authorization: `Bearer ${getToken() || ""}` },
        });
        if (!res.ok) return;
        const events = await res.json();
        if (Array.isArray(events)) {
          for (const ev of events) {
            const handlers = handlersRef.current.get(ev.type);
            if (handlers) {
              handlers.forEach((h) => {
                try { h(ev.payload); } catch (e) { console.error("Event handler failed:", e); }
              });
            }
            if (ev.created_at > lastPollTimeRef.current) {
              lastPollTimeRef.current = ev.created_at;
            }
          }
        }
      } catch {
        // silent
      }
    };
    poll(); // immediate first poll
    pollIntervalRef.current = setInterval(poll, 10000);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const subscribe = useCallback((type: string, handler: EventHandler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);

    // If already connected, send subscribe message
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "subscribe", types: [type] }));
    }

    return () => {
      handlersRef.current.get(type)?.delete(handler);
      if (handlersRef.current.get(type)?.size === 0) {
        handlersRef.current.delete(type);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ action: "unsubscribe", types: [type] }));
        }
      }
    };
  }, []);

  return {
    subscribe,
    get connected() { return connectedRef.current; },
  };
}
