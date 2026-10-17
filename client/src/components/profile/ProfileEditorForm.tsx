import React, { useState, useEffect, useCallback } from 'react';
import {
  PRIMARY_ROLES,
  validateProfileForm,
  type PortfolioLinkFormItem,
  type ProfileFieldErrors,
  type ValidatedProfilePayload,
} from './profileValidation';
import { authFetch } from '../../config/authFetch';

export interface ProfileEditorInitialValues {
  handle?: string | null;
  primaryRole?: string | null;
  institution?: string | null;
  skills?: string[];
  portfolioLinks?: Array<{ url: string; label?: string | null }>;
  sharedContactHandle?: string | null;
}

export interface ProfileEditorFormProps {
  initialValues?: ProfileEditorInitialValues;
  loadOnMount?: boolean;
  onLoaded?: (loadedProfile: Record<string, unknown>) => void;
  onSaved?: (savedProfile: Record<string, unknown>) => void;
  onCancel?: () => void;
}

const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';
const primaryBtnClass =
  'w-full mt-2 py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';
const secondaryBtnClass =
  'py-1.5 px-3 border border-cream-200 rounded-md shadow-sm text-xs font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';

function isProfileEmpty(values?: ProfileEditorInitialValues): boolean {
  if (!values) return true;
  const hasHandle = Boolean(values.handle && values.handle.trim().length > 0);
  const hasRole = Boolean(values.primaryRole && values.primaryRole.trim().length > 0);
  const hasInstitution = Boolean(values.institution && values.institution.trim().length > 0);
  const hasSkills = Array.isArray(values.skills) && values.skills.length > 0;
  const hasPortfolios =
    Array.isArray(values.portfolioLinks) &&
    values.portfolioLinks.some((link) => link.url && link.url.trim().length > 0);
  const hasContact = Boolean(
    values.sharedContactHandle && values.sharedContactHandle.trim().length > 0
  );
  return !hasHandle && !hasRole && !hasInstitution && !hasSkills && !hasPortfolios && !hasContact;
}

