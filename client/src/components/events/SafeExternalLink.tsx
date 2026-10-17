import React from 'react';

export interface SafeExternalLinkProps {
  url: string | null;
  label: string;
  disabled?: boolean;
}

/**
 * Renders an external anchor tag ONLY when:
 * 1. disabled is not true.
 * 2. URL is a valid, absolute HTTPS URL.
 * Enforces target="_blank" and rel="noopener noreferrer" per FR-020 and FR-076.
 * If disabled is true, renders an administrator-disabled notice with aria-disabled="true".
 * If url is null, empty, non-HTTPS, or malformed, renders a non-navigable unavailable notice.
 */
export function SafeExternalLink({
  url,
  label,
  disabled = false,
}: SafeExternalLinkProps): React.JSX.Element {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded italic"
      >
        Official link disabled by an administrator
      </span>
    );
  }

  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return <span className="text-xs text-ink-muted italic">Official link unavailable</span>;
  }

  const trimmed = url.trim();

  let isHttps = false;
  try {
    const parsed = new URL(trimmed);
    isHttps = parsed.protocol === 'https:';
  } catch {
    isHttps = false;
  }

  if (!isHttps) {
    return <span className="text-xs text-ink-muted italic">Official link unavailable</span>;
  }

  return (
    <a
      href={trimmed}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-semibold text-forest-700 hover:text-forest-900 underline focus:outline-none focus:ring-2 focus:ring-forest rounded"
    >
      <span>{label}</span>
      <span aria-hidden="true" className="text-[10px]">↗</span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
