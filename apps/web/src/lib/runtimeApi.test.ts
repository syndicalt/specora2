import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiBase, getGraphqlEndpoint } from "./runtimeApi";

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

describe("runtimeApi", () => {
  afterEach(() => {
    if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
    vi.unstubAllGlobals();
  });

  function stubLocation(protocol: string, hostname: string) {
    vi.stubGlobal("window", { location: { protocol, hostname } });
  }

  it("uses configured GraphQL endpoint and derives API base", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://specora-dev.specora.org/graphql";

    expect(getGraphqlEndpoint()).toBe("https://specora-dev.specora.org/graphql");
    expect(getApiBase()).toBe("https://specora-dev.specora.org");
  });

  it("falls back to localhost outside Railway", () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    stubLocation("https:", "specora.local");

    expect(getApiBase()).toBe("http://localhost:4000");
    expect(getGraphqlEndpoint()).toBe("http://localhost:4000/graphql");
  });

  it("can derive Railway API service URL from an internal generated web service URL", () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    stubLocation("https:", "specora2-web-production.up.railway.app");

    expect(getApiBase()).toBe("https://specora2-api-production.up.railway.app");
    expect(getGraphqlEndpoint()).toBe("https://specora2-api-production.up.railway.app/graphql");
  });
});
