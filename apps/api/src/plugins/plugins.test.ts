import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { neo4jPlugin } from "../plugins/neo4j";
import { authPlugin } from "../plugins/jwt";

describe("neo4jPlugin", () => {
  it("decorates fastify with neo4j driver", async () => {
    const app = Fastify();
    await app.register(neo4jPlugin);
    expect(app.neo4j).toBeDefined();
    expect(app.neo4j.session).toBeDefined();
  });

  it("closes driver on shutdown", async () => {
    const app = Fastify();
    await app.register(neo4jPlugin);
    const closeSpy = vi.spyOn(app.neo4j, "close").mockResolvedValue(undefined);
    await app.close();
    expect(closeSpy).toHaveBeenCalled();
  });
});

describe("authPlugin", () => {
  it("decorates fastify with authenticate hook", async () => {
    const app = Fastify();
    app.decorate("jwt", { verify: vi.fn() });
    await app.register(authPlugin);
    expect(app.authenticate).toBeDefined();
  });

  it("authenticate hook sends error on jwt verify failure", async () => {
    const app = Fastify();
    const error = new Error("Invalid token");
    app.decorate("jwt", { verify: vi.fn().mockRejectedValue(error) });
    await app.register(authPlugin);

    const request = { jwtVerify: vi.fn().mockRejectedValue(error) } as any;
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() } as any;
    await app.authenticate(request, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: "Unauthorized" });
  });
});
