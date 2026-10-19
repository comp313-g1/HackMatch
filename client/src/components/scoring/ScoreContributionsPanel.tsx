export interface ScoreContributionItem {
  component: 'skill' | 'goal' | 'hours';
  label: string;
  value: number;
  detail: string;
}

export interface ScoreContributionsPanelProps {
  displayScore?: string;
  notice?: string;
  items?: ScoreContributionItem[] | null;
  contributions?: { skill: string; goal: string; hours: string } | null;
  /** Validation / load failure — parent keeps prior form values (NR-017). */
  errorMessage?: string | null;
  emptyMessage?: string;
}

/**
 * Owner-visible FR-047 score contributions. Renders labels + details only —
 * never shows internal ranking identifiers.
 */
export function ScoreContributionsPanel({
  displayScore,
  notice,
  items,
  contributions,
  errorMessage,
  emptyMessage = 'Open a recommendation to see skill, goal, and hours contributions.',
}: ScoreContributionsPanelProps) {
  if (errorMessage) {
    return (
      <div role="alert" data-testid="score-contributions-error">
        <p>{errorMessage}</p>
        <p>Your previous entries were kept.</p>
      </div>
    );
  }

  const rows: ScoreContributionItem[] =
    items && items.length > 0
      ? items
      : contributions
        ? [
            { component: 'skill', label: 'Skills', value: 0, detail: contributions.skill },
            { component: 'goal', label: 'Goal', value: 0, detail: contributions.goal },
            { component: 'hours', label: 'Hours', value: 0, detail: contributions.hours },
          ]
        : [];

  if (rows.length === 0) {
    return (
      <div role="status" data-testid="score-contributions-empty">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div data-testid="score-contributions-panel">
      {displayScore ? (
        <p>
          Compatibility score: <strong>{displayScore}</strong>
        </p>
      ) : null}
      <ul>
        {rows.map((row) => (
          <li key={row.component}>
            <strong>{row.label}</strong>
            {Number.isFinite(row.value) ? ` (${row.value.toFixed(2)})` : ''}: {row.detail}
          </li>
        ))}
      </ul>
      {notice ? <p data-testid="score-contributions-notice">{notice}</p> : null}
    </div>
  );
}
