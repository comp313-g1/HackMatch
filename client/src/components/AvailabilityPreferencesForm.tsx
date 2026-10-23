import React, { useState, useEffect, useCallback } from 'react';
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
import { authFetch } from '../config/authFetch';
import {
  PRIMARY_ROLES,
  validateProfileForm,
  type PortfolioLinkFormItem,
  type ProfileFieldErrors,
} from './profile/profileValidation';

export interface AvailabilityPreferencesFormProps {
  initialAvailability?: PlatformAvailabilityRecord | null;
  onSave?: (payload: UpdatePlatformAvailabilityInput) => Promise<PlatformAvailabilityRecord>;
  onAvailabilityUpdated?: (updated: PlatformAvailabilityRecord) => void;
  idToken?: string | null;
}

type CombinedFieldErrors = AvailabilityFieldErrors & ProfileFieldErrors;

const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';
const selectClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';
const primaryBtnClass =
  'w-full sm:w-auto py-2.5 px-6 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50 transition-colors';
const secondaryBtnClass =
  'py-1.5 px-3 border border-cream-200 rounded-md shadow-sm text-xs font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';

/**
 * Single Looking for Team form (US-011 / US-006 / #360):
 * candidate-card profile fields + availability preferences, one Save.
 */
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

  const [handle, setHandle] = useState('');
  const [primaryRole, setPrimaryRole] = useState('');
  const [institution, setInstitution] = useState('');
  const [skillsInput, setSkillsInput] = useState('');
  const [portfolioLinks, setPortfolioLinks] = useState<PortfolioLinkFormItem[]>([
    { url: '', label: '' },
  ]);
  const [sharedContactHandle, setSharedContactHandle] = useState('');
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);

  const [fieldErrors, setFieldErrors] = useState<CombinedFieldErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true);
    setProfileLoadError(null);
    try {
      const response = await authFetch('/api/profiles/me', { method: 'GET' });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.profile) {
        const p = data.profile as {
          handle?: string | null;
          primaryRole?: string | null;
          institution?: string | null;
          skills?: string[];
          portfolioLinks?: Array<{ url: string; label?: string | null }>;
          sharedContactHandle?: string | null;
        };
        setHandle(p.handle ?? '');
        setPrimaryRole(p.primaryRole ?? '');
        setInstitution(p.institution ?? '');
        setSkillsInput(Array.isArray(p.skills) ? p.skills.join(', ') : '');
        setPortfolioLinks(
          Array.isArray(p.portfolioLinks) && p.portfolioLinks.length > 0
            ? p.portfolioLinks.map((link) => ({
                url: link.url,
                label: link.label ?? '',
              }))
            : [{ url: '', label: '' }]
        );
        setSharedContactHandle(p.sharedContactHandle ?? '');
      } else if (!response.ok) {
        setProfileLoadError(data?.error || 'Could not load your profile.');
      }
    } catch {
      setProfileLoadError('Network error while loading your profile.');
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const handlePortfolioLinkChange = (
    index: number,
    field: 'url' | 'label',
    value: string
  ) => {
    setPortfolioLinks((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
    if (fieldErrors.portfolioLinks) {
      setFieldErrors((prev) => ({ ...prev, portfolioLinks: undefined }));
    }
  };

  const addPortfolioLinkRow = () => {
    if (portfolioLinks.length >= 10) return;
    setPortfolioLinks((prev) => [...prev, { url: '', label: '' }]);
  };

  const removePortfolioLinkRow = (index: number) => {
    setPortfolioLinks((prev) =>
      prev.length <= 1 ? [{ url: '', label: '' }] : prev.filter((_, i) => i !== index)
    );
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const clientErrors: CombinedFieldErrors = {};

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

    const profileValidation = validateProfileForm(
      {
        handle,
        primaryRole,
        institution,
        skillsInput,
        portfolioLinks,
        sharedContactHandle,
      },
      { requireDiscoveryFields: isLooking }
    );

    Object.assign(clientErrors, profileValidation.errors);

    if (Object.keys(clientErrors).length > 0 || !profileValidation.payload) {
      setFieldErrors(clientErrors);
      setErrorMessage('Please fix the errors below before saving.');
      return;
    }

    setFieldErrors({});
    setIsSaving(true);

    const availabilityPayload: UpdatePlatformAvailabilityInput = {
      isLooking,
      desiredRole: desiredRole.trim() ? (desiredRole as AvailabilityRole) : null,
      commitmentHours: parsedHours,
      goal: goal.trim() ? (goal as AvailabilityGoal) : null,
    };

    try {
      // Save profile first so LFT enable can pass server completeness checks (#360).
      const profileRes = await authFetch('/api/profiles/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileValidation.payload),
      });
      const profileData = await profileRes.json().catch(() => null);
      if (!profileRes.ok) {
        if ((profileRes.status === 400 || profileRes.status === 409) && profileData?.errors) {
          setFieldErrors(profileData.errors as CombinedFieldErrors);
          setErrorMessage(profileData.error || 'Please fix your profile fields.');
        } else {
          setErrorMessage(profileData?.error || 'Could not save your profile.');
        }
        return;
      }

      const updated = onSave
        ? await onSave(availabilityPayload)
        : await updateMyAvailability(availabilityPayload, idToken);

      setSuccessMessage(
        isLooking
          ? 'Your Looking for Team card and availability were saved!'
          : 'Looking for Team turned off. Your profile and preferences were saved.'
      );
      onAvailabilityUpdated?.(updated);
    } catch (err: unknown) {
      if (err instanceof AvailabilityApiError && err.fieldErrors) {
        setFieldErrors(err.fieldErrors);
        setErrorMessage(err.message || 'Validation failed. Please verify your inputs.');
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Failed to save Looking for Team preferences.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (loadingProfile) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-white rounded-xl border border-cream-200 shadow-sm p-6 sm:p-8"
      >
        <p className="text-sm font-medium text-ink-muted">Loading Looking for Team form...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-cream-200 shadow-sm p-6 sm:p-8">
      <div className="border-b border-cream-200 pb-5 mb-6">
        <h3 className="text-xl font-bold text-forest-900">Looking for Team Card</h3>
        <p className="mt-1 text-sm text-ink-muted">
          One form for everything on your Available Candidates card: profile details plus
          availability. Save once to update both.
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

      {(errorMessage || profileLoadError) && (
        <div
          role="alert"
          className="mb-6 p-4 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg space-y-2"
        >
          {errorMessage ? <p>{errorMessage}</p> : null}
          {profileLoadError ? (
            <div className="space-y-2">
              <p>{profileLoadError}</p>
              <button type="button" onClick={() => void loadProfile()} className={secondaryBtnClass}>
                Retry loading profile
              </button>
            </div>
          ) : null}
        </div>
      )}

      <form noValidate onSubmit={handleSubmit} className="space-y-6">
        <div className="flex items-start justify-between gap-4 p-4 rounded-lg bg-cream-50 border border-cream-200">
          <div className="flex-1">
            <label
              htmlFor="availability-is-looking"
              className="text-base font-semibold text-charcoal-900 cursor-pointer"
            >
              Looking for Team (LFT)
            </label>
            <p id="availability-is-looking-hint" className="text-xs text-ink-muted mt-0.5">
              When enabled, this card is visible to Team Leads. Handle, institution, skills, and a
              portfolio link are required while LFT is on.
            </p>
            {fieldErrors.isLooking && (
              <p role="alert" className="mt-1 text-xs text-red-600 font-medium">
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
              disabled={isSaving}
              className="h-6 w-11 rounded-full border-gray-300 text-forest focus:ring-forest cursor-pointer"
            />
          </div>
        </div>

        <fieldset className="space-y-4 border-t border-cream-200 pt-5">
          <legend className="text-sm font-bold text-forest-900 px-1">
            Card profile (shown to Team Leads)
          </legend>

          <div>
            <label htmlFor="lft-handle" className="block text-sm font-semibold text-charcoal-800 mb-1">
              Display Handle {isLooking && <span className="text-red-500">*</span>}
            </label>
            <input
              id="lft-handle"
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              disabled={isSaving}
              aria-invalid={Boolean(fieldErrors.handle)}
              className={`${inputClass} ${
                fieldErrors.handle ? 'border-red-500' : 'border-cream-200'
              }`}
              placeholder="jane_coder"
            />
            {fieldErrors.handle && (
              <p role="alert" className="mt-1 text-xs text-red-600 font-medium">
                {fieldErrors.handle}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="lft-primary-role"
                className="block text-sm font-semibold text-charcoal-800 mb-1"
              >
                Primary Role
              </label>
              <select
                id="lft-primary-role"
                value={primaryRole}
                onChange={(e) => setPrimaryRole(e.target.value)}
                disabled={isSaving}
                className={`${selectClass} border-cream-200`}
              >
                <option value="">Select a primary role</option>
                {PRIMARY_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              {fieldErrors.primaryRole && (
                <p role="alert" className="mt-1 text-xs text-red-600 font-medium">
                  {fieldErrors.primaryRole}
                </p>
              )}
            </div>

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
                disabled={isSaving}
                aria-invalid={Boolean(fieldErrors.desiredRole)}
                className={`${selectClass} ${
                  fieldErrors.desiredRole ? 'border-red-500' : 'border-cream-200'
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
                <p role="alert" className="mt-1 text-xs text-red-600 font-medium">
                  {fieldErrors.desiredRole}
                </p>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="lft-institution"
              className="block text-sm font-semibold text-charcoal-800 mb-1"
            >
              Academic Institution {isLooking && <span className="text-red-500">*</span>}
            </label>
            <input
              id="lft-institution"
              type="text"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              disabled={isSaving}
              aria-invalid={Boolean(fieldErrors.institution)}
              className={`${inputClass} ${
                fieldErrors.institution ? 'border-red-500' : 'border-cream-200'
              }`}
              placeholder="Centennial College"
            />
            {fieldErrors.institution && (
              <p role="alert" className="mt-1 text-xs text-red-600 font-medium">
                {fieldErrors.institution}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="lft-skills" className="block text-sm font-semibold text-charcoal-800 mb-1">
              Skills (comma-separated) {isLooking && <span className="text-red-500">*</span>}
            </label>
            <input
              id="lft-skills"
              type="text"
              value={skillsInput}
              onChange={(e) => setSkillsInput(e.target.value)}
              disabled={isSaving}
              aria-invalid={Boolean(fieldErrors.skills)}
              className={`${inputClass} ${
                fieldErrors.skills ? 'border-red-500' : 'border-cream-200'
              }`}
              placeholder="Python, TensorFlow, Data Visualization"
            />
            {fieldErrors.skills && (
              <p role="alert" className="mt-1 text-xs text-red-600 font-medium">
                {fieldErrors.skills}
              </p>
            )}
          </div>

          <div>
            <p className="block text-sm font-semibold text-charcoal-800 mb-1">
              Portfolio Links (HTTPS) {isLooking && <span className="text-red-500">*</span>}
            </p>
            <div className="space-y-2">
              {portfolioLinks.map((item, idx) => (
                <div key={idx} className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1">
                    <label htmlFor={`lft-portfolio-url-${idx}`} className="sr-only">
                      Portfolio HTTPS URL {idx + 1}
                    </label>
                    <input
                      id={`lft-portfolio-url-${idx}`}
                      type="url"
                      value={item.url}
                      onChange={(e) => handlePortfolioLinkChange(idx, 'url', e.target.value)}
                      disabled={isSaving}
                      aria-invalid={Boolean(fieldErrors.portfolioLinks)}
                      className={`${inputClass} ${
                        fieldErrors.portfolioLinks ? 'border-red-500' : 'border-cream-200'
                      }`}
                      placeholder="https://github.com/username"
                    />
                  </div>
                  <div className="sm:w-44">
                    <label htmlFor={`lft-portfolio-label-${idx}`} className="sr-only">
                      Portfolio Label {idx + 1}
                    </label>
                    <input
                      id={`lft-portfolio-label-${idx}`}
                      type="text"
                      value={item.label}
                      onChange={(e) => handlePortfolioLinkChange(idx, 'label', e.target.value)}
                      disabled={isSaving}
                      className={`${inputClass} border-cream-200`}
                      placeholder="Label (e.g. GitHub)"
                    />
                  </div>
                  {portfolioLinks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePortfolioLinkRow(idx)}
                      disabled={isSaving}
                      className={secondaryBtnClass}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2">
              <button
                type="button"
                onClick={addPortfolioLinkRow}
                disabled={isSaving || portfolioLinks.length >= 10}
                className={secondaryBtnClass}
              >
                + Add Portfolio Link
              </button>
            </div>
            {fieldErrors.portfolioLinks && (
              <p role="alert" className="mt-1 text-xs text-red-600 font-medium">
                {fieldErrors.portfolioLinks}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="lft-shared-contact"
              className="block text-sm font-semibold text-charcoal-800 mb-1"
            >
              Shared Contact Handle (optional)
            </label>
            <input
              id="lft-shared-contact"
              type="text"
              value={sharedContactHandle}
              onChange={(e) => setSharedContactHandle(e.target.value)}
              disabled={isSaving}
              className={`${inputClass} border-cream-200`}
              placeholder="@jane_discord"
            />
            <p className="mt-1 text-xs text-ink-muted">
              Visible only to confirmed teammates. Not shown on the public candidate card.
            </p>
            {fieldErrors.sharedContactHandle && (
              <p role="alert" className="mt-1 text-xs text-red-600 font-medium">
                {fieldErrors.sharedContactHandle}
              </p>
            )}
          </div>
        </fieldset>

        <fieldset className="space-y-4 border-t border-cream-200 pt-5">
          <legend className="text-sm font-bold text-forest-900 px-1">Availability</legend>

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
              placeholder="e.g. 12"
              value={commitmentHoursInput}
              onChange={(e) => setCommitmentHoursInput(e.target.value)}
              disabled={isSaving}
              aria-invalid={Boolean(fieldErrors.commitmentHours)}
              className={`${inputClass} ${
                fieldErrors.commitmentHours ? 'border-red-500' : 'border-cream-200'
              }`}
            />
            <p className="mt-1 text-xs text-ink-muted">
              Hours per week you can dedicate (up to 1 decimal place).
            </p>
            {fieldErrors.commitmentHours && (
              <p role="alert" className="mt-1 text-xs text-red-600 font-medium">
                {fieldErrors.commitmentHours}
              </p>
            )}
          </div>

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
              disabled={isSaving}
              aria-invalid={Boolean(fieldErrors.goal)}
              className={`${selectClass} ${
                fieldErrors.goal ? 'border-red-500' : 'border-cream-200'
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
              <p role="alert" className="mt-1 text-xs text-red-600 font-medium">
                {fieldErrors.goal}
              </p>
            )}
          </div>
        </fieldset>

        <div className="pt-2">
          <button type="submit" disabled={isSaving} className={primaryBtnClass}>
            {isSaving ? 'Saving...' : 'Save Looking for Team Card'}
          </button>
        </div>
      </form>
    </div>
  );
}
