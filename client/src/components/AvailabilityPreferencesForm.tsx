import React, { useState, useEffect } from 'react';
import {
  AVAILABILITY_ROLES,
  AVAILABILITY_GOALS,
  AVAILABILITY_MIN_COMMITMENT_HOURS,
  AVAILABILITY_MAX_COMMITMENT_HOURS,
  updateMyAvailability,
  AvailabilityApiError,
  type PlatformAvailabilityRecord,
  type UpdatePlatformAvailabilityInput,
  type AvailabilityRole,
  type AvailabilityGoal,
  type AvailabilityFieldErrors,
} from '../services/availabilityApi';

export interface AvailabilityPreferencesFormProps {
  initialAvailability?: PlatformAvailabilityRecord | null;
  onSave?: (payload: UpdatePlatformAvailabilityInput) => Promise<PlatformAvailabilityRecord>;
  onAvailabilityUpdated?: (updated: PlatformAvailabilityRecord) => void;
  idToken?: string | null;
}

const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';
const selectClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';
const primaryBtnClass =
  'w-full sm:w-auto py-2.5 px-6 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50 transition-colors';

export function AvailabilityPreferencesForm({
  initialAvailability,
  onSave,
  onAvailabilityUpdated,
  idToken,
}: AvailabilityPreferencesFormProps): React.JSX.Element {
  const [isLooking, setIsLooking] = useState<boolean>(
    initialAvailability?.isLooking ?? false
  );
  const [desiredRole, setDesiredRole] = useState<string>(
    initialAvailability?.desiredRole ?? ''
  );
  const [commitmentHoursInput, setCommitmentHoursInput] = useState<string>(
    initialAvailability?.commitmentHours != null
      ? String(initialAvailability.commitmentHours)
      : ''
  );
  const [goal, setGoal] = useState<string>(initialAvailability?.goal ?? '');

  const [fieldErrors, setFieldErrors] = useState<AvailabilityFieldErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    if (initialAvailability) {
      setIsLooking(initialAvailability.isLooking);
      if (initialAvailability.desiredRole) {
        setDesiredRole(initialAvailability.desiredRole);
      }
      if (initialAvailability.commitmentHours != null) {
        setCommitmentHoursInput(String(initialAvailability.commitmentHours));
      }
      if (initialAvailability.goal) {
        setGoal(initialAvailability.goal);
      }
    }
  }, [initialAvailability]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const clientErrors: Record<string, string> = {};

    let parsedHours: number | null = null;
    if (commitmentHoursInput.trim() !== '') {
      const num = Number(commitmentHoursInput);
      if (Number.isNaN(num) || !Number.isFinite(num)) {
        clientErrors.commitmentHours =
          'Commitment hours must be a number between 0 and 168 with at most one decimal place.';
      } else if (
        num < AVAILABILITY_MIN_COMMITMENT_HOURS ||
        num > AVAILABILITY_MAX_COMMITMENT_HOURS
      ) {
        clientErrors.commitmentHours = `Commitment hours must be between ${AVAILABILITY_MIN_COMMITMENT_HOURS} and ${AVAILABILITY_MAX_COMMITMENT_HOURS}.`;
      } else if (Math.round(num * 10) !== num * 10) {
        clientErrors.commitmentHours =
          'Commitment hours cannot have more than 1 decimal place.';
      } else {
        parsedHours = Math.round(num * 10) / 10;
      }
    }

    if (isLooking) {
      if (!desiredRole.trim()) {
        clientErrors.desiredRole = 'Desired role is required when Looking for Team is enabled.';
      }
      if (commitmentHoursInput.trim() === '') {
        clientErrors.commitmentHours =
          'Commitment hours are required when Looking for Team is enabled.';
      }
      if (!goal.trim()) {
        clientErrors.goal = 'Goal is required when Looking for Team is enabled.';
      }
    }

    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      setErrorMessage('Please fix the errors below before saving your preferences.');
      return;
    }

    setFieldErrors({});
    setIsSaving(true);

    const payload: UpdatePlatformAvailabilityInput = {
      isLooking,
      desiredRole: desiredRole.trim() ? (desiredRole as AvailabilityRole) : null,
      commitmentHours: parsedHours,
      goal: goal.trim() ? (goal as AvailabilityGoal) : null,
    };

    try {
      const updated = onSave
        ? await onSave(payload)
        : await updateMyAvailability(payload, idToken);

      setSuccessMessage(
        isLooking
          ? 'Platform availability and Looking for Team status saved!'
          : 'Looking for Team status turned off. Your preferences have been saved.'
      );
      if (onAvailabilityUpdated) {
        onAvailabilityUpdated(updated);
      }
    } catch (err: unknown) {
      if (err instanceof AvailabilityApiError && err.fieldErrors) {
        setFieldErrors(err.fieldErrors);
        setErrorMessage(err.message || 'Validation failed. Please verify your inputs.');
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Failed to update availability preferences.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-cream-200 shadow-sm p-6 sm:p-8">
      <div className="border-b border-cream-200 pb-5 mb-6">
        <h3 className="text-xl font-bold text-forest-900">
          Platform-Wide Looking for Team Status
        </h3>
        <p className="mt-1 text-sm text-ink-muted">
          Declare your availability globally so Team Leads across all hackathons can discover you.
          No specific event selection required.
        </p>
      </div>

      {successMessage && (
        <div
          role="status"
          aria-live="polite"
          className="mb-6 p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm rounded-lg flex items-center gap-2"
        >
          <svg
            className="w-5 h-5 text-emerald-600 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="mb-6 p-4 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg"
        >
          {errorMessage}
        </div>
      )}

      <form noValidate onSubmit={handleSubmit} className="space-y-6">
        {/* Toggle switch */}
        <div className="flex items-start justify-between gap-4 p-4 rounded-lg bg-cream-50 border border-cream-200">
          <div className="flex-1">
            <label
              htmlFor="availability-is-looking"
              className="text-base font-semibold text-charcoal-900 cursor-pointer"
            >
              Looking for Team (LFT)
            </label>
            <p id="availability-is-looking-hint" className="text-xs text-ink-muted mt-0.5">
              When enabled, your availability card will be visible to Team Leads and other participants.
              Joining a team automatically deactivates this toggle, but you can manually re-enable it.
            </p>
            {fieldErrors.isLooking && (
              <p
                id="availability-is-looking-error"
                role="alert"
                className="mt-1 text-xs text-red-600 font-medium"
              >
                {fieldErrors.isLooking}
              </p>
            )}
          </div>
          <div className="flex items-center h-6">
            <input
              id="availability-is-looking"
              type="checkbox"
              role="switch"
              aria-checked={isLooking}
              aria-describedby="availability-is-looking-hint"
              checked={isLooking}
              onChange={(e) => setIsLooking(e.target.checked)}
              className="h-6 w-11 rounded-full border-gray-300 text-forest focus:ring-forest cursor-pointer"
            />
          </div>
        </div>

        {/* Desired Role */}
        <div>
          <label
            htmlFor="availability-desired-role"
            className="block text-sm font-semibold text-charcoal-800 mb-1"
          >
            Desired Role {isLooking && <span className="text-red-500">*</span>}
          </label>
          <select
            id="availability-desired-role"
            value={desiredRole}
            onChange={(e) => setDesiredRole(e.target.value)}
            aria-invalid={Boolean(fieldErrors.desiredRole)}
            aria-describedby={
              fieldErrors.desiredRole ? 'availability-desired-role-error' : undefined
            }
            className={`${selectClass} ${
              fieldErrors.desiredRole ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : ''
            }`}
          >
            <option value="">Select a role...</option>
            {AVAILABILITY_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          {fieldErrors.desiredRole && (
            <p
              id="availability-desired-role-error"
              role="alert"
              className="mt-1 text-xs text-red-600 font-medium"
            >
              {fieldErrors.desiredRole}
            </p>
          )}
        </div>

        {/* Weekly Commitment Hours */}
        <div>
          <label
            htmlFor="availability-commitment-hours"
            className="block text-sm font-semibold text-charcoal-800 mb-1"
          >
            Weekly Commitment Hours (0–168){' '}
            {isLooking && <span className="text-red-500">*</span>}
          </label>
          <input
            id="availability-commitment-hours"
            type="number"
            min={AVAILABILITY_MIN_COMMITMENT_HOURS}
            max={AVAILABILITY_MAX_COMMITMENT_HOURS}
            step="0.5"
            placeholder="e.g. 20"
            value={commitmentHoursInput}
            onChange={(e) => setCommitmentHoursInput(e.target.value)}
            aria-invalid={Boolean(fieldErrors.commitmentHours)}
            aria-describedby={
              fieldErrors.commitmentHours
                ? 'availability-commitment-hours-error'
                : 'availability-commitment-hours-hint'
            }
            className={`${inputClass} ${
              fieldErrors.commitmentHours
                ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                : ''
            }`}
          />
          <p id="availability-commitment-hours-hint" className="mt-1 text-xs text-ink-muted">
            Number of hours per week you can dedicate to hackathon projects (up to 1 decimal place).
          </p>
          {fieldErrors.commitmentHours && (
            <p
              id="availability-commitment-hours-error"
              role="alert"
              className="mt-1 text-xs text-red-600 font-medium"
            >
              {fieldErrors.commitmentHours}
            </p>
          )}
        </div>

        {/* Project Goal */}
        <div>
          <label
            htmlFor="availability-goal"
            className="block text-sm font-semibold text-charcoal-800 mb-1"
          >
            Project Goal {isLooking && <span className="text-red-500">*</span>}
          </label>
          <select
            id="availability-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            aria-invalid={Boolean(fieldErrors.goal)}
            aria-describedby={fieldErrors.goal ? 'availability-goal-error' : undefined}
            className={`${selectClass} ${
              fieldErrors.goal ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : ''
            }`}
          >
            <option value="">Select a goal...</option>
            {AVAILABILITY_GOALS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          {fieldErrors.goal && (
            <p
              id="availability-goal-error"
              role="alert"
              className="mt-1 text-xs text-red-600 font-medium"
            >
              {fieldErrors.goal}
            </p>
          )}
        </div>

        {/* Action Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className={primaryBtnClass}
          >
            {isSaving ? 'Saving preferences...' : 'Save Availability Preferences'}
          </button>
        </div>
      </form>
    </div>
  );
}
