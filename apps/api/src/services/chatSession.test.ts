import { describe, it, expect, vi } from "vitest";
import {
  createSession,
  listSessions,
  deleteSession,
  getMessages,
  appendMessage,
  updateSessionTitle,
} from "../services/chatSession";

function mockPg(rows: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  } as any;
}

describe("chatSession service", () => {
  it("creates a session", async () => {
    const pg = mockPg([{ id: "s1", user_id: "u1", title: "Test", created_at: new Date(), updated_at: new Date() }]);
    const result = await createSession(pg, "u1", "Test");
    expect(result.id).toBe("s1");
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO chat_sessions"),
      ["u1", "Test"]
    );
  });

  it("lists sessions for a user", async () => {
    const pg = mockPg([{ id: "s1", user_id: "u1", title: "Test", created_at: new Date(), updated_at: new Date() }]);
    const result = await listSessions(pg, "u1");
    expect(result).toHaveLength(1);
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT"),
      ["u1"]
    );
  });

  it("deletes a session", async () => {
    const pg = mockPg();
    pg.query.mockResolvedValueOnce({ rowCount: 1 });
    const result = await deleteSession(pg, "u1", "s1");
    expect(result).toBe(true);
  });

  it("returns false when deleting non-existent session", async () => {
    const pg = mockPg();
    pg.query.mockResolvedValueOnce({ rowCount: 0 });
    const result = await deleteSession(pg, "u1", "s1");
    expect(result).toBe(false);
  });

  it("returns false when rowCount is undefined", async () => {
    const pg = mockPg();
    pg.query.mockResolvedValueOnce({ rowCount: undefined });
    const result = await deleteSession(pg, "u1", "s1");
    expect(result).toBe(false);
  });

  it("gets messages for a session", async () => {
    const pg = mockPg([{ id: "m1", session_id: "s1", role: "user", content: "Hi", tool_calls: null, tool_call_id: null, created_at: new Date() }]);
    const result = await getMessages(pg, "s1");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Hi");
  });

  it("appends a message and updates session timestamp", async () => {
    const pg = mockPg([{ id: "m1", session_id: "s1", role: "user", content: "Hi", tool_calls: null, tool_call_id: null, created_at: new Date() }]);
    const result = await appendMessage(pg, "s1", "user", "Hi");
    expect(result.content).toBe("Hi");
    expect(pg.query).toHaveBeenCalledTimes(2);
    expect(pg.query).toHaveBeenLastCalledWith(
      expect.stringContaining("UPDATE chat_sessions SET updated_at"),
      ["s1"]
    );
  });

  it("updates session title", async () => {
    const pg = mockPg();
    await updateSessionTitle(pg, "s1", "New Title");
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE chat_sessions SET title"),
      ["New Title", "s1"]
    );
  });
});
