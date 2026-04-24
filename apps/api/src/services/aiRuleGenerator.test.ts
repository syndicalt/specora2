import { describe, it, expect, vi } from "vitest";
import { generateRules, executeGeneratedRule } from "./aiRuleGenerator";

describe("aiRuleGenerator", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  function mockFastify(graphData: any = {}) {
    return {
      neo4j: {
        session: vi.fn().mockReturnValue({
          run: vi.fn().mockImplementation((cypher: string) => {
            if (cypher.includes("n.class as class, count(n)")) {
              return Promise.resolve({
                records: [{ get: (k: string) => (k === "class" ? "Server" : { toNumber: () => 5 }) }],
              });
            }
            if (cypher.includes("a.class as fromClass")) {
              return Promise.resolve({
                records: [{ get: (k: string) => (k === "fromClass" ? "Server" : k === "relType" ? "HOSTED_ON" : k === "toClass" ? "Database" : { toNumber: () => 3 }) }],
              });
            }
            if (cypher.includes("n.name as name")) {
              return Promise.resolve({
                records: [{ get: (k: string) => (k === "class" ? "Server" : k === "name" ? "srv-1" : "srv-1") }],
              });
            }
            return Promise.resolve({ records: [] });
          }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      },
    } as any;
  }

  describe("generateRules", () => {
    it("generates rules via Provara", async () => {
      process.env = { ...originalEnv, PROVARA_URL: "http://provara.test/v1", PROVARA_API_KEY: "pk_test" };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content:
                    "NAME: Orphaned Servers\nCYPHER:\nMATCH (n:Server) WHERE NOT (n)--() RETURN n.id as ciId, n.name as ciName, n.class as ciClass\nEXPLANATION: Finds servers with no relationships\n---\nNAME: Missing Hosts\nCYPHER:\nMATCH (n:Database) WHERE NOT (n)-[:HOSTED_ON]->(:Server) RETURN n.id as ciId, n.name as ciName, n.class as ciClass\nEXPLANATION: Finds databases not hosted on a server",
                },
              },
            ],
          }),
      });

      const fastify = mockFastify();
      const rules = await generateRules(fastify);
      expect(rules.length).toBeGreaterThan(0);
      expect(rules[0]).toHaveProperty("name");
      expect(rules[0]).toHaveProperty("cypher");
    });

    it("throws when no LLM is configured", async () => {
      delete process.env.PROVARA_URL;
      delete process.env.PROVARA_API_KEY;
      delete process.env.OPENAI_API_KEY;

      const fastify = mockFastify();
      await expect(generateRules(fastify)).rejects.toThrow("No LLM configured");
    });
  });

  describe("executeGeneratedRule", () => {
    it("executes a valid MATCH query", async () => {
      const fastify = {
        neo4j: {
          session: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({
              records: [
                {
                  get: (k: string) =>
                    k === "ciId" ? "srv-1" : k === "ciName" ? "Web Server" : "Server",
                },
              ],
            }),
            close: vi.fn().mockResolvedValue(undefined),
          }),
        },
      } as any;
      const result = await executeGeneratedRule(fastify, "MATCH (n) RETURN n.id as ciId, n.name as ciName, n.class as ciClass");
      expect(result).toHaveLength(1);
      expect(result[0].ciId).toBe("srv-1");
    });

    it("rejects non-MATCH queries", async () => {
      const fastify = {
        neo4j: { session: vi.fn().mockReturnValue({ run: vi.fn(), close: vi.fn() }) },
      } as any;
      await expect(executeGeneratedRule(fastify, "DELETE (n)")).rejects.toThrow("Only MATCH queries are allowed");
    });

    it("rejects mutating queries", async () => {
      const fastify = {
        neo4j: { session: vi.fn().mockReturnValue({ run: vi.fn(), close: vi.fn() }) },
      } as any;
      await expect(executeGeneratedRule(fastify, "MATCH (n) DELETE n")).rejects.toThrow("Mutating queries are not allowed");
    });
  });
});
