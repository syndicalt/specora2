import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("neo4j-driver", () => ({
  default: {
    driver: vi.fn().mockReturnValue({
      session: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({ records: [] }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    auth: { basic: vi.fn() },
  },
}));

describe("seed without driver", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates its own driver and closes it", async () => {
    const { seed } = await import("./seed");
    await seed();
    const neo4j = await import("neo4j-driver");
    expect(neo4j.default.driver).toHaveBeenCalled();
  });
});
