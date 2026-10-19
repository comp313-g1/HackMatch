/** Client types for US-015 FR-043–045 compatibility scoring dry-run. */

export const SCORING_ROLES = [
  'Frontend',
  'Backend',
  'Mobile',
  'AI/ML',
  'UI/UX',
  'Pitch',
] as const;

export const SCORING_GOALS = ['Learning', 'Project Completion', 'Competitive'] as const;

export const SCORING_MAX_COMMITMENT_HOURS = 168;

export type ScoringRole = (typeof SCORING_ROLES)[number];
export type ScoringGoal = (typeof SCORING_GOALS)[number];

export interface SlotScoringFormState {
  role: string;
  requiredSkillsInput: string;
  requestedHours: string;
  goal: string;
}

export interface CandidateScoringFormState {
  primaryRole: string;
  skillsInput: string;
  commitmentHours: string;
  goal: string;
  displayHandle: string;
}

export interface CompatibilityScoreFieldErrors {
  role?: string;
  requiredSkills?: string;
  requestedHours?: string;
  goal?: string;
  primaryRole?: string;
  skills?: string;
  commitmentHours?: string;
  candidateGoal?: string;
  body?: string;
  _form?: string;
}

export interface CompatibilityComponents {
  skill: number;
  goal: number;
  hours: number;
}

export interface CompatibilityScoreSuccess {
  status: 'ok';
  score: number;
  displayScore: string;
  components: CompatibilityComponents;
  matchedSkills: string[];
  roleMatched: boolean;
  hadMissingInput: boolean;
  contributions: {
    skill: string;
    goal: string;
    hours: string;
  };
  notice: string;
}

export interface CompatibilityScorePayload {
  slot: {
    role: string | null;
    requiredSkills: string[];
    requestedHours: number | null;
    goal: string | null;
  };
  candidate: {
    primaryRole: string | null;
    skills: string[];
    commitmentHours: number | null;
    goal: string | null;
    displayHandle?: string | null;
  };
}
