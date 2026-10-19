import type { CompatibilityScoreFieldErrors, CompatibilityScoreSuccess } from './compatibilityTypes';

interface CompatibilityScoreResultProps {
  result?: CompatibilityScoreSuccess | null;
  errors?: CompatibilityScoreFieldErrors | null;
}

/**
 * User-visible success and failure outcomes for FR-043–045 scoring dry-run.
 * Does not clear or mutate caller form state — parents keep controls controlled.
 */
export function CompatibilityScoreResult({ result, errors }: CompatibilityScoreResultProps) {
  if (errors && Object.keys(errors).length > 0) {
    return (
      <div role="alert" data-testid="compatibility-score-errors">
        <p>Scoring could not run. Fix the highlighted fields — your entries were kept.</p>
        <ul>
          {Object.entries(errors).map(([field, message]) =>
            message ? (
              <li key={field}>
                <strong>{field}</strong>: {message}
              </li>
            ) : null
          )}
        </ul>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div data-testid="compatibility-score-success">
      <p>
        Compatibility score: <strong>{result.displayScore}</strong>
        {result.hadMissingInput ? ' (some inputs were missing and scored as 0)' : null}
      </p>
      <ul>
        <li>Skills: {result.contributions.skill}</li>
        <li>Goal: {result.contributions.goal}</li>
        <li>Hours: {result.contributions.hours}</li>
      </ul>
      <p>{result.notice}</p>
    </div>
  );
}
