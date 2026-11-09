/**
 * Formats a server timestamp as an unambiguous UTC string, e.g.
 * "2026-11-03 10:00:00 UTC". Done from the ISO text (no Date / locale) so the
 * result never shifts with the viewer's time zone (AC 2: UTC time).
 */
export function formatUtcTimestamp(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/.exec(iso);
  return match ? `${match[1]} ${match[2]} UTC` : iso;
}

/** Human-readable action: "moderation_url_disabled" -> "Url disabled" after the category prefix. */
export function formatActionLabel(actionType: string): string {
  const withoutPrefix = actionType.replace(/^(moderation|account|event)_/, '');
  const words = withoutPrefix.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : actionType;
}

/** Stable, readable JSON for the safe-state summary (keys sorted so it never reorders between renders). */
export function formatSummary(summary: Record<string, unknown>): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, sort(v)])
      );
    }
    return value;
  };
  return JSON.stringify(sort(summary), null, 2);
}
