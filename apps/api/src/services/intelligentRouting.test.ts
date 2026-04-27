import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scoreIntakeRoutes } from "./intelligentRouting";

const originalEnv = process.env;

describe("intelligentRouting", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "development", PROVARA_URL: "https://provara.test/v1", PROVARA_API_KEY: "pk_test" };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it("recovers a concrete route when the model returns a pipe-delimited schema literal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              scores: [{
                route: "incident|knowledge|catalog_request|support_handoff|clarify",
                probability: 0.9,
                rationale: "The user reports a laptop issue, indicating a possible service outage or hardware problem, so incident is most appropriate.",
                missingFields: [],
              }],
            }),
          },
        }],
      }),
    })));

    const decision = await scoreIntakeRoutes({} as any, { message: "My laptop is not working", urgency: "medium" });

    expect(decision.provider).toBe("provara");
    expect(decision.winner).toMatchObject({ route: "incident", probability: 0.9 });
    expect(decision.scores.find((score) => score.route === "incident")?.rationale).toContain("laptop issue");
  });
});
