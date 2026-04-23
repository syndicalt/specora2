import { PoolClient } from "pg";

export type ChatRole = "user" | "assistant" | "tool" | "system";

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  tool_calls: any | null;
  tool_call_id: string | null;
  created_at: Date;
}

export interface ChatSessionRow {
  id: string;
  user_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
}

export async function createSession(
  pg: PoolClient,
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
  pg: PoolClient,
  userId: string
): Promise<ChatSessionRow[]> {
  const result = await pg.query(
    `SELECT id, user_id, title, created_at, updated_at FROM chat_sessions WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function deleteSession(
  pg: PoolClient,
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
  pg: PoolClient,
  sessionId: string
): Promise<ChatMessageRow[]> {
  const result = await pg.query(
    `SELECT id, session_id, role, content, tool_calls, tool_call_id, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId]
  );
  return result.rows;
}

export async function appendMessage(
  pg: PoolClient,
  sessionId: string,
  role: ChatRole,
  content: string,
  toolCalls?: any,
  toolCallId?: string
): Promise<ChatMessageRow> {
  const result = await pg.query(
    `INSERT INTO chat_messages (session_id, role, content, tool_calls, tool_call_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, session_id, role, content, tool_calls, tool_call_id, created_at`,
    [sessionId, role, content, toolCalls ?? null, toolCallId ?? null]
  );
  // Touch session updated_at
  await pg.query(`UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1`, [sessionId]);
  return result.rows[0];
}

export async function updateSessionTitle(
  pg: PoolClient,
  sessionId: string,
  title: string
): Promise<void> {
  await pg.query(`UPDATE chat_sessions SET title = $1, updated_at = NOW() WHERE id = $2`, [
    title,
    sessionId,
  ]);
}
