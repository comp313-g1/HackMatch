import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { PublicEvent } from './eventTypes.js';
import {
  type EventFilters,
  EMPTY_FILTERS,
  hasActiveFilters,
} from './eventFilters.js';
import { fetchPublicEvents } from './eventApi.js';
import { EventFilterBar } from './EventFilterBar.js';
import { EventCard } from './EventCard.js';
import { EventDetail } from './EventDetail.js';

export function EventDirectory(): React.JSX.Element {
  const [filters, setFilters] = useState<EventFilters>(EMPTY_FILTERS);
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const loadEvents = useCallback(async (activeFilters: EventFilters) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStatus('loading');
    setErrorMessage(null);

    try {
      const data = await fetchPublicEvents(activeFilters, controller.signal);
      setEvents(data.events);
      setTotal(data.total);
      setStatus('ready');
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to load events at this time.'
      );
    }
  }, []);

  // Effect to trigger loadEvents when filters change (debouncing keyword by 300ms)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      loadEvents(filters);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [filters, loadEvents]);

  // Clean up any pending aborts on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleFilterChange = (next: EventFilters) => {
    setFilters(next);
  };

  const handleClearFilters = () => {
    setFilters(EMPTY_FILTERS);
  };

  const handleRetry = () => {
    loadEvents(filters);
  };

  const handleSelectEvent = (id: string) => {
    setSelectedEventId(id);
  };

  const handleBackToList = () => {
    setSelectedEventId(null);
  };

  if (selectedEventId) {
    return <EventDetail eventId={selectedEventId} onBack={handleBackToList} />;
  }

  const isFiltered = hasActiveFilters(filters);

  return (
    <div className="space-y-6">
      <div className="border-b border-cream-200 pb-4">
        <h2 className="font-display text-2xl font-bold text-forest-900 tracking-tight">
          Explore Hackathons
        </h2>
        <p className="text-sm text-ink-muted mt-1">
          Discover verified hackathon competitions, filter by format and timing, and find teams.
        </p>
      </div>

      {/* Filter Controls */}
      <EventFilterBar
        values={filters}
        onChange={handleFilterChange}
        onClear={handleClearFilters}
        disabled={status === 'loading'}
      />

      {/* Status Announcement for Screen Readers */}
      <div role="status" aria-live="polite" className="text-xs text-ink-muted min-h-[1.25rem]">
        {status === 'loading' && 'Loading hackathons...'}
        {status === 'ready' &&
          `${total} hackathon${total === 1 ? '' : 's'} found`}
      </div>

      {/* Error State */}
      {status === 'error' && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 space-y-3"
        >
          <p className="text-sm font-medium">{errorMessage}</p>
          <button
            type="button"
            onClick={handleRetry}
            className="text-xs font-semibold px-3 py-1.5 bg-red-800 text-white rounded hover:bg-red-900 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Event Cards List */}
      {status === 'ready' && events.length > 0 && (
        <ul
          aria-label="Hackathons list"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {events.map((evt) => (
            <EventCard key={evt.id} event={evt} onSelect={handleSelectEvent} />
          ))}
        </ul>
      )}

      {/* Empty State */}
      {status === 'ready' && events.length === 0 && (
        <div className="bg-white border border-cream-200 rounded-lg p-8 text-center space-y-3">
          <p className="text-base font-medium text-forest-900">
            {isFiltered
              ? 'No hackathons match your filters.'
              : 'No upcoming hackathons yet.'}
          </p>
          <p className="text-sm text-ink-muted max-w-md mx-auto">
            {isFiltered
              ? 'Try widening your search terms, changing the format, or resetting active filters.'
              : 'Check back soon as verified events are published by the community and organizers.'}
          </p>
          {isFiltered && (
            <div className="pt-2">
              <button
                type="button"
                onClick={handleClearFilters}
                className="text-xs font-semibold px-4 py-2 bg-forest text-white rounded-md hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 transition"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
