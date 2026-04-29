import { describe, expect, it, vi } from "vitest";
import { getPasswordPolicy, normalizePasswordPolicy, validatePasswordAgainstPolicy } from "./passwordPolicy";

describe("password policy", () => {
  it("normalizes malformed policy values to safe bounds", () => {
    expect(normalizePasswordPolicy({ minLength: 3, maxLength: 500, requireNumber: true })).toEqual({
      minLength: 8,
      maxLength: 256,
      requireNumber: true,
      requireSymbol: false,
      requireUppercase: false,
      requireLowercase: false,
    });
  });

  it("loads policy from system properties with defaults when missing", async () => {
    const pg = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(getPasswordPolicy(pg)).resolves.toMatchObject({ minLength: 8, maxLength: 128 });
  });

  it("validates all configured password requirements", () => {
    const result = validatePasswordAgainstPolicy("short", {
      minLength: 10,
      maxLength: 128,
      requireNumber: true,
      requireSymbol: true,
      requireUppercase: true,
      requireLowercase: true,
    });

    expect(result.valid).toBe(false);
    expect(result.failures).toEqual([
      "Use at least 10 characters.",
      "Include at least one number.",
      "Include at least one symbol.",
      "Include at least one uppercase letter.",
    ]);
  });
});
