import React from 'react';
import type { PublicEvent } from './eventTypes.js';
import {
  formatEventDates,
  formatTeamLimits,
  getTimeStateBadge,
} from './eventFormatters.js';

export interface EventMetadataProps {
  event: PublicEvent;
}

export function EventMetadata({ event }: EventMetadataProps): React.JSX.Element {
  const badge = getTimeStateBadge(event.time_state);
  const dateRange = formatEventDates(event.start_date, event.end_date);
  const teamLimits = formatTeamLimits(event.min_team_size, event.max_team_size);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full border ${badge.className}`}
        >
          {badge.label}
        </span>
        <span className="inline-flex items-center text-xs font-medium text-forest-800 bg-forest-50 px-2.5 py-0.5 rounded border border-forest-200">
          ✓ Verified Record
        </span>
        <span className="inline-flex items-center text-xs font-medium text-ink-muted bg-cream-100 px-2.5 py-0.5 rounded border border-cream-200">
          {event.format}
        </span>
        {event.status === 'Archived' && (
          <span className="inline-flex items-center text-xs font-medium text-neutral-700 bg-neutral-100 px-2 py-0.5 rounded border border-neutral-300">
            Archived
          </span>
        )}
      </div>

      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-forest-900 tracking-tight">
          {event.title}
        </h1>
        {event.event_edition && (
          <p className="text-sm text-ink-muted font-mono mt-1">
            Edition: {event.event_edition}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-cream-50/70 border border-cream-200 rounded-lg p-4">
        <div>
          <dt className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            Event Dates
          </dt>
          <dd className="text-sm font-medium text-ink mt-0.5 flex items-center gap-1.5">
            <span>📅</span>
            <span>{dateRange}</span>
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            Location
          </dt>
          <dd className="text-sm font-medium text-ink mt-0.5 flex items-center gap-1.5">
            <span>📍</span>
            <span>{event.location?.trim() || 'Not specified'}</span>
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            Format
          </dt>
          <dd className="text-sm font-medium text-ink mt-0.5">
            {event.format}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            Official Team Size Limits
          </dt>
          <dd className="text-sm font-medium text-ink mt-0.5">
            {teamLimits}
          </dd>
        </div>
      </dl>
    </div>
  );
}
