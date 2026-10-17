export const PRIMARY_ROLES = [
  'Frontend',
  'Backend',
  'Mobile',
  'AI/ML',
  'UI/UX',
  'Pitch',
] as const;

export type ParticipantPrimaryRole = (typeof PRIMARY_ROLES)[number];

export interface PortfolioLinkFormItem {
  url: string;
  label: string;
}

export interface ProfileFormState {
  handle: string;
  primaryRole: string;
  institution: string;
  skillsInput: string;
  portfolioLinks: PortfolioLinkFormItem[];
  sharedContactHandle: string;
}

export interface ProfileFieldErrors {
  handle?: string;
  primaryRole?: string;
  institution?: string;
  skills?: string;
  portfolioLinks?: string;
  sharedContactHandle?: string;
}

export interface ValidatedProfilePayload {
  handle: string | null;
  primaryRole: ParticipantPrimaryRole | null;
  institution: string | null;
  skills: string[];
  portfolioLinks: Array<{ url: string; label: string | null }>;
  sharedContactHandle: string | null;
}

const HANDLE_REGEX = /^[A-Za-z0-9_-]{2,50}$/;

/**
 * Validates that a portfolio URL is a well-formed HTTPS URL per US-006 AC 2 / FR-013.
 */
export function isValidHttpsPortfolioUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (trimmed.length <= 8 || trimmed.length > 2048) return false;
  if (!trimmed.toLowerCase().startsWith('https://')) return false;
  if (/\s/.test(trimmed)) return false;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username !== '' || parsed.password !== '') return false;

    const host = parsed.hostname;
    if (!host || !host.includes('.') || host.startsWith('.') || host.endsWith('.')) {
      return false;
    }
    const labels = host.split('.');
    if (labels.some((label) => label.length === 0)) {
      return false;
    }
    const tld = labels[labels.length - 1]!;
    if (tld.length < 2 || /^\d+$/.test(tld)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses comma-separated skill tags into a trimmed, case-insensitively deduplicated array.
 */
export function parseSkillsInput(skillsInput: string): {
  skills: string[];
  error?: string;
} {
  if (!skillsInput || skillsInput.trim().length === 0) {
    return { skills: [] };
  }

  const rawTokens = skillsInput.split(',');
  const skills: string[] = [];
  const seen = new Set<string>();

  for (const token of rawTokens) {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      return {
        skills: [],
        error: 'Each skill tag must be a non-empty string (avoid trailing or empty commas).',
      };
    }
    if (trimmed.length > 50) {
      return {
        skills: [],
        error: 'Each skill tag must not exceed 50 characters.',
      };
    }
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      skills.push(trimmed);
    }
  }

  if (skills.length > 25) {
    return {
      skills: [],
      error: 'You can specify at most 25 skill tags.',
    };
  }

  return { skills };
}

/**
 * Validates the participant profile form state on the client (US-006 AC 1, AC 2, AC 5).
 * Returns field-specific errors without mutating or clearing the caller's form state.
 */
export function validateProfileForm(state: ProfileFormState): {
  errors: ProfileFieldErrors;
  payload?: ValidatedProfilePayload;
} {
  const errors: ProfileFieldErrors = {};

  // 1. Handle
  let handle: string | null = null;
  const trimmedHandle = state.handle.trim();
  if (trimmedHandle.length > 0) {
    if (!HANDLE_REGEX.test(trimmedHandle)) {
      errors.handle =
        'Handle must be 2 to 50 characters and contain only letters, numbers, underscores, or hyphens.';
    } else {
      handle = trimmedHandle;
    }
  }

  // 2. Primary role
  let primaryRole: ParticipantPrimaryRole | null = null;
  const trimmedRole = state.primaryRole.trim();
  if (trimmedRole.length > 0) {
    if (!PRIMARY_ROLES.includes(trimmedRole as ParticipantPrimaryRole)) {
      errors.primaryRole = `Primary role must be one of: ${PRIMARY_ROLES.join(', ')}.`;
    } else {
      primaryRole = trimmedRole as ParticipantPrimaryRole;
    }
  }

  // 3. Institution
  let institution: string | null = null;
  const trimmedInstitution = state.institution.trim();
  if (trimmedInstitution.length > 150) {
    errors.institution = 'Academic institution must not exceed 150 characters.';
  } else if (trimmedInstitution.length > 0) {
    institution = trimmedInstitution;
  }

  // 4. Skills
  const { skills, error: skillsError } = parseSkillsInput(state.skillsInput);
  if (skillsError) {
    errors.skills = skillsError;
  }

  // 5. Portfolio links
  const portfolioLinks: Array<{ url: string; label: string | null }> = [];
  const nonEmptyLinks = state.portfolioLinks.filter(
    (item) => item.url.trim().length > 0 || item.label.trim().length > 0
  );

  if (nonEmptyLinks.length > 10) {
    errors.portfolioLinks = 'You can provide at most 10 portfolio links.';
  } else {
    for (const item of nonEmptyLinks) {
      const trimmedUrl = item.url.trim();
      const trimmedLabel = item.label.trim();
      if (!isValidHttpsPortfolioUrl(trimmedUrl)) {
        errors.portfolioLinks =
          'All portfolio links must be valid HTTPS URLs (e.g., https://github.com/username).';
        break;
      }
      if (trimmedLabel.length > 100) {
        errors.portfolioLinks = 'Portfolio link label must not exceed 100 characters.';
        break;
      }
      portfolioLinks.push({
        url: trimmedUrl,
        label: trimmedLabel.length > 0 ? trimmedLabel : null,
      });
    }
  }

  // 6. Shared contact handle
  let sharedContactHandle: string | null = null;
  const trimmedContact = state.sharedContactHandle.trim();
  if (trimmedContact.length > 150) {
    errors.sharedContactHandle = 'Shared contact handle must not exceed 150 characters.';
  } else if (trimmedContact.length > 0) {
    sharedContactHandle = trimmedContact;
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    errors: {},
    payload: {
      handle,
      primaryRole,
      institution,
      skills,
      portfolioLinks,
      sharedContactHandle,
    },
  };
}
