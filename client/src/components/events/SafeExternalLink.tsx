import React from 'react';

export interface SafeExternalLinkProps {
  url: string | null;
  label: string;
}

/**
 * Renders an external anchor tag ONLY when the URL is a valid, absolute HTTPS URL.
 * Enforces target="_blank" and rel="noopener noreferrer" per FR-020 and security guidelines.
 * If url is null, empty, non-HTTPS, or malformed, renders a non-navigable text notice.
 */
export function SafeExternalLink({ url, label }: SafeExternalLinkProps): React.JSX.Element {
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
