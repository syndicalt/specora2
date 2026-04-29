export type PasswordPolicy = {
  minLength: number;
  maxLength: number;
  requireNumber: boolean;
  requireSymbol: boolean;
  requireUppercase: boolean;
  requireLowercase: boolean;
};

export type PasswordPolicyRequirement = {
  id: string;
  label: string;
  met: boolean;
};

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  maxLength: 128,
  requireNumber: false,
  requireSymbol: false,
  requireUppercase: false,
  requireLowercase: false,
};

export function normalizePasswordPolicy(policy?: Partial<PasswordPolicy> | null): PasswordPolicy {
  return {
    minLength: Number.isInteger(policy?.minLength) ? Math.max(8, Number(policy?.minLength)) : DEFAULT_PASSWORD_POLICY.minLength,
    maxLength: Number.isInteger(policy?.maxLength) ? Math.max(Number(policy?.maxLength), Number(policy?.minLength || DEFAULT_PASSWORD_POLICY.minLength)) : DEFAULT_PASSWORD_POLICY.maxLength,
    requireNumber: Boolean(policy?.requireNumber),
    requireSymbol: Boolean(policy?.requireSymbol),
    requireUppercase: Boolean(policy?.requireUppercase),
    requireLowercase: Boolean(policy?.requireLowercase),
  };
}

export function passwordPolicyRequirements(password: string, policy: PasswordPolicy): PasswordPolicyRequirement[] {
  return [
    { id: "length", label: `${policy.minLength}-${policy.maxLength} characters`, met: password.length >= policy.minLength && password.length <= policy.maxLength },
    ...(policy.requireNumber ? [{ id: "number", label: "At least one number", met: /[0-9]/.test(password) }] : []),
    ...(policy.requireSymbol ? [{ id: "symbol", label: "At least one symbol", met: /[^A-Za-z0-9]/.test(password) }] : []),
    ...(policy.requireUppercase ? [{ id: "uppercase", label: "At least one uppercase letter", met: /[A-Z]/.test(password) }] : []),
    ...(policy.requireLowercase ? [{ id: "lowercase", label: "At least one lowercase letter", met: /[a-z]/.test(password) }] : []),
  ];
}

export function passwordMeetsPolicy(password: string, policy: PasswordPolicy) {
  return passwordPolicyRequirements(password, policy).every((requirement) => requirement.met);
}
