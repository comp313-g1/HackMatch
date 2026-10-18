import React, { useState } from 'react';
import {
  TEAM_GOALS,
  TEAM_PITCH_MAX,
  type TeamView,
  type TeamFieldErrors,
  type TeamListingFormValues,
} from './teamTypes';
import {
  codePointLength,
  validateTeamListingForm,
} from './teamValidation';
import { createTeam, updateTeam, TeamApiError, AuthRequiredError } from './teamApi';

export interface TeamListingFormProps {
  mode: 'create' | 'edit';
  eventId: string;
  team?: TeamView;
  disabled?: boolean;
  onSaved: (t: TeamView) => void;
}

const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';
const primaryBtnClass =
  'w-full sm:w-auto py-2.5 px-6 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';

export function TeamListingForm({
  mode,
  eventId,
  team,
  disabled = false,
  onSaved,
}: TeamListingFormProps): React.JSX.Element {
  const [name, setName] = useState<string>(team?.name ?? '');
  const [pitch, setPitch] = useState<string>(team?.pitch ?? '');
  const [goal, setGoal] = useState<string>(team?.goal ?? 'Learning');
  const [commitmentHours, setCommitmentHours] = useState<string>(
    team?.commitmentHours !== undefined ? String(team.commitmentHours) : '10'
  );
  const [communicationLink, setCommunicationLink] = useState<string>(
    team?.communicationLink ?? ''
  );

  const [fieldErrors, setFieldErrors] = useState<TeamFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const pitchCount = codePointLength(pitch);
  const isFormDisabled = disabled || saving;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isFormDisabled) return;

    const values: TeamListingFormValues = {
      name,
      pitch,
      goal,
      commitmentHours,
      communicationLink,
    };

    const initialValues: Partial<TeamListingFormValues> | undefined = team
      ? {
          name: team.name,
          pitch: team.pitch,
          goal: team.goal,
          commitmentHours: String(team.commitmentHours),
          communicationLink: team.communicationLink ?? '',
        }
      : undefined;

    const validation = validateTeamListingForm(values, mode, initialValues);
    if (Object.keys(validation.errors).length > 0) {
      setFieldErrors(validation.errors);
      setFormError(validation.errors._form ?? 'Please fix the errors below.');
      return;
    }

    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    try {
      if (mode === 'create') {
        const created = await createTeam({
          eventId,
          name: validation.payload!.name!,
          pitch: validation.payload!.pitch!,
          goal: validation.payload!.goal!,
          commitmentHours: validation.payload!.commitmentHours!,
          communicationLink: validation.payload!.communicationLink!,
        });
        onSaved(created);
      } else {
        const updated = await updateTeam(team!.id, validation.payload!);
        onSaved(updated);
      }
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setFormError('You need to sign in to manage a team.');
        return;
      }
      if (err instanceof TeamApiError) {
        if (err.errors) {
          setFieldErrors(err.errors);
        }
        setFormError(err.message || 'An error occurred while saving.');
        return;
      }
      setFormError(err instanceof Error ? err.message : 'An error occurred.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-busy={saving}
      className="space-y-6 bg-white p-6 rounded-lg border border-cream-200 shadow-sm"
    >
      {formError && (
        <div
          role="alert"
          className="p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded-md"
        >
          {formError}
        </div>
      )}

      {/* Team Name */}
      <div>
        <label htmlFor="team-name" className="block text-sm font-medium text-ink mb-1">
          Team Name <span className="text-red-500">*</span>
        </label>
        <input
          id="team-name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }));
          }}
          disabled={isFormDisabled}
          aria-invalid={Boolean(fieldErrors.name)}
          aria-describedby={fieldErrors.name ? 'team-name-error' : undefined}
          className={`${inputClass} ${fieldErrors.name ? 'border-red-400 bg-red-50/30' : 'border-cream-300'}`}
          placeholder="e.g., Code Innovators"
        />
        {fieldErrors.name && (
          <p id="team-name-error" role="alert" className="mt-1 text-xs text-red-600">
            {fieldErrors.name}
          </p>
        )}
      </div>

      {/* Pitch */}
      <div>
        <div className="flex justify-between items-center mb-1">
          <label htmlFor="team-pitch" className="block text-sm font-medium text-ink">
            Recruitment Pitch <span className="text-red-500">*</span>
          </label>
          <span
            id="team-pitch-counter"
            aria-live="polite"
            className={`text-xs ${pitchCount > TEAM_PITCH_MAX ? 'text-red-600 font-semibold' : 'text-ink-muted'}`}
          >
            {pitchCount}/{TEAM_PITCH_MAX}
          </span>
        </div>
        <textarea
          id="team-pitch"
          rows={4}
          value={pitch}
          onChange={(e) => {
            setPitch(e.target.value);
            if (fieldErrors.pitch) setFieldErrors((prev) => ({ ...prev, pitch: undefined }));
          }}
          disabled={isFormDisabled}
          aria-invalid={Boolean(fieldErrors.pitch)}
          aria-describedby={
            fieldErrors.pitch ? 'team-pitch-error team-pitch-counter' : 'team-pitch-counter'
          }
          className={`${inputClass} ${fieldErrors.pitch ? 'border-red-400 bg-red-50/30' : 'border-cream-300'}`}
          placeholder="Describe your project vision, what you plan to build, and who you are looking for..."
        />
        {fieldErrors.pitch && (
          <p id="team-pitch-error" role="alert" className="mt-1 text-xs text-red-600">
            {fieldErrors.pitch}
          </p>
        )}
      </div>

      {/* Goal & Commitment Hours (2 columns on md+) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="team-goal" className="block text-sm font-medium text-ink mb-1">
            Team Goal <span className="text-red-500">*</span>
          </label>
          <select
            id="team-goal"
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
              if (fieldErrors.goal) setFieldErrors((prev) => ({ ...prev, goal: undefined }));
            }}
            disabled={isFormDisabled}
            aria-invalid={Boolean(fieldErrors.goal)}
            aria-describedby={fieldErrors.goal ? 'team-goal-error' : undefined}
            className={`${inputClass} ${fieldErrors.goal ? 'border-red-400 bg-red-50/30' : 'border-cream-300'}`}
          >
            {TEAM_GOALS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          {fieldErrors.goal && (
            <p id="team-goal-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.goal}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="team-commitment-hours"
            className="block text-sm font-medium text-ink mb-1"
          >
            Weekly Commitment (Hours) <span className="text-red-500">*</span>
          </label>
          <input
            id="team-commitment-hours"
            type="text"
            inputMode="decimal"
            value={commitmentHours}
            onChange={(e) => {
              setCommitmentHours(e.target.value);
              if (fieldErrors.commitmentHours)
                setFieldErrors((prev) => ({ ...prev, commitmentHours: undefined }));
            }}
            disabled={isFormDisabled}
            aria-invalid={Boolean(fieldErrors.commitmentHours)}
            aria-describedby={
              fieldErrors.commitmentHours ? 'team-commitment-hours-error' : undefined
            }
            className={`${inputClass} ${fieldErrors.commitmentHours ? 'border-red-400 bg-red-50/30' : 'border-cream-300'}`}
            placeholder="e.g. 15.5"
          />
          {fieldErrors.commitmentHours && (
            <p
              id="team-commitment-hours-error"
              role="alert"
              className="mt-1 text-xs text-red-600"
            >
              {fieldErrors.commitmentHours}
            </p>
          )}
        </div>
      </div>

      {/* Communication Link */}
      <div>
        <label
          htmlFor="team-communication-link"
          className="block text-sm font-medium text-ink mb-1"
        >
          Communication Channel (Optional)
        </label>
        <input
          id="team-communication-link"
          type="url"
          value={communicationLink}
          onChange={(e) => {
            setCommunicationLink(e.target.value);
            if (fieldErrors.communicationLink)
              setFieldErrors((prev) => ({ ...prev, communicationLink: undefined }));
          }}
          disabled={isFormDisabled}
          aria-invalid={Boolean(fieldErrors.communicationLink)}
          aria-describedby={
            fieldErrors.communicationLink ? 'team-communication-link-error' : undefined
          }
          className={`${inputClass} ${fieldErrors.communicationLink ? 'border-red-400 bg-red-50/30' : 'border-cream-300'}`}
          placeholder="https://discord.gg/your-team or https://t.me/your-team"
        />
        {fieldErrors.communicationLink && (
          <p
            id="team-communication-link-error"
            role="alert"
            className="mt-1 text-xs text-red-600"
          >
            {fieldErrors.communicationLink}
          </p>
        )}
      </div>

      {/* Submit Button */}
      <div className="pt-2">
        <button
          type="submit"
          disabled={isFormDisabled}
          className={primaryBtnClass}
        >
          {saving
            ? mode === 'create'
              ? 'Creating team...'
              : 'Saving changes...'
            : mode === 'create'
              ? 'Create team'
              : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
