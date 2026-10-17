import React, { useState, useEffect } from 'react';
import type { PublicEvent } from './eventTypes.js';
import { fetchPublicEventById } from './eventApi.js';
import { EventMetadata } from './EventMetadata.js';
import { SafeExternalLink } from './SafeExternalLink.js';

export interface EventDetailProps {
  eventId: string;
  onBack: () => void;
}

export function EventDetail({ eventId, onBack }: EventDetailProps): React.JSX.Element {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadEvent = async (id: string, signal?: AbortSignal) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchPublicEventById(id, signal);
      setEvent(data);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to load event details.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadEvent(eventId, controller.signal);
    return () => {
      controller.abort();
    };
  }, [eventId]);

  return (
    <article className="space-y-6">
      {/* Back button */}
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-forest-700 hover:text-forest-900 focus:outline-none focus:ring-2 focus:ring-forest rounded px-2 py-1 transition"
        >
          <span aria-hidden="true">←</span>
          <span>Back to all hackathons</span>
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div role="status" aria-live="polite" className="text-sm text-ink-muted">
          Loading event details...
        </div>
      )}

      {/* Error state */}
      {!loading && errorMessage && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-5 space-y-3"
        >
          <p className="text-sm font-medium">{errorMessage}</p>
          <button
            type="button"
            onClick={() => loadEvent(eventId)}
            className="text-xs font-semibold px-3 py-1.5 bg-red-800 text-white rounded hover:bg-red-900 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Details state */}
      {!loading && event && (
        <div className="bg-white border border-cream-200 rounded-xl p-6 sm:p-8 shadow-sm space-y-6">
          <EventMetadata event={event} />

          {/* Official Link Action */}
          <div className="pt-4 border-t border-cream-200 flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                Official Event Website
              </p>
              <div className="mt-1">
                <SafeExternalLink
                  url={event.official_url}
                  label="Visit Official Hackathon Website"
                />
              </div>
            </div>

            {event.time_state === 'concluded' && (
              <span className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded font-medium">
                Recruitment closed — this event has concluded.
              </span>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
