/**
 * US-035 / #405 — message reaction model, following the approved #404 policy
 * (docs/04_requirements/us035_rich_chat_policy.md, section 4).
 *
 * The set is fixed and its order is the canonical display/response order. The
 * database enforces the same set (is_approved_chat_reaction, migration 0067).
 * Clients get codes only; glyphs are mapped from a fixed client table.
 */

export const CHAT_REACTIONS = [
  'thumbs_up',
  'heart',
  'laugh',
  'party',
  'surprised',
  'sad',
  'eyes',
  'check',
] as const;

export type ChatReaction = (typeof CHAT_REACTIONS)[number];

const REACTION_ORDER = new Map<string, number>(CHAT_REACTIONS.map((code, index) => [code, index]));

/** Exact, case-sensitive match against the approved codes. No Unicode or custom values. */
export function isChatReaction(value: unknown): value is ChatReaction {
  return typeof value === 'string' && REACTION_ORDER.has(value);
}

export function compareChatReactions(a: ChatReaction, b: ChatReaction): number {
  return (REACTION_ORDER.get(a) ?? 0) - (REACTION_ORDER.get(b) ?? 0);
}

/** Which message table a reaction belongs to. Team channels share the channel tables. */
export type ChatReactionScope = 'channel' | 'directMessage';

/** Safe aggregate: counts and the viewer's own state, never who reacted. */
export interface ChatReactionSummary {
  reaction: ChatReaction;
  count: number;
  reactedByMe: boolean;
}

/** #404 section 4: 30 reaction mutation requests per participant per rolling minute. */
export const REACTION_RATE_LIMIT_MAX = 30;
export const REACTION_RATE_LIMIT_WINDOW_MS = 60_000;
