import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { knowledgeAutomationRoutes } from "./knowledgeAutomation";
import { clearPermissionCache } from "../services/rbac";

const executeTool = vi.fn();

vi.mock("@specora/sdk", () => ({
  executeTool: (...args: any[]) => executeTool(...args),
}));

function makePg(allowed = true) {
  return {
    query: vi.fn(async () => ({ rows: allowed ? [{ 1: 1 }] : [] })),
  };
}

async function buildApp(user = { id: "u1", role: "admin" }, allowed = true) {
  const app = Fastify();
  app.decorate("pg", makePg(allowed));
  app.decorate("authenticate", async (request: any) => {
    request.user = user;
  });
  await app.register(knowledgeAutomationRoutes);
  return app;
}

describe("knowledgeAutomationRoutes", () => {
  beforeEach(() => {
    clearPermissionCache();
    executeTool.mockReset();
  });

  it("answers questions through a governed knowledge endpoint", async () => {
    executeTool.mockResolvedValueOnce({ answer: "Restart the worker", citations: [{ id: "kb-1" }] });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/knowledge/answer",
      payload: { query: "worker is stuck" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).citations).toHaveLength(1);
    expect(executeTool).toHaveBeenCalledWith("knowledge-core_answer", expect.objectContaining({
      query: "worker is stuck",
      _userId: "u1",
    }), expect.anything());
  });

  it("rejects authenticated users without a platform role", async () => {
    const app = await buildApp({ id: "u1" } as any);
    const res = await app.inject({
      method: "POST",
      url: "/api/knowledge/answer",
      payload: { query: "worker is stuck" },
    });
    expect(res.statusCode).toBe(403);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("creates knowledge items through external automation", async () => {
    executeTool.mockResolvedValueOnce({ id: "kb-1", status: "draft" });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/knowledge/items",
      payload: { title: "Restart worker", content: "Steps" },
    });

    expect(res.statusCode).toBe(200);
    expect(executeTool).toHaveBeenCalledWith("knowledge-core_create_knowledge", expect.objectContaining({ title: "Restart worker" }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["knowledge_automation.item_created", "KnowledgeItem", "kb-1"]));
  });

  it("drafts knowledge from operational records", async () => {
    executeTool.mockResolvedValueOnce({ id: "kb-2", source: "incident" });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/knowledge/drafts/from-record",
      payload: { sourceType: "incident", sourceId: "inc-1" },
    });

    expect(res.statusCode).toBe(200);
    expect(executeTool).toHaveBeenCalledWith("knowledge-core_draft_from_record", expect.objectContaining({ sourceId: "inc-1" }), expect.anything());
  });

  it("publishes knowledge through a governance endpoint", async () => {
    executeTool.mockResolvedValueOnce({ id: "kb-1", status: "published" });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/knowledge/items/kb-1/publish",
      payload: { note: "Reviewed" },
    });

    expect(res.statusCode).toBe(200);
    expect(executeTool).toHaveBeenCalledWith("knowledge-core_publish_knowledge", expect.objectContaining({
      knowledgeId: "kb-1",
      status: "published",
    }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["knowledge_automation.item_published", "KnowledgeItem", "kb-1"]));
  });

  it("records knowledge feedback", async () => {
    executeTool.mockResolvedValueOnce({ id: "fb-1", outcome: "deflected" });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/knowledge/items/kb-1/feedback",
      payload: { outcome: "deflected", helpful: true },
    });

    expect(res.statusCode).toBe(200);
    expect(executeTool).toHaveBeenCalledWith("knowledge-core_record_feedback", expect.objectContaining({
      knowledgeId: "kb-1",
      outcome: "deflected",
    }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["knowledge_automation.feedback_recorded", "KnowledgeItem", "kb-1"]));
  });
});
