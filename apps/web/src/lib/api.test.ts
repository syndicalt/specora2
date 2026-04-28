import { describe, expect, it, vi } from "vitest";

vi.mock("./runtimeApi", () => ({
  getApiBase: () => "http://api.test",
  getGraphqlEndpoint: () => "http://api.test/graphql",
}));

vi.mock("./auth", () => ({
  authFetch: vi.fn(),
  getToken: vi.fn(),
}));

describe("api client", () => {
  it("exports the resolved API base URL", async () => {
    const { API_BASE } = await import("./api");

    expect(API_BASE).toBe("http://api.test");
  });

  it("passes bearer auth when a token exists", async () => {
    vi.resetModules();
    const auth = await import("./auth");
    vi.mocked(auth.getToken).mockReturnValue("token-1");
    const { graphqlClient } = await import("./api");

    const headers = (graphqlClient as any).requestConfig.headers();

    expect(headers).toEqual({ Authorization: "Bearer token-1" });
  });

  it("uses an empty authorization header when no token exists", async () => {
    vi.resetModules();
    const auth = await import("./auth");
    vi.mocked(auth.getToken).mockReturnValue(null);
    const { graphqlClient } = await import("./api");

    const headers = (graphqlClient as any).requestConfig.headers();

    expect(headers).toEqual({ Authorization: "" });
  });

  it("routes GraphQL transport through authFetch without browser caching", async () => {
    vi.resetModules();
    const auth = await import("./auth");
    vi.mocked(auth.authFetch).mockResolvedValue(new Response("{}"));
    const { graphqlClient } = await import("./api");

    await (graphqlClient as any).requestConfig.fetch("http://api.test/graphql", { method: "POST" });

    expect(auth.authFetch).toHaveBeenCalledWith("http://api.test/graphql", { method: "POST", cache: "no-store" });
  });
});
