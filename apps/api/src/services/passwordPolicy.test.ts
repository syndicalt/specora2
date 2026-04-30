import { describe, expect, it, vi } from "vitest";
import { getPasswordPolicy, normalizePasswordPolicy, passwordPolicyMessage, validatePasswordAgainstPolicy } from "./passwordPolicy";

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

  it("loads configured policy and falls back when stored JSON is invalid", async () => {
    const configuredPg = { query: vi.fn().mockResolvedValue({ rows: [{ value: JSON.stringify({ minLength: 12, maxLength: 64, requireSymbol: true, requireLowercase: true }) }] }) };
    await expect(getPasswordPolicy(configuredPg)).resolves.toEqual({
      minLength: 12,
      maxLength: 64,
      requireNumber: false,
      requireSymbol: true,
      requireUppercase: false,
      requireLowercase: true,
    });

    const invalidPg = { query: vi.fn().mockResolvedValue({ rows: [{ value: "{not-json" }] }) };
    await expect(getPasswordPolicy(invalidPg)).resolves.toMatchObject({ minLength: 8, maxLength: 128 });
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

  it("validates maximum length and renders a human policy message", () => {
    const policy = {
      minLength: 8,
      maxLength: 10,
      requireNumber: true,
      requireSymbol: true,
      requireUppercase: true,
      requireLowercase: true,
    };

    expect(validatePasswordAgainstPolicy("VeryLongPassword1!", policy)).toEqual({
      valid: false,
      failures: ["Use no more than 10 characters."],
    });
    expect(validatePasswordAgainstPolicy("Aa123456!", policy)).toEqual({ valid: true, failures: [] });
    expect(passwordPolicyMessage(policy)).toBe("Password must include between 8 and 10 characters, a number, a symbol, an uppercase letter, a lowercase letter.");
  });
});
