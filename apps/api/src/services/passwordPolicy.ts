export type PasswordPolicy = {
  minLength: number;
  maxLength: number;
  requireNumber: boolean;
  requireSymbol: boolean;
  requireUppercase: boolean;
  requireLowercase: boolean;
};

export type PasswordPolicyCheck = {
  valid: boolean;
  failures: string[];
};

const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  maxLength: 128,
  requireNumber: false,
  requireSymbol: false,
  requireUppercase: false,
  requireLowercase: false,
};

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

export function normalizePasswordPolicy(value: unknown): PasswordPolicy {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const minLength = boundedInteger(source.minLength, DEFAULT_PASSWORD_POLICY.minLength, 8, 128);
  const maxLength = boundedInteger(source.maxLength, DEFAULT_PASSWORD_POLICY.maxLength, minLength, 256);
  return {
    minLength,
    maxLength,
    requireNumber: Boolean(source.requireNumber),
    requireSymbol: Boolean(source.requireSymbol),
    requireUppercase: Boolean(source.requireUppercase),
    requireLowercase: Boolean(source.requireLowercase),
  };
}

export async function getPasswordPolicy(pg: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }): Promise<PasswordPolicy> {
  const result = await pg.query("SELECT value FROM system_properties WHERE key = 'security.password_policy'");
  if (!result.rows.length) return DEFAULT_PASSWORD_POLICY;
  try {
    const row = result.rows[0] as { value?: unknown };
    return normalizePasswordPolicy(JSON.parse(String(row.value || "{}")));
  } catch {
    return DEFAULT_PASSWORD_POLICY;
  }
}

export function validatePasswordAgainstPolicy(password: string, policy: PasswordPolicy): PasswordPolicyCheck {
  const failures: string[] = [];
  if (password.length < policy.minLength) failures.push(`Use at least ${policy.minLength} characters.`);
  if (password.length > policy.maxLength) failures.push(`Use no more than ${policy.maxLength} characters.`);
  if (policy.requireNumber && !/[0-9]/.test(password)) failures.push("Include at least one number.");
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) failures.push("Include at least one symbol.");
  if (policy.requireUppercase && !/[A-Z]/.test(password)) failures.push("Include at least one uppercase letter.");
  if (policy.requireLowercase && !/[a-z]/.test(password)) failures.push("Include at least one lowercase letter.");
  return { valid: failures.length === 0, failures };
}

export function passwordPolicyMessage(policy: PasswordPolicy) {
  const requirements = [`between ${policy.minLength} and ${policy.maxLength} characters`];
  if (policy.requireNumber) requirements.push("a number");
  if (policy.requireSymbol) requirements.push("a symbol");
  if (policy.requireUppercase) requirements.push("an uppercase letter");
  if (policy.requireLowercase) requirements.push("a lowercase letter");
  return `Password must include ${requirements.join(", ")}.`;
}
