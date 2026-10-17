export interface ValidationErrors {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shared registration / password-reset policy copy (US-001 / US-005 AC 3). */
export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters long and include uppercase, lowercase, a number, and a special character.';

/**
 * Returns true when password meets the registration policy (US-001 / FR-001 / US-005 AC 3).
 */
export function isPasswordPolicyCompliant(password: string): boolean {
  if (!password || password.length < 8) return false;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  return hasUpper && hasLower && hasDigit && hasSpecial;
}

/**
 * Validates a new password field. Returns null if valid.
 */
export function validatePassword(password: string): string | null {
  if (!password) {
    return 'Password is required.';
  }
  if (!isPasswordPolicyCompliant(password)) {
    return PASSWORD_POLICY_MESSAGE;
  }
  return null;
}

/**
 * Validates password confirmation for reset forms. Preserves pairing with `password`.
 */
export function validatePasswordConfirmation(
  password: string,
  confirmPassword: string
): string | null {
  if (!confirmPassword) {
    return 'Please confirm your new password.';
  }
  if (password !== confirmPassword) {
    return 'Passwords do not match.';
  }
  return null;
}

/**
 * Validates email format per US-001 / FR-001.
 * Returns null if valid, error message string if invalid.
 */
export function validateEmail(email: string): string | null {
  const trimmedEmail = email ? email.trim() : '';
  if (!trimmedEmail) {
    return 'Email address is required.';
  }
  if (!EMAIL_PATTERN.test(trimmedEmail)) {
    return 'Please enter a valid email address.';
  }
  return null;
}

/**
 * Validates registration form inputs per US-001 acceptance criteria:
 * - Full name is required and non-empty.
 * - Email format is validated (academic domain not required per AC 1 / FR-001).
 * - Password must be at least 8 chars with mixed case, digit, and special character.
 */
export function validateRegistrationInput(
  fullName: string,
  email: string,
  password: string
): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!fullName || !fullName.trim()) {
    errors.fullName = 'Full name is required.';
  }

  const emailError = validateEmail(email);
  if (emailError) {
    errors.email = emailError;
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    errors.password = passwordError;
  }

  return errors;
}

export const PROHIBITED_PRIVILEGE_KEYS = [
  'role',
  'isAdmin',
  'is_admin',
  'claims',
  'customClaims',
  'roles',
] as const;

/**
 * Validates that a registration payload contains no administrative
 * privilege or role parameters (US-001 AC 4 / FR-001).
 * Returns true if clean, false if privilege escalation attributes are present.
 */
export function assertNoPrivilegeEscalation(
  payload: Record<string, unknown>
): boolean {
  if (!payload || typeof payload !== 'object') {
    return true;
  }
  for (const key of PROHIBITED_PRIVILEGE_KEYS) {
    if (payload[key] !== undefined && payload[key] !== null) {
      return false;
    }
  }
  return true;
}
