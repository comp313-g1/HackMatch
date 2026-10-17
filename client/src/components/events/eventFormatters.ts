import type { PublicEvent } from './eventTypes.js';

export function formatEventDates(startDate: string, endDate: string): string {
  try {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return 'Date unavailable';
    }
    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    };
    const startFormatted = start.toLocaleDateString(undefined, options);
    const endFormatted = end.toLocaleDateString(undefined, options);

    if (startFormatted === endFormatted) {
      return startFormatted;
    }
    return `${startFormatted} – ${endFormatted}`;
  } catch {
    return 'Date unavailable';
  }
}

export function formatTeamLimits(
  min: number | null | undefined,
  max: number | null | undefined
): string {
  if (min != null && max != null) {
    if (min === max) {
      return `${min} ${min === 1 ? 'member' : 'members'}`;
    }
    return `${min}–${max} members`;
  }
  if (min != null && max == null) {
    return `At least ${min} ${min === 1 ? 'member' : 'members'}`;
  }
  if (min == null && max != null) {
    return `Up to ${max} ${max === 1 ? 'member' : 'members'}`;
  }
  return 'Not specified';
}

export function getTimeStateBadge(timeState: PublicEvent['time_state']): {
  label: string;
  className: string;
} {
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
