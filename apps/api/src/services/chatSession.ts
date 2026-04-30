import { Pool } from "pg";

export type ChatRole = "user" | "assistant" | "tool" | "system";

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  tool_calls: unknown;
  tool_call_id: string | null;
  created_at: Date;
}

export interface ChatSessionRow {
  id: string;
  user_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
  pathlight_trace_id?: string | null;
}

export async function createSession(
  pg: Pool,
  userId: string,
  title = "New Chat"
): Promise<ChatSessionRow> {
  const result = await pg.query(
    `INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING id, user_id, title, created_at, updated_at`,
    [userId, title]
  );
  return result.rows[0];
}

export async function listSessions(
  pg: Pool,
  userId: string
): Promise<ChatSessionRow[]> {
  const result = await pg.query(
    `SELECT id, user_id, title, created_at, updated_at FROM chat_sessions WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function deleteSession(
  pg: Pool,
  userId: string,
  sessionId: string
): Promise<boolean> {
  const result = await pg.query(
    `DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getMessages(
  pg: Pool,
  sessionId: string,
  userId?: string
): Promise<ChatMessageRow[]> {
  if (userId) {
    const sessionResult = await pg.query(
      `SELECT 1 FROM chat_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    if (sessionResult.rows.length === 0) {
      throw new Error("Session not found or access denied");
    }
  }
  const result = await pg.query(
    `SELECT id, session_id, role, content, tool_calls, tool_call_id, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId]
  );
  return result.rows;
}

function serializeToolCalls(toolCalls: unknown): string | null {
  if (toolCalls == null) return null;
  if (typeof toolCalls === "string") return toolCalls;
  try {
    return JSON.stringify(toolCalls);
  } catch {
    return null;
  }
}

export async function appendMessage(
  pg: Pool,
  sessionId: string,
  role: ChatRole,
  content: string,
  toolCalls?: unknown,
  toolCallId?: string
): Promise<ChatMessageRow> {
  const safeContent = content ?? "";
  const safeToolCalls = serializeToolCalls(toolCalls);
  const result = await pg.query(
    `INSERT INTO chat_messages (session_id, role, content, tool_calls, tool_call_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, session_id, role, content, tool_calls, tool_call_id, created_at`,
    [sessionId, role, safeContent, safeToolCalls, toolCallId ?? null]
  );
  // Touch session updated_at
  await pg.query(`UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1`, [sessionId]);
  return result.rows[0];
}

export async function updateSessionTitle(
  pg: Pool,
  sessionId: string,
  title: string
): Promise<void> {
  await pg.query(`UPDATE chat_sessions SET title = $1, updated_at = NOW() WHERE id = $2`, [
    title,
    sessionId,
  ]);
}

export async function getSessionTraceId(pg: Pool, sessionId: string): Promise<string | null> {
  const result = await pg.query(
    `SELECT pathlight_trace_id FROM chat_sessions WHERE id = $1`,
    [sessionId]
  );
  return result.rows[0]?.pathlight_trace_id ?? null;
}

export async function setSessionTraceId(pg: Pool, sessionId: string, traceId: string): Promise<void> {
  await pg.query(
    `UPDATE chat_sessions SET pathlight_trace_id = $1 WHERE id = $2`,
    [traceId, sessionId]
  );
}
