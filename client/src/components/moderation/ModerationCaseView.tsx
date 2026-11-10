import React from 'react';
import type {
  ModerationCaseDetail,
  ModerationDetailState,
  SanitizedModerationTarget,
} from './moderationTypes';

export interface ModerationCaseViewProps {
  detail: ModerationCaseDetail | null;
  detailState: ModerationDetailState;
  detailError: string | null;
  onRetry: () => void;
  onBackToQueue?: () => void;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatUtc(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString();
}

function UnavailableChatTarget({ kind }: { kind: 'channel' | 'message' }): React.JSX.Element {
  return (
    <div
      role="status"
      className="space-y-1 rounded border border-amber-200 bg-amber-50 p-3 text-sm"
      data-testid="moderation-chat-target-unavailable"
    >
      <p className="font-medium text-amber-950">Chat {kind} unavailable</p>
      <p className="text-xs text-amber-900">
        The moderation case is retained, but its referenced chat target is missing or stale.
      </p>
    </div>
  );
}

function TargetBody({ target }: { target: SanitizedModerationTarget }): React.JSX.Element {
  if (target.type === 'team') {
    const t = target.team;
    return (
      <div className="space-y-2 text-sm" data-testid="moderation-target-team">
        <p>
          <span className="font-medium text-forest-900">{t.name}</span>
          <span className="text-ink-muted"> · {t.recruitmentStatus}</span>
        </p>
        <p className="text-ink">{t.pitch}</p>
        <p className="text-xs text-ink-muted">
          Goal: {t.goal} · {t.commitmentHours}h · Owner:{' '}
          {t.ownerHandle?.trim() || t.ownerDisplayName || '—'}
        </p>
        {t.moderationStatus && t.moderationStatus !== 'None' ? (
          <p className="text-xs text-ink" data-testid="moderation-target-status">
            Moderation status: {t.moderationStatus}
          </p>
        ) : null}
        {t.communicationLink ? (
          <p className="text-xs break-all">
            <span className="text-ink-muted">Communication link: </span>
            <a
              href={t.communicationLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-forest-800 underline"
            >
              {t.communicationLink}
            </a>
          </p>
        ) : null}
        {t.linkRemovalNotice ? (
          <p className="text-xs text-amber-900" data-testid="moderation-link-removal-notice">
            {t.linkRemovalNotice}
          </p>
        ) : null}
      </div>
    );
  }

  if (target.type === 'profile') {
    const p = target.profile;
    return (
      <div className="space-y-2 text-sm" data-testid="moderation-target-profile">
        <p className="font-medium text-forest-900">
          {p.handle?.trim() || p.displayName || 'Participant'}
          {p.primaryRole ? <span className="font-normal text-ink-muted"> · {p.primaryRole}</span> : null}
        </p>
        {p.institution ? <p className="text-xs text-ink-muted">{p.institution}</p> : null}
        {p.skills.length > 0 ? (
          <p className="text-xs text-ink">Skills: {p.skills.join(', ')}</p>
        ) : null}
        {p.portfolios.length > 0 ? (
          <ul className="text-xs space-y-1">
            {p.portfolios.map((link) => (
              <li key={link.url} className="break-all">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-forest-800 underline"
                >
                  {link.label?.trim() || link.url}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  if (target.type === 'event') {
    const e = target.event;
    return (
      <div className="space-y-2 text-sm" data-testid="moderation-target-event">
        <p className="font-medium text-forest-900">{e.title}</p>
        <p className="text-xs text-ink-muted">
          {e.format} · {e.status}
        </p>
      </div>
    );
  }

  if (target.type === 'chat_channel') {
    const channel = target.chatChannel;
    if (channel.availability === 'Unavailable') {
      return <UnavailableChatTarget kind="channel" />;
    }

    return (
      <div className="space-y-2 text-sm" data-testid="moderation-target-chat-channel">
        <div>
          <p className="font-medium text-forest-900">{channel.title}</p>
          <p className="text-xs text-ink-muted">
            {channel.channelType === 'team' ? 'Private team channel' : 'Public forum'}
          </p>
        </div>
        {channel.description ? <p className="text-ink">{channel.description}</p> : null}
        <dl className="grid gap-1 text-xs">
          <div>
            <dt className="inline text-ink-muted">Creator handle: </dt>
            <dd className="inline text-ink">{channel.creatorHandle?.trim() || 'Unavailable'}</dd>
          </div>
          <div>
            <dt className="inline text-ink-muted">Created (UTC): </dt>
            <dd className="inline text-ink">
              <time dateTime={channel.createdAt}>{formatUtc(channel.createdAt)}</time>
            </dd>
          </div>
        </dl>
        {channel.contentRedacted ? (
          <p className="text-xs text-amber-900" data-testid="moderation-chat-content-redacted">
            Sensitive content was redacted from this evidence summary.
          </p>
        ) : null}
      </div>
    );
  }

  if (target.type === 'chat_message') {
    const message = target.chatMessage;
    if (message.availability === 'Unavailable') {
      return <UnavailableChatTarget kind="message" />;
    }

    return (
      <div className="space-y-2 text-sm" data-testid="moderation-target-chat-message">
        <dl className="grid gap-1 text-xs">
          <div>
            <dt className="inline text-ink-muted">Author handle: </dt>
            <dd className="inline text-ink">{message.authorHandle?.trim() || 'Unavailable'}</dd>
          </div>
          <div>
            <dt className="inline text-ink-muted">Sent (UTC): </dt>
            <dd className="inline text-ink">
              <time dateTime={message.createdAt}>{formatUtc(message.createdAt)}</time>
            </dd>
          </div>
        </dl>
        <blockquote className="rounded border-l-4 border-forest-200 bg-cream-50 px-3 py-2 text-ink whitespace-pre-wrap break-words">
          {message.messageContext.text}
        </blockquote>
        {message.messageContext.redacted || message.messageContext.truncated ? (
          <p className="text-xs text-amber-900" data-testid="moderation-chat-content-limited">
            {message.messageContext.redacted && message.messageContext.truncated
              ? 'Sensitive content was redacted and the evidence excerpt was truncated.'
              : message.messageContext.redacted
                ? 'Sensitive content was redacted from this evidence excerpt.'
                : 'The evidence excerpt was truncated.'}
          </p>
        ) : null}
      </div>
    );
  }

  const u = target.url;
  return (
    <div className="space-y-2 text-sm" data-testid="moderation-target-url">
      <p className="break-all">
        <span className="text-ink-muted">Flagged URL: </span>
        <a
          href={u.flaggedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-forest-800 underline font-medium"
        >
          {u.flaggedUrl}
        </a>
      </p>
      <p className="text-xs text-ink-muted">
        Owning {u.owningTargetType}: {u.owningTargetId.slice(0, 8)}…
      </p>
    </div>
  );
}

const DEFAULT_PRIVACY_NOTICE =
  'Credentials, private contact handles, and private workspace content are not available through moderation cases.';

/**
 * Case + sanitized target detail panel (US-026 / #241 / #245).
 * Does not surface credentials, private contacts, or private workspace data.
 */
export function ModerationCaseView({
  detail,
  detailState,
  detailError,
  onRetry,
  onBackToQueue,
}: ModerationCaseViewProps): React.JSX.Element {
  if (detailState === 'idle') {
    return (
      <div
        role="status"
        className="p-6 text-center text-sm text-ink-muted border border-dashed border-cream-300 rounded-md"
        data-testid="moderation-case-idle"
      >
        Select a case from the queue to inspect its target.
      </div>
    );
  }

  if (detailState === 'loading' && !detail) {
    return (
      <p role="status" className="text-sm text-forest-800" data-testid="moderation-case-loading">
        Loading case detail…
      </p>
    );
  }

  if (detailState === 'error' && !detail) {
    return (
      <div
        role="alert"
        className="text-sm text-red-800 space-y-2 p-3 bg-red-50 border border-red-200 rounded-md"
        data-testid="moderation-case-error"
      >
        <p>{detailError || 'Could not load this case.'}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 text-xs font-medium border border-red-200 rounded bg-white hover:bg-red-50"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!detail) {
    return (
      <div role="status" className="text-sm text-ink-muted" data-testid="moderation-case-idle">
        Select a case from the queue to inspect its target.
      </div>
    );
  }

  const c = detail.case;

  return (
    <article
      className="space-y-4 rounded-md border border-cream-200 bg-white p-4"
      data-testid="moderation-case-detail"
      aria-labelledby="moderation-case-heading"
    >
      {detailState === 'loading' ? (
        <p role="status" className="text-xs text-ink-muted" data-testid="moderation-case-refreshing">
          Refreshing case…
        </p>
      ) : null}

      {detailState === 'error' && detailError ? (
        <div role="alert" className="text-xs text-red-800" data-testid="moderation-case-inline-error">
          {detailError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="moderation-case-heading" className="font-display text-lg font-semibold text-forest-900">
            Case detail
          </h3>
          <p className="text-xs text-ink-muted mt-0.5" data-testid="moderation-case-created-at">
            Opened {formatWhen(c.createdAt)}
          </p>
        </div>
        {onBackToQueue ? (
          <button
            type="button"
            onClick={onBackToQueue}
            className="text-xs font-medium text-forest-800 hover:underline"
            data-testid="moderation-back-to-queue"
          >
            ← Back to queue
          </button>
        ) : null}
      </div>

      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Target</dt>
          <dd className="text-ink" data-testid="moderation-case-target-type">
            {c.targetType}
            {c.flaggedUrl ? (
              <span className="block text-xs break-all text-ink-muted mt-0.5">{c.flaggedUrl}</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Reason</dt>
          <dd className="text-ink" data-testid="moderation-case-reason">
            {c.reason}
          </dd>
        </div>
        <div className="flex flex-wrap gap-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Status</dt>
            <dd data-testid="moderation-case-status">{c.status}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Reports</dt>
            <dd data-testid="moderation-case-report-count">{c.reportCount}</dd>
          </div>
        </div>
      </dl>

      <section aria-labelledby="moderation-target-heading" className="border-t border-cream-200 pt-3">
        <h4 id="moderation-target-heading" className="text-xs uppercase tracking-wide text-ink-muted mb-2">
          Target content
        </h4>
        <TargetBody target={detail.target} />
      </section>

      <p
        role="note"
        className="text-xs text-ink-muted border-t border-cream-200 pt-3"
        data-testid="moderation-privacy-notice"
      >
        {detail.privacy?.notice ?? DEFAULT_PRIVACY_NOTICE}
      </p>
    </article>
  );
}
