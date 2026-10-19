import React from 'react';
import {
  ALLOWED_PRIMARY_ROLES,
  TEAM_GOALS,
  type OpenTeamsFilterDraft,
  type OpenTeamsFilterErrors,
} from './openTeamsApi';

export interface OpenTeamsFilterBarProps {
  values: OpenTeamsFilterDraft;
  errors: OpenTeamsFilterErrors;
  onChange: (next: OpenTeamsFilterDraft) => void;
  onSubmit: () => void;
  onReset: () => void;
  isLoading: boolean;
  canReset: boolean;
}

const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';
const primaryBtnClass =
  'py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';
const secondaryBtnClass =
  'py-2 px-4 border border-cream-200 rounded-md shadow-sm text-sm font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';

export function OpenTeamsFilterBar({
  values,
  errors,
  onChange,
  onSubmit,
  onReset,
  isLoading,
  canReset,
}: OpenTeamsFilterBarProps): React.JSX.Element {
  const handleInputChange = (field: keyof OpenTeamsFilterDraft, val: string) => {
    onChange({
      ...values,
      [field]: val,
    });
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      aria-label="Filter open teams"
      className="bg-white p-5 rounded-xl border border-cream-200 shadow-sm space-y-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Skills Filter */}
        <div>
          <label htmlFor="filter-skills" className="block text-xs font-semibold text-ink uppercase tracking-wider mb-1">
            Skills
          </label>
          <input
            id="filter-skills"
            type="text"
            value={values.skills}
            onChange={(e) => handleInputChange('skills', e.target.value)}
            disabled={isLoading}
            placeholder="React, Node.js"
            aria-describedby={
              errors.skills ? 'filter-skills-error filter-skills-hint' : 'filter-skills-hint'
            }
            aria-invalid={Boolean(errors.skills)}
            className={`${inputClass} ${errors.skills ? 'border-red-500' : 'border-cream-300'}`}
          />
          <p id="filter-skills-hint" className="mt-1 text-xs text-ink-muted">
            Comma-separated; a vacancy must need all of them
          </p>
          {errors.skills && (
            <p id="filter-skills-error" role="alert" className="mt-1 text-xs text-red-600 font-medium">
              {errors.skills}
            </p>
          )}
        </div>

        {/* Role Filter */}
        <div>
          <label htmlFor="filter-role" className="block text-xs font-semibold text-ink uppercase tracking-wider mb-1">
            Role
          </label>
          <select
            id="filter-role"
            value={values.role}
            onChange={(e) => handleInputChange('role', e.target.value)}
            disabled={isLoading}
            aria-describedby={errors.role ? 'filter-role-error' : undefined}
            aria-invalid={Boolean(errors.role)}
            className={`${inputClass} ${errors.role ? 'border-red-500' : 'border-cream-300'}`}
          >
            <option value="">All roles</option>
            {ALLOWED_PRIMARY_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          {errors.role && (
            <p id="filter-role-error" role="alert" className="mt-1 text-xs text-red-600 font-medium">
              {errors.role}
            </p>
          )}
        </div>

        {/* Goal Filter */}
        <div>
          <label htmlFor="filter-goal" className="block text-xs font-semibold text-ink uppercase tracking-wider mb-1">
            Goal
          </label>
          <select
            id="filter-goal"
            value={values.goal}
            onChange={(e) => handleInputChange('goal', e.target.value)}
            disabled={isLoading}
            aria-describedby={errors.goal ? 'filter-goal-error' : undefined}
            aria-invalid={Boolean(errors.goal)}
            className={`${inputClass} ${errors.goal ? 'border-red-500' : 'border-cream-300'}`}
          >
            <option value="">All goals</option>
            {TEAM_GOALS.map((goal) => (
              <option key={goal} value={goal}>
                {goal}
              </option>
            ))}
          </select>
          {errors.goal && (
            <p id="filter-goal-error" role="alert" className="mt-1 text-xs text-red-600 font-medium">
              {errors.goal}
            </p>
          )}
        </div>

        {/* Minimum Open Slots Filter */}
        <div>
          <label htmlFor="filter-min-slots" className="block text-xs font-semibold text-ink uppercase tracking-wider mb-1">
            Minimum open slots
          </label>
          <input
            id="filter-min-slots"
            type="number"
            min={1}
            max={20}
            value={values.minSlots}
            onChange={(e) => handleInputChange('minSlots', e.target.value)}
            disabled={isLoading}
            placeholder="1"
            aria-describedby={errors.minSlots ? 'filter-min-slots-error' : undefined}
            aria-invalid={Boolean(errors.minSlots)}
            className={`${inputClass} ${errors.minSlots ? 'border-red-500' : 'border-cream-300'}`}
          />
          {errors.minSlots && (
            <p id="filter-min-slots-error" role="alert" className="mt-1 text-xs text-red-600 font-medium">
              {errors.minSlots}
            </p>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isLoading}
          className={primaryBtnClass}
        >
          {isLoading ? 'Applying...' : 'Apply filters'}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={!canReset || isLoading}
          className={secondaryBtnClass}
        >
          Reset filters
        </button>
      </div>
    </form>
  );
}
