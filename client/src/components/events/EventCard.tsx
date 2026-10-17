import type { PublicEvent } from './eventTypes.js';
import {
  formatEventDates,
  formatTeamLimits,
  getTimeStateBadge,
} from './eventFormatters.js';
import { SafeExternalLink } from './SafeExternalLink.js';

export interface EventCardProps {
  event: PublicEvent;
  onSelect?: (id: string) => void;
}

function getTimeStateBadge(timeState: PublicEvent['time_state']): { label: string; className: string } {
  switch (timeState) {
    case 'upcoming':
      return {
        label: 'Upcoming',
        className: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      };
    case 'ongoing':
      return {
        label: 'Ongoing',
        className: 'bg-blue-100 text-blue-800 border-blue-300',
      };
    case 'concluded':
      return {
        label: 'Concluded',
        className: 'bg-amber-100 text-amber-800 border-amber-300',
      };
  }
}

export function EventCard({ event, onSelect }: EventCardProps): React.JSX.Element {
  const badge = getTimeStateBadge(event.time_state);
  const dateRange = formatEventDates(event.start_date, event.end_date);
  const teamLimits = formatTeamLimits(event.min_team_size, event.max_team_size);

  return (
    <li className="bg-white border border-cream-300 rounded-lg shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col justify-between gap-4">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <span
            className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full border ${badge.className}`}
          >
            {badge.label}
          </span>
          <span className="inline-flex items-center text-xs font-medium text-ink-muted bg-cream-100 px-2.5 py-0.5 rounded border border-cream-200">
            {event.format}
          </span>
        </div>

        <h3 className="font-display text-lg font-bold text-forest-900 tracking-tight">
          {event.title}
        </h3>

        {event.event_edition && (
          <p className="text-xs text-ink-muted font-mono">Edition: {event.event_edition}</p>
        )}

        <p className="text-sm text-ink-muted flex items-center gap-1.5">
          <span>📅</span>
          <span>{dateRange}</span>
        </p>

        <p className="text-sm text-ink-muted flex items-center gap-1.5">
          <span>📍</span>
          <span>{event.location?.trim() || 'Not specified'}</span>
        </p>

        <p className="text-xs text-ink-muted flex items-center gap-1.5">
          <span>👥</span>
          <span>Team Size: {teamLimits}</span>
        </p>
      </div>

      <div className="pt-3 border-t border-cream-100 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <SafeExternalLink url={event.official_url} label="Official Site" />
        </div>
        {onSelect && (
          <button
            type="button"
            onClick={() => onSelect(event.id)}
            className="text-xs font-semibold px-3 py-1.5 bg-forest-50 text-forest-800 border border-forest-200 rounded hover:bg-forest-100 focus:outline-none focus:ring-2 focus:ring-forest transition"
          >
            View Details
          </button>
        )}
      </div>
    </li>
  );
}
