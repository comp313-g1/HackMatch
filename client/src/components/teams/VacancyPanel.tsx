import React, { useState, useEffect } from 'react';
import {
  TEAM_ROLES,
  type TeamView,
  type TeamVacancyView,
  type TeamLimits,
} from './teamTypes';
import { validateVacancyForm } from './teamValidation';
import { addVacancy, updateVacancy, removeVacancy, TeamApiError, AuthRequiredError } from './teamApi';
import { postLockMutationErrorMessage } from './postLockGuards';
import { RecommendationPanel } from '../scoring/RecommendationPanel';

export interface VacancyPanelProps {
  teamId: string;
  vacancies: TeamVacancyView[];
  limits: TeamLimits;
  disabled: boolean;
  onChanged: (t: TeamView) => void;
  /** Fired when a recommendation invite succeeds so the invitations panel can refresh. */
  onInvitationIssued?: () => void;
}

const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';

export function VacancyPanel({
  teamId,
  vacancies,
  limits,
  disabled,
  onChanged,
  onInvitationIssued,
}: VacancyPanelProps): React.JSX.Element {
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [editingVacancyId, setEditingVacancyId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Form states
  const [role, setRole] = useState<string>(TEAM_ROLES[0]);
  const [skillsInput, setSkillsInput] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ role?: string; skills?: string; vacancies?: string }>({});
  const [busy, setBusy] = useState<boolean>(false);

  const isPanelDisabled = disabled || busy;
  const isAtCapacity = limits.remainingCapacity !== null && limits.remainingCapacity <= 0;

  const resetForm = () => {
    setIsAdding(false);
    setEditingVacancyId(null);
    setConfirmRemoveId(null);
    setRole(TEAM_ROLES[0]);
    setSkillsInput('');
    setFormError(null);
    setFieldErrors({});
  };

  useEffect(() => {
    if (!confirmRemoveId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setConfirmRemoveId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmRemoveId]);

  const handleStartAdd = () => {
    resetForm();
    setIsAdding(true);
  };

  const handleStartEdit = (v: TeamVacancyView) => {
    resetForm();
    setEditingVacancyId(v.id);
    setRole(v.role);
    setSkillsInput(v.skills.join(', '));
  };

  const handleSaveSlot = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPanelDisabled) return;

    const validation = validateVacancyForm({ role, skillsInput });
    if (Object.keys(validation.errors).length > 0) {
      setFieldErrors(validation.errors);
      return;
    }

    setBusy(true);
    setFormError(null);
    setFieldErrors({});

    try {
      if (editingVacancyId) {
        const updated = await updateVacancy(teamId, editingVacancyId, {
          role: validation.payload!.role,
          skills: validation.payload!.skills,
        });
        resetForm();
        onChanged(updated);
      } else {
        const updated = await addVacancy(teamId, {
          role: validation.payload!.role,
          skills: validation.payload!.skills,
        });
        resetForm();
        onChanged(updated);
      }
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setFormError('You need to sign in to manage vacancies.');
        return;
      }
      if (err instanceof TeamApiError) {
        if (err.errors) {
          setFieldErrors((prev) => ({
            ...prev,
            ...err.errors,
          }));
        }
        setFormError(
          postLockMutationErrorMessage({
            code: err.code,
            message: err.message,
            details: err.details,
          }) || 'An error occurred while saving the vacancy.'
        );
        return;
      }
      setFormError(err instanceof Error ? err.message : 'An error occurred.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRemove = async (vacancyId: string) => {
    if (isPanelDisabled) return;

    setBusy(true);
    setFormError(null);

    try {
      const { team } = await removeVacancy(teamId, vacancyId);
      resetForm();
      onChanged(team);
    } catch (err: unknown) {
      if (err instanceof TeamApiError) {
        setFormError(
          postLockMutationErrorMessage({
            code: err.code,
            message: err.message,
            details: err.details,
          }) || 'Failed to remove vacancy slot.'
        );
      } else {
        setFormError(err instanceof Error ? err.message : 'Failed to remove vacancy slot.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      aria-busy={busy}
      className="bg-white p-6 rounded-lg border border-cream-200 shadow-sm space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-cream-200 pb-4">
        <div>
          <h3 className="text-lg font-semibold text-forest-900">
            Recruiting Roles & Open Slots
          </h3>
          <p className="text-xs text-ink-muted mt-0.5">
            {limits.remainingCapacity !== null
              ? `${limits.remainingCapacity} slot${limits.remainingCapacity === 1 ? '' : 's'} remaining (${limits.confirmedMembers} confirmed, ${limits.openSlots} open)`
              : `${limits.confirmedMembers} confirmed members, ${limits.openSlots} open slots`}
          </p>
        </div>

        {!isAdding && !editingVacancyId && (
          <button
            type="button"
            onClick={handleStartAdd}
            disabled={isPanelDisabled || isAtCapacity}
            className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-xs font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50"
          >
            + Add Open Slot
          </button>
        )}
      </div>

      {formError && (
        <div
          role="alert"
          className="p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded-md"
        >
          {formError}
        </div>
      )}

      {fieldErrors.vacancies && (
        <div
          role="alert"
          className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md"
        >
          {fieldErrors.vacancies}
        </div>
      )}

      {/* Add / Edit Form Modal or Inline Region */}
      {(isAdding || editingVacancyId) && (
        <form
          onSubmit={handleSaveSlot}
          className="p-4 bg-cream-50 border border-cream-200 rounded-md space-y-4"
        >
          <h4 className="text-sm font-semibold text-ink">
            {editingVacancyId ? 'Edit Recruitment Slot' : 'Add New Recruitment Slot'}
          </h4>

          <div>
            <label
              htmlFor="vacancy-role"
              className="block text-xs font-medium text-ink mb-1"
            >
              Role <span className="text-red-500">*</span>
            </label>
            <select
              id="vacancy-role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                if (fieldErrors.role) setFieldErrors((prev) => ({ ...prev, role: undefined }));
              }}
              disabled={isPanelDisabled}
              aria-invalid={Boolean(fieldErrors.role)}
              aria-describedby={fieldErrors.role ? 'vacancy-role-error' : undefined}
              className={`${inputClass} ${fieldErrors.role ? 'border-red-400 bg-red-50/30' : 'border-cream-300'}`}
            >
              {TEAM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {fieldErrors.role && (
              <p id="vacancy-role-error" role="alert" className="mt-1 text-xs text-red-600">
                {fieldErrors.role}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="vacancy-skills"
              className="block text-xs font-medium text-ink mb-1"
            >
              Required Skills (Optional, comma-separated, max 10)
            </label>
            <input
              id="vacancy-skills"
              type="text"
              value={skillsInput}
              onChange={(e) => {
                setSkillsInput(e.target.value);
                if (fieldErrors.skills)
                  setFieldErrors((prev) => ({ ...prev, skills: undefined }));
              }}
              disabled={isPanelDisabled}
              aria-invalid={Boolean(fieldErrors.skills)}
              aria-describedby={fieldErrors.skills ? 'vacancy-skills-error' : undefined}
              className={`${inputClass} ${fieldErrors.skills ? 'border-red-400 bg-red-50/30' : 'border-cream-300'}`}
              placeholder="e.g. React, Tailwind CSS, TypeScript"
            />
            {fieldErrors.skills && (
              <p id="vacancy-skills-error" role="alert" className="mt-1 text-xs text-red-600">
                {fieldErrors.skills}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={isPanelDisabled}
              className="px-4 py-2 bg-forest text-white text-xs font-semibold rounded-md hover:bg-forest-800 disabled:opacity-50"
            >
              {busy ? 'Saving...' : editingVacancyId ? 'Update Slot' : 'Add Slot'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={isPanelDisabled}
              className="px-4 py-2 bg-white border border-cream-300 text-ink text-xs font-medium rounded-md hover:bg-cream-100 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Vacancies List */}
      {vacancies.length === 0 ? (
        <div
          role="status"
          className="p-6 text-center text-sm text-ink-muted bg-cream-50/50 rounded-md border border-dashed border-cream-200"
        >
          No open slots yet — add a role you're recruiting for.
        </div>
      ) : (
        <ul className="divide-y divide-cream-100">
          {vacancies.map((vacancy) => {
            const isRemoving = confirmRemoveId === vacancy.id;

            return (
              <li key={vacancy.id} className="py-4 space-y-1">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-forest-900">
                        {vacancy.role}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          vacancy.status === 'Open'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-cream-100 text-ink-muted'
                        }`}
                      >
                        {vacancy.status}
                      </span>
                    </div>

                    {vacancy.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {vacancy.skills.map((skill) => (
                          <span
                            key={skill}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-normal bg-cream-100 text-ink-muted"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {isRemoving ? (
                    <div
                      role="alertdialog"
                      aria-labelledby={`remove-slot-title-${vacancy.id}`}
                      className="p-3 bg-red-50 border border-red-200 rounded-md text-xs space-y-2"
                    >
                      <p id={`remove-slot-title-${vacancy.id}`} className="text-red-900 font-medium">
                        Remove this open slot? Any pending requests for it will be canceled.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleConfirmRemove(vacancy.id)}
                          disabled={isPanelDisabled}
                          className="px-3 py-1 bg-red-600 text-white font-semibold rounded hover:bg-red-700 disabled:opacity-50"
                        >
                          {busy ? 'Removing...' : 'Confirm Remove'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          disabled={isPanelDisabled}
                          className="px-3 py-1 bg-white border border-cream-300 text-ink rounded hover:bg-cream-100 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(vacancy)}
                        disabled={isPanelDisabled}
                        className="px-3 py-1 text-xs font-medium text-forest-800 bg-white border border-cream-200 rounded hover:bg-cream-50 disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetForm();
                          setConfirmRemoveId(vacancy.id);
                        }}
                        disabled={isPanelDisabled}
                        className="px-3 py-1 text-xs font-medium text-red-700 bg-white border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>

                {vacancy.status === 'Open' && !disabled ? (
                  <RecommendationPanel
                    teamId={teamId}
                    slotId={vacancy.id}
                    vacancyId={vacancy.id}
                    vacancyLabel={`${vacancy.role} slot`}
                    enabled
                    onInvitationIssued={onInvitationIssued}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
