export interface ValidationErrors {
  fullName?: string;
  email?: string;
  password?: string;
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

  const trimmedEmail = email ? email.trim() : '';
  if (!trimmedEmail) {
    errors.email = 'Email address is required.';
  } else {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(trimmedEmail)) {
      errors.email = 'Please enter a valid email address.';
    }
  }

  if (!password) {
    errors.password = 'Password is required.';
  } else {
    const isMinLength = password.length >= 8;
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);

    if (!isMinLength || !hasUpper || !hasLower || !hasDigit || !hasSpecial) {
      errors.password =
        'Password must be at least 8 characters long and include uppercase, lowercase, a number, and a special character.';
    }
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
