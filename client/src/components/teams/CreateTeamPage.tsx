import React, { useState } from 'react';
import {
  TEAM_GOALS,
  TEAM_ROLES,
  TEAM_PITCH_MAX,
  type TeamView,
  type TeamFieldErrors,
  type TeamGoal,
  type ParticipantPrimaryRole,
} from './teamTypes';
import { codePointLength } from './teamValidation';
import { createTeam, addVacancy, TeamApiError, AuthRequiredError } from './teamApi';

export interface CreateTeamPageProps {
  onCancel: () => void;
  onCreated: (team: TeamView) => void;
}

interface VacancyDraft {
  id: string;
  role: ParticipantPrimaryRole;
  skills: string[];
  skillsInput: string;
}

const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';

export function CreateTeamPage({ onCancel, onCreated }: CreateTeamPageProps): React.JSX.Element {
  // Team details
  const [name, setName] = useState('');
  const [pitch, setPitch] = useState('');
  const [goal, setGoal] = useState<TeamGoal>('Learning');
  const [commitmentHours, setCommitmentHours] = useState('10');
  const [communicationLink, setCommunicationLink] = useState('');
  const [maxTeamSize, setMaxTeamSize] = useState('4');

  // Vacancy drafts (up to maxTeamSize - 1 slots for open positions)
  const [vacancies, setVacancies] = useState<VacancyDraft[]>([]);
  const [vacancyRole, setVacancyRole] = useState<ParticipantPrimaryRole>(TEAM_ROLES[0]);
  const [vacancySkills, setVacancySkills] = useState('');
  const [vacancyError, setVacancyError] = useState<string | null>(null);

  // Submission state
  const [fieldErrors, setFieldErrors] = useState<TeamFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pitchCount = codePointLength(pitch);
  const parsedMaxTeamSize = Math.max(2, Math.min(20, Number(maxTeamSize) || 4));
  const maxVacancies = Math.max(1, parsedMaxTeamSize - 1);

  const handleAddVacancy = (e: React.FormEvent) => {
    e.preventDefault();
    if (vacancies.length >= maxVacancies) {
      setVacancyError(`You can add at most ${maxVacancies} initial vacancy slots.`);
      return;
    }

    const skills = vacancySkills
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (skills.length > 10) {
      setVacancyError('At most 10 skills allowed per vacancy.');
      return;
    }

    for (const skill of skills) {
      if (skill.length > 50) {
        setVacancyError(`Skill "${skill}" exceeds 50 characters.`);
        return;
      }
    }

    setVacancies((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: vacancyRole,
        skills,
        skillsInput: vacancySkills,
      },
    ]);
    setVacancySkills('');
    setVacancyError(null);
  };

  const handleRemoveVacancy = (id: string) => {
    setVacancies((prev) => prev.filter((v) => v.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const errors: TeamFieldErrors = {};

    if (!name.trim()) {
      errors.name = 'Team name is required.';
    } else if (codePointLength(name.trim()) > 100) {
      errors.name = 'Team name cannot exceed 100 characters.';
    }

    if (!pitch.trim()) {
      errors.pitch = 'Description / pitch is required.';
    } else if (codePointLength(pitch.trim()) > TEAM_PITCH_MAX) {
      errors.pitch = `Description cannot exceed ${TEAM_PITCH_MAX} characters.`;
    }

    const hoursNum = Number(commitmentHours);
    if (!Number.isFinite(hoursNum) || hoursNum < 0 || hoursNum > 168) {
      errors.commitmentHours = 'Commitment hours must be between 0 and 168.';
    }

    const teamSizeNum = Number(maxTeamSize);
    if (!Number.isInteger(teamSizeNum) || teamSizeNum < 2 || teamSizeNum > 20) {
      errors.maxTeamSize = 'Maximum team size must be an integer between 2 and 20.';
    }

    if (communicationLink.trim()) {
      try {
        const parsed = new URL(communicationLink.trim());
        if (parsed.protocol !== 'https:') {
          errors.communicationLink = 'Communication link must use HTTPS.';
        }
      } catch {
        errors.communicationLink = 'Communication link must be a valid HTTPS URL.';
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError('Please resolve the errors below.');
      return;
    }

    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    try {
      // 1. Create team (shadow event auto-created by backend with owner's configured team size)
      let createdTeam = await createTeam({
        name: name.trim(),
        pitch: pitch.trim(),
        goal,
        commitmentHours: hoursNum,
        communicationLink: communicationLink.trim() || null,
        maxTeamSize: teamSizeNum,
      });

      // 2. Add any configured vacancies sequentially
      for (const draft of vacancies) {
        try {
          createdTeam = await addVacancy(createdTeam.id, {
            role: draft.role,
            skills: draft.skills,
          });
        } catch (vacErr) {
          console.warn('Failed to add initial vacancy draft:', vacErr);
        }
      }

      onCreated(createdTeam);
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setFormError('You need to sign in to create a team.');
      } else if (err instanceof TeamApiError) {
        if (err.errors) {
          setFieldErrors(err.errors);
        }
        setFormError(err.message || 'Failed to create team.');
      } else {
        setFormError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-forest-800 hover:text-forest-900 hover:underline focus:outline-none focus:ring-2 focus:ring-forest rounded px-2 py-1 mb-2"
          >
            ← Back to My Teams
          </button>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-ink">
            Create a New Team
          </h1>
          <p className="mt-1 font-sans text-sm text-ink-muted">
            Set up your team profile and list open roles for participants to join.
          </p>
        </div>
      </div>

      {formError && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md text-red-900 text-sm"
        >
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-8">
        {/* Section 1: Team Details */}
        <div className="rounded-lg border border-cream-200 bg-white p-6 shadow-sm space-y-6">
          <h2 className="font-display text-lg font-semibold text-ink border-b border-cream-200 pb-2">
            Team Details
          </h2>

          {/* Team Name */}
          <div>
            <label htmlFor="team-name" className="block text-sm font-medium text-ink mb-1">
              Team Name <span className="text-red-600">*</span>
            </label>
            <input
              id="team-name"
              type="text"
              required
              disabled={submitting}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }));
              }}
              placeholder="e.g. Deep Root"
              className={`${inputClass} ${fieldErrors.name ? 'border-red-500' : 'border-cream-300'}`}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? 'team-name-error' : undefined}
            />
            {fieldErrors.name && (
              <p id="team-name-error" className="mt-1 text-xs text-red-600 font-medium">
                {fieldErrors.name}
              </p>
            )}
          </div>

          {/* Description / Pitch */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label htmlFor="team-pitch" className="block text-sm font-medium text-ink">
                Description / Pitch <span className="text-red-600">*</span>
              </label>
              <span
                className={`text-xs ${
                  pitchCount > TEAM_PITCH_MAX ? 'text-red-600 font-semibold' : 'text-ink-muted'
                }`}
              >
                {pitchCount} / {TEAM_PITCH_MAX}
              </span>
            </div>
            <textarea
              id="team-pitch"
              rows={4}
              required
              disabled={submitting}
              value={pitch}
              onChange={(e) => {
                setPitch(e.target.value);
                if (fieldErrors.pitch) setFieldErrors((prev) => ({ ...prev, pitch: undefined }));
              }}
              placeholder="Briefly describe what your team is building and the problem it solves."
              className={`${inputClass} ${fieldErrors.pitch ? 'border-red-500' : 'border-cream-300'}`}
              aria-invalid={Boolean(fieldErrors.pitch)}
              aria-describedby={fieldErrors.pitch ? 'team-pitch-error' : undefined}
            />
            {fieldErrors.pitch && (
              <p id="team-pitch-error" className="mt-1 text-xs text-red-600 font-medium">
                {fieldErrors.pitch}
              </p>
            )}
          </div>

          {/* Goal, Commitment, and Team Size */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="team-goal" className="block text-sm font-medium text-ink mb-1">
                Goal <span className="text-red-600">*</span>
              </label>
              <select
                id="team-goal"
                disabled={submitting}
                value={goal}
                onChange={(e) => setGoal(e.target.value as TeamGoal)}
                className={`${inputClass} border-cream-300`}
              >
                {TEAM_GOALS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="team-hours" className="block text-sm font-medium text-ink mb-1">
                Estimated Hours/Week <span className="text-red-600">*</span>
              </label>
              <input
                id="team-hours"
                type="number"
                min="0"
                max="168"
                step="0.5"
                required
                disabled={submitting}
                value={commitmentHours}
                onChange={(e) => {
                  setCommitmentHours(e.target.value);
                  if (fieldErrors.commitmentHours) {
                    setFieldErrors((prev) => ({ ...prev, commitmentHours: undefined }));
                  }
                }}
                className={`${inputClass} ${
                  fieldErrors.commitmentHours ? 'border-red-500' : 'border-cream-300'
                }`}
                aria-invalid={Boolean(fieldErrors.commitmentHours)}
                aria-describedby={fieldErrors.commitmentHours ? 'team-hours-error' : undefined}
              />
              {fieldErrors.commitmentHours && (
                <p id="team-hours-error" className="mt-1 text-xs text-red-600 font-medium">
                  {fieldErrors.commitmentHours}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="team-max-size" className="block text-sm font-medium text-ink mb-1">
                Max Team Size <span className="text-red-600">*</span>
              </label>
              <input
                id="team-max-size"
                type="number"
                min="2"
                max="20"
                step="1"
                required
                disabled={submitting}
                value={maxTeamSize}
                onChange={(e) => {
                  setMaxTeamSize(e.target.value);
                  if (fieldErrors.maxTeamSize) {
                    setFieldErrors((prev) => ({ ...prev, maxTeamSize: undefined }));
                  }
                }}
                className={`${inputClass} ${
                  fieldErrors.maxTeamSize ? 'border-red-500' : 'border-cream-300'
                }`}
                aria-invalid={Boolean(fieldErrors.maxTeamSize)}
                aria-describedby={fieldErrors.maxTeamSize ? 'team-max-size-error' : undefined}
              />
              {fieldErrors.maxTeamSize && (
                <p id="team-max-size-error" className="mt-1 text-xs text-red-600 font-medium">
                  {fieldErrors.maxTeamSize}
                </p>
              )}
            </div>
          </div>

          {/* Communication Link */}
          <div>
            <label htmlFor="team-link" className="block text-sm font-medium text-ink mb-1">
              Communication Channel Link{' '}
              <span className="text-xs text-ink-muted">(Optional, HTTPS)</span>
            </label>
            <input
              id="team-link"
              type="url"
              disabled={submitting}
              value={communicationLink}
              onChange={(e) => {
                setCommunicationLink(e.target.value);
                if (fieldErrors.communicationLink) {
                  setFieldErrors((prev) => ({ ...prev, communicationLink: undefined }));
                }
              }}
              placeholder="https://discord.gg/your-channel or https://slack.com/..."
              className={`${inputClass} ${
                fieldErrors.communicationLink ? 'border-red-500' : 'border-cream-300'
              }`}
              aria-invalid={Boolean(fieldErrors.communicationLink)}
              aria-describedby={fieldErrors.communicationLink ? 'team-link-error' : undefined}
            />
            {fieldErrors.communicationLink && (
              <p id="team-link-error" className="mt-1 text-xs text-red-600 font-medium">
                {fieldErrors.communicationLink}
              </p>
            )}
          </div>
        </div>

        {/* Section 2: Open Roles / Vacancies */}
        <div className="rounded-lg border border-cream-200 bg-white p-6 shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-cream-200 pb-2">
            <div>
              <h2 className="font-display text-lg font-semibold text-ink">
                Initial Vacancy Slots
              </h2>
              <p className="text-xs text-ink-muted">
                Add roles you are recruiting for (up to {maxVacancies} slots, team max size is {parsedMaxTeamSize}).
              </p>
            </div>
            <span className="text-xs font-semibold px-2 py-1 rounded bg-cream-100 text-ink">
              {vacancies.length} / {maxVacancies}
            </span>
          </div>

          {/* Current drafts */}
          {vacancies.length > 0 && (
            <div className="space-y-3">
              {vacancies.map((v, index) => (
                <div
                  key={v.id}
                  className="flex items-start justify-between p-3.5 rounded-md border border-cream-200 bg-cream-50"
                >
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-forest-700">
                      Slot {index + 1}
                    </span>
                    <h3 className="font-sans font-semibold text-sm text-ink">{v.role}</h3>
                    {v.skills.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {v.skills.map((skill) => (
                          <span
                            key={skill}
                            className="inline-block px-2 py-0.5 text-xs font-medium bg-white text-ink border border-cream-300 rounded"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-ink-muted mt-1">No specific skills specified</p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleRemoveVacancy(v.id)}
                    className="text-xs font-medium text-red-600 hover:text-red-800 hover:underline focus:outline-none focus:ring-1 focus:ring-red-500 rounded p-1"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add vacancy controls if under limit */}
          {vacancies.length < maxVacancies && (
            <div className="p-4 rounded-md border border-dashed border-cream-300 bg-cream-50/50 space-y-4">
              <h4 className="text-sm font-semibold text-ink">Add a Vacancy</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="slot-role" className="block text-xs font-medium text-ink mb-1">
                    Role
                  </label>
                  <select
                    id="slot-role"
                    disabled={submitting}
                    value={vacancyRole}
                    onChange={(e) => setVacancyRole(e.target.value as ParticipantPrimaryRole)}
                    className={`${inputClass} border-cream-300`}
                  >
                    {TEAM_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="slot-skills" className="block text-xs font-medium text-ink mb-1">
                    Required Skills (comma-separated)
                  </label>
                  <input
                    id="slot-skills"
                    type="text"
                    disabled={submitting}
                    value={vacancySkills}
                    onChange={(e) => setVacancySkills(e.target.value)}
                    placeholder="e.g. React, Tailwind CSS"
                    className={`${inputClass} border-cream-300`}
                  />
                </div>
              </div>

              {vacancyError && (
                <p className="text-xs text-red-600 font-medium">{vacancyError}</p>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleAddVacancy}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded bg-cream-200 text-ink hover:bg-cream-300 focus:outline-none focus:ring-2 focus:ring-forest transition"
                >
                  + Add Role Slot
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Form Actions */}
        <div className="flex items-center justify-end gap-3 pt-4">
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="px-5 py-2.5 text-sm font-semibold rounded-md border border-cream-300 text-ink hover:bg-cream-100 focus:outline-none focus:ring-2 focus:ring-forest transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 text-sm font-semibold rounded-md bg-forest text-white hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream disabled:opacity-50 transition"
          >
            {submitting ? 'Creating Team…' : 'Create Team'}
          </button>
        </div>
      </form>
    </div>
  );
}
