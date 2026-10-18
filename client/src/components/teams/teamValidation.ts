import {
  TEAM_GOALS,
  TEAM_ROLES,
  TEAM_NAME_MAX,
  TEAM_PITCH_MAX,
  TEAM_LINK_MAX,
  TEAM_MAX_COMMITMENT_HOURS,
  VACANCY_SKILLS_MAX,
  VACANCY_SKILL_MAX_LENGTH,
  REMOVAL_REASON_MAX,
  type TeamGoal,
  type ParticipantPrimaryRole,
  type TeamFieldErrors,
  type TeamListingFormValues,
  type UpdateTeamPayload,
} from './teamTypes';
import { isValidHttpsPortfolioUrl } from '../profile/profileValidation';

/**
 * Counts UTF-32 code points in a string (e.g. emojis count as 1 character).
 */
export function codePointLength(s: string): number {
  return [...s].length;
}

/**
 * Normalizes goal string case-insensitively to canonical TeamGoal casing.
 */
export function normalizeGoal(raw: unknown): TeamGoal | null {
  if (typeof raw !== 'string') return null;
  const collapsed = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  if (collapsed === 'learning') return 'Learning';
  if (collapsed === 'project completion') return 'Project Completion';
  if (collapsed === 'competitive') return 'Competitive';
  return null;
}

/**
 * Validates team create/edit form state on the client.
 * Returns field errors and parsed payload without modifying caller's state.
 */
