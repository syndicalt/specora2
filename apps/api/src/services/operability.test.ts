import { describe, expect, it } from "vitest";
import { buildConfigAudit } from "./operability";

describe("operability config audit", () => {
  it("fails missing required production configuration", () => {
    const audit = buildConfigAudit({});

    expect(audit.status).toBe("fail");
    expect(audit.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "DATABASE_URL", status: "fail" }),
      expect.objectContaining({ key: "JWT_SECRET_STRENGTH", status: "fail" }),
    ]));
  });

  it("passes required configuration and warns on optional integrations", () => {
    const audit = buildConfigAudit({
      DATABASE_URL: "postgres://example",
      NEO4J_URI: "bolt://example",
      NEO4J_USER: "neo4j",
      NEO4J_PASSWORD: "secret",
      JWT_SECRET: "a-production-grade-secret-with-enough-length",
    });

    expect(audit.failures).toBe(0);
    expect(audit.status).toBe("warn");
    expect(audit.warnings).toBeGreaterThan(0);
  });
});
