"use client";

import { useEffect, useRef, useCallback } from "react";
import { authFetch, getToken } from "../lib/auth";
import { getApiBase } from "../lib/runtimeApi";

const API_URL = getApiBase();
const WS_URL = API_URL.replace(/^http/, "ws") + "/api/events/live";
const SSE_URL = API_URL + "/api/events/stream";

export type EventHandler = (payload: Record<string, unknown>) => void;

interface EventStream {
  subscribe: (type: string, handler: EventHandler) => () => void;
  connected: boolean;
}

export function useEventStream(): EventStream {
  const wsRef = useRef<WebSocket | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedRef = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPollTimeRef = useRef<string>(new Date(0).toISOString());
  const mountedRef = useRef(true);

  const dispatchEvent = useCallback((type: string, payload: Record<string, unknown>) => {
    const handlers = handlersRef.current.get(type);
    if (handlers) {
      handlers.forEach((h) => {
        try { h(payload); } catch (e) { console.error("Event handler failed:", e); }
      });
    }
  }, []);

  const eventTypes = useCallback(() => Array.from(handlersRef.current.keys()), []);

  const requestTicket = useCallback(async () => {
    const res = await authFetch(`${API_URL}/api/ws-ticket`, { method: "POST" });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.ticket === "string" ? data.ticket : null;
  }, []);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    const poll = async () => {
      try {
        const res = await authFetch(`${API_URL}/api/events?since=${encodeURIComponent(lastPollTimeRef.current)}`);
        if (!res.ok) return;
        const events = await res.json();
        if (Array.isArray(events)) {
          for (const ev of events) {
            dispatchEvent(ev.type, ev.payload);
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
  }, [dispatchEvent]);

  const startSse = useCallback(async () => {
    if (eventSourceRef.current || !mountedRef.current) return;
    const ticket = await requestTicket().catch(() => null);
    if (!ticket) {
      startPolling();
      return;
    }
    const types = eventTypes();
    const params = new URLSearchParams({ ticket });
    if (types.length > 0) params.set("types", types.join(","));

    try {
      const source = new EventSource(`${SSE_URL}?${params.toString()}`);
      eventSourceRef.current = source;

      source.onopen = () => {
        if (!mountedRef.current) return;
        connectedRef.current = true;
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      };

      source.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type && msg.payload) dispatchEvent(msg.type, msg.payload);
        } catch {
          // ignore malformed messages
        }
      };

      source.onerror = () => {
        connectedRef.current = false;
        source.close();
        if (eventSourceRef.current === source) eventSourceRef.current = null;
        startPolling();
      };
    } catch {
      startPolling();
    }
  }, [dispatchEvent, eventTypes, requestTicket, startPolling]);

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;
    const token = getToken();
    if (!token) return;

    let ticket: string | null = null;
    try {
      ticket = await requestTicket();
    } catch {
      // ticket exchange failed, fall back to polling.
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
        const types = eventTypes();
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
          if (msg.type && msg.payload) {
            dispatchEvent(msg.type, msg.payload);
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
          // Fall back to SSE, then REST polling if streaming is unavailable.
          startSse();
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
        startSse();
      }
    }
  }, [dispatchEvent, eventTypes, requestTicket, startSse]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
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
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      startSse();
    }

    return () => {
      handlersRef.current.get(type)?.delete(handler);
      if (handlersRef.current.get(type)?.size === 0) {
        handlersRef.current.delete(type);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ action: "unsubscribe", types: [type] }));
        }
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
          startSse();
        }
      }
    };
  }, [startSse]);

  return {
    subscribe,
    get connected() { return connectedRef.current; },
  };
}
