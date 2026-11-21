import React, { useEffect, useId, useRef, useState } from 'react';
import { AuthRequiredError, ChatApiError, setChatMessageReaction } from './chatApi';
import { useChatReactionCapability } from './ChatCapabilitiesContext';
import { REACTION_DISPLAY, reactionLabel } from './chatReactionDisplay';
import {
  CHAT_REACTION_CODES,
  type ChatReactionCode,
  type ChatReactionSummary,
  type ChatReactionTarget,
} from './chatTypes';

/**
 * US-035 / #406 — reaction summaries and controls for one chat message, shared by
 * public forums, private team chat, and direct messages.
 *
 * State model
 *  - The parent's message (`reactions` prop) is the confirmed server aggregate.
 *  - At most ONE reaction change per message is in flight. While it is, that
 *    message's reaction controls are paused (aria-disabled), so responses for the
 *    same message can never arrive out of order and invert the result. Other
 *    messages and text chat stay fully usable.
 *  - The in-flight change is shown optimistically as an overlay. On success the
 *    server's stored aggregate replaces the message's reactions; on failure the
 *    overlay is dropped, which restores the last confirmed state.
 *  - Nothing is persisted outside React memory, and an unmounted instance (account,
 *    channel, team, or thread change) ignores any late response.
 */

const FEEDBACK_MS = 8000;

export interface MessageReactionsProps {
  target: ChatReactionTarget;
  messageId: string;
  /** Server aggregate from the message response; absent when the server omitted it. */
  reactions?: ChatReactionSummary[];
  /** Receives the stored aggregate after a confirmed change. */
  onReactionsChange: (messageId: string, reactions: ChatReactionSummary[]) => void;
  /** False when the conversation is known to be read-only for the caller (e.g. you blocked the peer). */
  interactive?: boolean;
}

interface PendingChange {
  reaction: ChatReactionCode;
  present: boolean;
}

/** Keeps only approved codes with a positive count, in the approved order. */
function confirmedSummaries(reactions: ChatReactionSummary[] | undefined): ChatReactionSummary[] {
  if (!Array.isArray(reactions)) return [];
  return CHAT_REACTION_CODES.flatMap((code) => {
    const entry = reactions.find((item) => item?.reaction === code);
    return entry && Number.isSafeInteger(entry.count) && entry.count > 0
      ? [{ reaction: code, count: entry.count, reactedByMe: entry.reactedByMe === true }]
      : [];
  });
}

function withPending(confirmed: ChatReactionSummary[], pending: PendingChange | null): ChatReactionSummary[] {
  if (!pending) return confirmed;
  const current = confirmed.find((item) => item.reaction === pending.reaction);
  const mine = current?.reactedByMe === true;
  if (mine === pending.present) return confirmed;
  const count = (current?.count ?? 0) + (pending.present ? 1 : -1);
  const others = confirmed.filter((item) => item.reaction !== pending.reaction);
  const next = count > 0 ? [...others, { reaction: pending.reaction, count, reactedByMe: pending.present }] : others;
  return next.sort((a, b) => CHAT_REACTION_CODES.indexOf(a.reaction) - CHAT_REACTION_CODES.indexOf(b.reaction));
}

const pillBase =
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-5 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-1';
const pillMine = 'border-2 border-forest bg-forest-50 font-semibold text-forest-900';
const pillOther = 'border-cream-300 bg-white text-ink hover:bg-cream-50';
const pausedClass = 'opacity-60 cursor-not-allowed';

