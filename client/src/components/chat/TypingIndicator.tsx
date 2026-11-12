import React from 'react';
import { typingSummary } from './chatTypingDisplay';

/**
 * US-035 / #408 — "Avery is typing…" line for the active conversation.
 *
 * The polite status region stays mounted while typing indicators are enabled, so
 * screen readers announce only real text changes (someone starts or stops). A
 * repeated signal from the same person refreshes its expiry without changing the
 * text, so it is never re-announced. No animation, no color-only meaning, and it
 * never takes focus.
 */
export function TypingIndicator({
  enabled,
  typists,
}: {
  enabled: boolean;
  typists: Array<string | null>;
}): React.JSX.Element | null {
  if (!enabled) return null;
  return (
    <p role="status" aria-live="polite" data-testid="typing-indicator" className="min-h-[1rem] text-xs italic text-ink-muted">
      {typingSummary(typists)}
    </p>
  );
}