export function validateTeamListingForm(
  values: TeamListingFormValues,
  mode: 'create' | 'edit' = 'create',
  initialValues?: Partial<TeamListingFormValues>
): {
  errors: TeamFieldErrors;
  payload?: UpdateTeamPayload;
} {
  const errors: TeamFieldErrors = {};

  // 1. Name
  const trimmedName = values.name.trim();
  if (trimmedName.length === 0) {
    errors.name = 'Team name is required.';
  } else if (codePointLength(trimmedName) > TEAM_NAME_MAX) {
    errors.name = `Team name cannot exceed ${TEAM_NAME_MAX} characters.`;
  }

  // 2. Pitch
  const normalizedPitch = values.pitch.replace(/\r\n/g, '\n').trim();
  if (normalizedPitch.length === 0) {
    errors.pitch = 'Pitch is required.';
  } else if (codePointLength(normalizedPitch) > TEAM_PITCH_MAX) {
    errors.pitch = `Pitch cannot exceed ${TEAM_PITCH_MAX} characters.`;
  }

  // 3. Goal
  const canonicalGoal = normalizeGoal(values.goal);
  if (!canonicalGoal) {
    errors.goal = `Invalid team goal. Must be ${TEAM_GOALS.join(', ')}.`;
  }

  // 4. Commitment Hours
  const trimmedHours = values.commitmentHours.trim();
  let parsedHours: number | undefined;
  if (trimmedHours.length === 0 || !/^\d+(\.\d+)?$/.test(trimmedHours)) {
    errors.commitmentHours =
      'Commitment hours must be a number between 0 and 168 with at most one decimal place.';
  } else {
    const num = Number(trimmedHours);
    if (!Number.isFinite(num) || num < 0 || num > TEAM_MAX_COMMITMENT_HOURS) {
      errors.commitmentHours = `Commitment hours must be between 0 and ${TEAM_MAX_COMMITMENT_HOURS}.`;
    } else {
      const parts = trimmedHours.split('.');
      if (parts[1] && parts[1].length > 1) {
        errors.commitmentHours = 'Commitment hours cannot have more than 1 decimal place.';
      } else {
        parsedHours = num;
      }
    }
  }

  // 5. Communication link
  let sanitizedLink: string | null = null;
  const trimmedLink = values.communicationLink.trim();
  if (trimmedLink.length === 0) {
    sanitizedLink = null;
  } else {
    if (trimmedLink.length > TEAM_LINK_MAX || !isValidHttpsPortfolioUrl(trimmedLink)) {
      errors.communicationLink =
        'Communication link must be a valid HTTPS URL (max 2048 characters) without credentials.';
    } else {
      sanitizedLink = trimmedLink;
    }
  }

  // Edit mode: check if any changes were made when initialValues are provided
  if (mode === 'edit' && initialValues && Object.keys(errors).length === 0) {
    const initialName = (initialValues.name ?? '').trim();
    const initialPitch = (initialValues.pitch ?? '').replace(/\r\n/g, '\n').trim();
    const initialGoal = normalizeGoal(initialValues.goal);
    const initialHours = (initialValues.commitmentHours ?? '').trim();
    const initialLink = (initialValues.communicationLink ?? '').trim();
    const normalizedInitialLink = initialLink.length > 0 ? initialLink : null;

    const noChanges =
      trimmedName === initialName &&
      normalizedPitch === initialPitch &&
      canonicalGoal === initialGoal &&
      trimmedHours === initialHours &&
      sanitizedLink === normalizedInitialLink;

    if (noChanges) {
      errors._form = 'No changes provided.';
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    errors: {},
    payload: {
      name: trimmedName,
      pitch: normalizedPitch,
      goal: canonicalGoal!,
      commitmentHours: parsedHours!,
      communicationLink: sanitizedLink,
    },
  };
}

/**
 * Validates vacancy slot creation/editing form.
 */
export function validateVacancyForm(values: {
  role: string;
  skillsInput: string;
}): {
  errors: TeamFieldErrors;
  payload?: { role: ParticipantPrimaryRole; skills: string[] };
} {
  const errors: TeamFieldErrors = {};

  // 1. Role
  let canonicalRole: ParticipantPrimaryRole | null = null;
  const rawRole = values.role.trim().toLowerCase();
  if (rawRole.length === 0) {
    errors.role = 'Role is required.';
  } else {
    const match = TEAM_ROLES.find((r) => r.toLowerCase() === rawRole);
    if (!match) {
      errors.role = `Invalid role. Must be one of: ${TEAM_ROLES.join(', ')}.`;
    } else {
      canonicalRole = match;
    }
  }

  // 2. Skills
  const sanitizedSkills: string[] = [];
  const rawSkillsText = values.skillsInput.trim();
  if (rawSkillsText.length > 0) {
    const rawTokens = rawSkillsText.split(',');
    const seenLower = new Set<string>();
    let skillError: string | null = null;

    for (const token of rawTokens) {
      const cleaned = token.trim().replace(/\s+/g, ' ');
      const len = codePointLength(cleaned);
      if (len === 0 || len > VACANCY_SKILL_MAX_LENGTH) {
        skillError = `Each skill must be between 1 and ${VACANCY_SKILL_MAX_LENGTH} characters.`;
        break;
      }
      const lower = cleaned.toLowerCase();
      if (!seenLower.has(lower)) {
        seenLower.add(lower);
        sanitizedSkills.push(cleaned);
      }
    }

    if (skillError) {
      errors.skills = skillError;
    } else if (sanitizedSkills.length > VACANCY_SKILLS_MAX) {
      errors.skills = `Cannot have more than ${VACANCY_SKILLS_MAX} skills per vacancy.`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    errors: {},
    payload: {
      role: canonicalRole!,
      skills: sanitizedSkills,
    },
  };
}

/**
 * Validates removal reason for member removal.
 */
export function validateRemovalReason(text: string): {
  errors: TeamFieldErrors;
  sanitized?: { reason: string };
} {
  const errors: TeamFieldErrors = {};
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    errors.reason = 'Removal reason is required.';
  } else if (codePointLength(trimmed) > REMOVAL_REASON_MAX) {
    errors.reason = `Removal reason cannot exceed ${REMOVAL_REASON_MAX} characters.`;
  } else {
    return { errors: {}, sanitized: { reason: trimmed } };
  }

  return { errors };
}
