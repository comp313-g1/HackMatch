import type { ChatReactionCode, ChatReactionSummary } from './chatTypes';

/**
 * US-035 / #406 — the fixed client table for the approved reaction codes
 * (#404 policy, section 3.7: glyphs come from a fixed client table keyed by
 * code, never from stored or server-supplied text).
 */
export const REACTION_DISPLAY: Readonly<Record<ChatReactionCode, { emoji: string; name: string }>> = {
  thumbs_up: { emoji: '👍', name: 'Thumbs up' },
  heart: { emoji: '❤️', name: 'Heart' },
  laugh: { emoji: '😂', name: 'Laugh' },
  party: { emoji: '🎉', name: 'Party' },
  surprised: { emoji: '😮', name: 'Surprised' },
  sad: { emoji: '😢', name: 'Sad' },
  eyes: { emoji: '👀', name: 'Eyes' },
  check: { emoji: '✅', name: 'Check mark' },
};

/** Screen-reader name for a summary button, e.g. "Heart, 3 reactions, you reacted". */
export function reactionLabel(summary: ChatReactionSummary): string {
  const noun = summary.count === 1 ? 'reaction' : 'reactions';
  return `${REACTION_DISPLAY[summary.reaction].name}, ${summary.count} ${noun}${summary.reactedByMe ? ', you reacted' : ''}`;
}