export function MessageReactions({
  target,
  messageId,
  reactions,
  onReactionsChange,
  interactive = true,
}: MessageReactionsProps): React.JSX.Element | null {
  const capability = useChatReactionCapability();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const mounted = useRef(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const pickerId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (pickerOpen) firstOptionRef.current?.focus();
  }, [pickerOpen]);

  useEffect(() => {
    if (focusTrigger > 0) triggerRef.current?.focus();
  }, [focusTrigger]);

  if (!capability.reactionsEnabled) return null;

  const confirmed = confirmedSummaries(reactions);
  const shown = withPending(confirmed, pending);
  const paused = pending !== null || capability.rateLimitedUntil !== null;
  const canChange = interactive && !paused;
  const options = capability.allowedReactions;

  const describeFailure = (error: unknown): string | null => {
    if (error instanceof AuthRequiredError) return 'Please sign in again to react.';
    if (!(error instanceof ChatApiError)) return 'Could not update the reaction. Please try again.';
    if (error.code === 'FEATURE_DISABLED') {
      capability.markReactionsUnavailable();
      return null;
    }
    if (error.status === 429) {
      const seconds = error.retryAfterSeconds ?? 10;
      capability.noteRateLimited(seconds);
      return `Reaction limit reached. Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
    }
    switch (error.code) {
      case 'DM_BLOCKED_BY_YOU':
        return 'You have blocked this participant. Unblock them to react.';
      case 'DM_PEER_UNAVAILABLE':
        return 'You cannot react in this conversation.';
      case 'TEAM_CHANNEL_READ_ONLY':
        return 'This team channel is read-only.';
      case 'MESSAGE_NOT_FOUND':
      case 'CHANNEL_NOT_FOUND':
      case 'TEAM_CHANNEL_NOT_FOUND':
        return 'This message is no longer available.';
      default:
        if (error.status === 401) return 'Please sign in again to react.';
        if (error.status === 403) return 'You cannot react to this message.';
        return 'Could not update the reaction. Please try again.';
    }
  };

  const choose = async (reaction: ChatReactionCode, fromPicker: boolean): Promise<void> => {
    if (!canChange) return;
    const current = confirmed.find((item) => item.reaction === reaction);
    const change: PendingChange = { reaction, present: current?.reactedByMe !== true };
    setPending(change);
    setFeedback(null);
    if (fromPicker) setPickerOpen(false);

    // Removing your own last reaction hides its pill at once; keep keyboard focus on a
    // stable control (the "Add reaction" button) rather than losing it to the page.
    let nextFocusTrigger = fromPicker || (!change.present && current?.count === 1);
    try {
      const result = await setChatMessageReaction(target, messageId, reaction, change.present);
      if (!mounted.current) return;
      onReactionsChange(messageId, result.reactions);
      if (!result.reactions.some((item) => item.reaction === reaction)) nextFocusTrigger = true;
    } catch (error) {
      if (!mounted.current) return;
      setFeedback(describeFailure(error));
    } finally {
      if (mounted.current) {
        setPending(null);
        if (nextFocusTrigger) setFocusTrigger((n) => n + 1);
      }
    }
  };

  const closePicker = (): void => {
    setPickerOpen(false);
    setFocusTrigger((n) => n + 1);
  };

  return (
    <div
      ref={containerRef}
      className="mt-2"
      data-testid="message-reactions"
      onBlur={(event) => {
        if (pickerOpen && !containerRef.current?.contains(event.relatedTarget as Node | null)) setPickerOpen(false);
      }}
    >
      <div role="group" aria-label="Reactions" aria-busy={pending !== null} className="flex flex-wrap items-center gap-1.5">
        {shown.map((summary) => (
          <button
            key={summary.reaction}
            type="button"
            aria-label={reactionLabel(summary)}
            aria-pressed={summary.reactedByMe}
            aria-disabled={!canChange || undefined}
            onClick={() => void choose(summary.reaction, false)}
            className={`${pillBase} ${summary.reactedByMe ? pillMine : pillOther} ${!canChange ? pausedClass : ''}`}
            data-reaction={summary.reaction}
          >
            <span aria-hidden="true">{REACTION_DISPLAY[summary.reaction].emoji}</span>
            <span aria-hidden="true">{summary.count}</span>
          </button>
        ))}

        {interactive && options.length > 0 && (
          <button
            ref={triggerRef}
            type="button"
            aria-label="Add reaction"
            aria-expanded={pickerOpen}
            aria-controls={pickerId}
            aria-disabled={paused || undefined}
            onClick={() => {
              if (paused) return;
              setPickerOpen((open) => !open);
            }}
            className={`${pillBase} border-dashed border-cream-300 bg-white text-ink-muted hover:bg-cream-50 ${paused ? pausedClass : ''}`}
          >
            <span aria-hidden="true">＋</span>
            <span aria-hidden="true">🙂</span>
          </button>
        )}
      </div>

      {interactive && pickerOpen && (
        <div
          id={pickerId}
          role="group"
          aria-label="Choose a reaction"
          className="mt-1.5 flex flex-wrap gap-1 rounded-md border border-cream-200 bg-white p-1.5 shadow-sm"
        >
          {options.map((code, index) => {
            const mine = confirmed.find((item) => item.reaction === code)?.reactedByMe === true;
            return (
              <button
                key={code}
                ref={index === 0 ? firstOptionRef : undefined}
                type="button"
                aria-label={REACTION_DISPLAY[code].name}
                aria-pressed={mine}
                aria-disabled={!canChange || undefined}
                onClick={() => void choose(code, true)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    closePicker();
                  }
                }}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-base focus:outline-none focus:ring-2 focus:ring-forest ${
                  mine ? 'border-2 border-forest bg-forest-50' : 'border border-transparent hover:bg-cream-50'
                } ${!canChange ? pausedClass : ''}`}
              >
                <span aria-hidden="true">{REACTION_DISPLAY[code].emoji}</span>
              </button>
            );
          })}
        </div>
      )}

      {feedback && (
        <p role="alert" className="mt-1 text-xs text-red-700" data-testid="reaction-feedback">
          {feedback}
        </p>
      )}
    </div>
  );
}