export function ProfileEditorForm({
  initialValues,
  loadOnMount = false,
  onLoaded,
  onSaved,
  onCancel,
}: ProfileEditorFormProps): React.JSX.Element {
  const [handle, setHandle] = useState<string>(initialValues?.handle ?? '');
  const [primaryRole, setPrimaryRole] = useState<string>(initialValues?.primaryRole ?? '');
  const [institution, setInstitution] = useState<string>(initialValues?.institution ?? '');
  const [skillsInput, setSkillsInput] = useState<string>(
    initialValues?.skills ? initialValues.skills.join(', ') : ''
  );
  const [portfolioLinks, setPortfolioLinks] = useState<PortfolioLinkFormItem[]>(
    initialValues?.portfolioLinks && initialValues.portfolioLinks.length > 0
      ? initialValues.portfolioLinks.map((link) => ({
          url: link.url,
          label: link.label ?? '',
        }))
      : [{ url: '', label: '' }]
  );
  const [sharedContactHandle, setSharedContactHandle] = useState<string>(
    initialValues?.sharedContactHandle ?? ''
  );

  const [loadingProfile, setLoadingProfile] = useState<boolean>(loadOnMount);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isEmptyProfileState, setIsEmptyProfileState] = useState<boolean>(
    initialValues ? isProfileEmpty(initialValues) : false
  );
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const applyProfileValues = useCallback((profileData: ProfileEditorInitialValues) => {
    setHandle(profileData.handle ?? '');
    setPrimaryRole(profileData.primaryRole ?? '');
    setInstitution(profileData.institution ?? '');
    setSkillsInput(profileData.skills ? profileData.skills.join(', ') : '');
    setPortfolioLinks(
      profileData.portfolioLinks && profileData.portfolioLinks.length > 0
        ? profileData.portfolioLinks.map((link) => ({
            url: link.url,
            label: link.label ?? '',
          }))
        : [{ url: '', label: '' }]
    );
    setSharedContactHandle(profileData.sharedContactHandle ?? '');
    setIsEmptyProfileState(isProfileEmpty(profileData));
  }, []);

  const fetchMyProfile = useCallback(async () => {
    setLoadingProfile(true);
    setLoadError(null);
    try {
      const response = await authFetch('/api/profiles/me', {
        method: 'GET',
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.profile) {
        const loaded = data.profile as ProfileEditorInitialValues & Record<string, unknown>;
        applyProfileValues(loaded);
        onLoaded?.(loaded);
      } else {
        setLoadError(data?.error || 'Could not load your technical profile.');
      }
    } catch {
      setLoadError('Network error while loading your technical profile.');
    } finally {
      setLoadingProfile(false);
    }
  }, [applyProfileValues, onLoaded]);

  useEffect(() => {
    if (loadOnMount) {
      void fetchMyProfile();
    }
  }, [loadOnMount, fetchMyProfile]);

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

  const submitPayload = async (payload: ValidatedProfilePayload) => {
    setSaving(true);
    try {
      const response = await authFetch('/api/profiles/me', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (response.ok) {
        setSuccessMessage('Technical profile updated successfully.');
        setIsEmptyProfileState(
          isProfileEmpty({
            handle: payload.handle,
            primaryRole: payload.primaryRole,
            institution: payload.institution,
            skills: payload.skills,
            portfolioLinks: payload.portfolioLinks,
            sharedContactHandle: payload.sharedContactHandle,
          })
        );
        if (data?.profile && onSaved) {
          onSaved(data.profile);
        }
      } else if ((response.status === 400 || response.status === 409) && data?.errors) {
        // Preserve all entered form values on server-side validation error (US-006 AC 5)
        setFieldErrors(data.errors as ProfileFieldErrors);
      } else {
        setFormError(data?.error || 'Could not update profile. Please try again.');
      }
    } catch {
      setFormError('Network error while saving profile. Your entered values have been kept.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    const validation = validateProfileForm({
      handle,
      primaryRole,
      institution,
      skillsInput,
      portfolioLinks,
      sharedContactHandle,
    });

    if (Object.keys(validation.errors).length > 0 || !validation.payload) {
      // Preserve existing entered values in state while displaying field-specific errors (US-006 AC 5 / T2)
      setFieldErrors(validation.errors);
      return;
    }

    setFieldErrors({});
    await submitPayload(validation.payload);
  };

  if (loadingProfile) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="max-w-lg w-full mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm"
      >
        <p className="text-sm font-medium text-ink-muted">Loading your technical profile...</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg w-full mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm">
      <div className="mb-4">
        <h3 className="font-display text-xl font-semibold text-forest-900">
          Technical Profile
        </h3>
        <p className="text-xs text-ink-muted mt-1">
          Maintain your self-declared role, skills, academic institution, and HTTPS portfolio links.
        </p>
      </div>

      <div
        role="note"
        className="mb-4 p-3 bg-cream-50 border border-cream-200 text-ink-muted text-xs rounded-md"
      >
        <span className="font-semibold text-ink">Self-declared notice:</span> Skills and portfolio
        links are labelled self-declared. HackMatch validates HTTPS URL format only and does not
        independently certify skills, identity, or achievements.
      </div>

      {loadError && (
        <div
          role="alert"
          className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md space-y-2"
        >
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => void fetchMyProfile()}
            className={secondaryBtnClass}
          >
            Retry loading profile
          </button>
        </div>
      )}

      {isEmptyProfileState && !loadError && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 p-3 bg-cream-50 border border-cream-200 text-ink-muted text-xs rounded-md"
        >
          Your technical profile has no saved details yet. Complete the fields below so prospective
          teammates can assess your capabilities.
        </div>
      )}

      {formError && (
        <div
          role="alert"
          className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md"
        >
          {formError}
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 p-3 bg-forest-50 border border-forest-100 text-forest-900 text-sm rounded-md"
        >
          {successMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="profile-handle" className="block text-sm font-medium text-ink mb-1">
            Display Handle
          </label>
          <input
            id="profile-handle"
            name="handle"
            type="text"
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value);
              if (fieldErrors.handle) {
                setFieldErrors((prev) => ({ ...prev, handle: undefined }));
              }
            }}
            disabled={saving}
            aria-invalid={Boolean(fieldErrors.handle)}
            aria-describedby={fieldErrors.handle ? 'profile-handle-error' : undefined}
            className={`${inputClass} ${
              fieldErrors.handle ? 'border-red-300 text-red-900' : 'border-cream-200'
            }`}
            placeholder="jane_coder"
          />
          {fieldErrors.handle && (
            <p id="profile-handle-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.handle}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="profile-primary-role" className="block text-sm font-medium text-ink mb-1">
            Primary Role
          </label>
          <select
            id="profile-primary-role"
            name="primaryRole"
            value={primaryRole}
            onChange={(e) => {
              setPrimaryRole(e.target.value);
              if (fieldErrors.primaryRole) {
                setFieldErrors((prev) => ({ ...prev, primaryRole: undefined }));
              }
            }}
            disabled={saving}
            aria-invalid={Boolean(fieldErrors.primaryRole)}
            aria-describedby={fieldErrors.primaryRole ? 'profile-role-error' : undefined}
            className={`${inputClass} ${
              fieldErrors.primaryRole ? 'border-red-300 text-red-900' : 'border-cream-200'
            }`}
          >
            <option value="">Select a primary role</option>
            {PRIMARY_ROLES.map((roleOption) => (
              <option key={roleOption} value={roleOption}>
                {roleOption}
              </option>
            ))}
          </select>
          {fieldErrors.primaryRole && (
            <p id="profile-role-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.primaryRole}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="profile-institution" className="block text-sm font-medium text-ink mb-1">
            Academic Institution (Optional)
          </label>
          <input
            id="profile-institution"
            name="institution"
            type="text"
            value={institution}
            onChange={(e) => {
              setInstitution(e.target.value);
              if (fieldErrors.institution) {
                setFieldErrors((prev) => ({ ...prev, institution: undefined }));
              }
            }}
            disabled={saving}
            aria-invalid={Boolean(fieldErrors.institution)}
            aria-describedby={fieldErrors.institution ? 'profile-institution-error' : undefined}
            className={`${inputClass} ${
              fieldErrors.institution ? 'border-red-300 text-red-900' : 'border-cream-200'
            }`}
            placeholder="Centennial College"
          />
          {fieldErrors.institution && (
            <p id="profile-institution-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.institution}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="profile-skills" className="block text-sm font-medium text-ink">
              Skill Tags (Comma-separated)
            </label>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-cream-100 text-ink-muted">
              Self-declared
            </span>
          </div>
          <input
            id="profile-skills"
            name="skills"
            type="text"
            value={skillsInput}
            onChange={(e) => {
              setSkillsInput(e.target.value);
              if (fieldErrors.skills) {
                setFieldErrors((prev) => ({ ...prev, skills: undefined }));
              }
            }}
            disabled={saving}
            aria-invalid={Boolean(fieldErrors.skills)}
            aria-describedby={fieldErrors.skills ? 'profile-skills-error' : undefined}
            className={`${inputClass} ${
              fieldErrors.skills ? 'border-red-300 text-red-900' : 'border-cream-200'
            }`}
            placeholder="TypeScript, React, PostgreSQL"
          />
          {fieldErrors.skills && (
            <p id="profile-skills-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.skills}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="block text-sm font-medium text-ink">
              Portfolio Links (HTTPS Only)
            </span>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-cream-100 text-ink-muted">
              Self-declared
            </span>
          </div>

          <div className="space-y-2">
            {portfolioLinks.map((item, idx) => (
              <div key={idx} className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <label htmlFor={`portfolio-url-${idx}`} className="sr-only">
                    Portfolio HTTPS URL {idx + 1}
                  </label>
                  <input
                    id={`portfolio-url-${idx}`}
                    type="url"
                    value={item.url}
                    onChange={(e) => handlePortfolioLinkChange(idx, 'url', e.target.value)}
                    disabled={saving}
                    aria-invalid={Boolean(fieldErrors.portfolioLinks)}
                    aria-describedby={
                      fieldErrors.portfolioLinks ? 'profile-portfolio-error' : undefined
                    }
                    className={`${inputClass} ${
                      fieldErrors.portfolioLinks ? 'border-red-300 text-red-900' : 'border-cream-200'
                    }`}
                    placeholder="https://github.com/username"
                  />
                </div>
                <div className="sm:w-40">
                  <label htmlFor={`portfolio-label-${idx}`} className="sr-only">
                    Portfolio Label {idx + 1}
                  </label>
                  <input
                    id={`portfolio-label-${idx}`}
                    type="text"
                    value={item.label}
                    onChange={(e) => handlePortfolioLinkChange(idx, 'label', e.target.value)}
                    disabled={saving}
                    className={`${inputClass} border-cream-200`}
                    placeholder="Label (e.g. GitHub)"
                  />
                </div>
                {portfolioLinks.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePortfolioLinkRow(idx)}
                    disabled={saving}
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
              disabled={saving || portfolioLinks.length >= 10}
              className={secondaryBtnClass}
            >
              + Add Portfolio Link
            </button>
          </div>

          {fieldErrors.portfolioLinks && (
            <p id="profile-portfolio-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.portfolioLinks}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="profile-shared-contact"
            className="block text-sm font-medium text-ink mb-1"
          >
            Shared Contact Handle (Optional)
          </label>
          <input
            id="profile-shared-contact"
            name="sharedContactHandle"
            type="text"
            value={sharedContactHandle}
            onChange={(e) => {
              setSharedContactHandle(e.target.value);
              if (fieldErrors.sharedContactHandle) {
                setFieldErrors((prev) => ({ ...prev, sharedContactHandle: undefined }));
              }
            }}
            disabled={saving}
            aria-invalid={Boolean(fieldErrors.sharedContactHandle)}
            aria-describedby={
              fieldErrors.sharedContactHandle
                ? 'profile-contact-error profile-contact-audience'
                : 'profile-contact-audience'
            }
            className={`${inputClass} ${
              fieldErrors.sharedContactHandle ? 'border-red-300 text-red-900' : 'border-cream-200'
            }`}
            placeholder="@jane_discord"
          />
          <p id="profile-contact-audience" className="mt-1 text-xs text-ink-muted">
            Visible only to your confirmed teammates. Leaving or removal from a team revokes access.
            Account email is never automatically shared.
          </p>
          {fieldErrors.sharedContactHandle && (
            <p id="profile-contact-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.sharedContactHandle}
            </p>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            aria-busy={saving}
            className={primaryBtnClass}
          >
            {saving ? 'Saving Profile...' : 'Save Technical Profile'}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="w-auto mt-2 py-2.5 px-4 border border-cream-200 rounded-md shadow-sm text-sm font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export default ProfileEditorForm;
