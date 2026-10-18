import React, { useId, useMemo, useState } from 'react';
import {
  VERIFIED_EVENTS,
  type EventFormat,
  type EventTime,
} from './landingData';

export interface LandingPageProps {
  onNavigateToRegister: () => void;
  onNavigateToLogin: () => void;
  onNavigateToTeams?: () => void;
  onNavigateToProfile?: () => void;
  onSelectEvent?: (eventId: string) => void;
  currentUser?: {
    email?: string | null;
    displayName?: string | null;
  } | null;
}

export function LandingPage({
  onNavigateToRegister,
  onNavigateToLogin,
  onNavigateToTeams,
  onNavigateToProfile,
  onSelectEvent,
  currentUser = null,
}: LandingPageProps): React.JSX.Element {
  const searchInputId = useId();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<EventFormat>('all');
  const [selectedTime, setSelectedTime] = useState<EventTime>('all');

  const filteredEvents = useMemo(() => {
    return VERIFIED_EVENTS.filter((event) => {
      if (selectedFormat !== 'all' && event.format !== selectedFormat) {
        return false;
      }
      if (selectedTime !== 'all' && event.time !== selectedTime) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = event.name.toLowerCase().includes(query);
        const matchesLocation = event.location.toLowerCase().includes(query);
        const matchesCountry = event.country.toLowerCase().includes(query);
        const matchesTag = event.tags.some((t) => t.toLowerCase().includes(query));
        if (!matchesName && !matchesLocation && !matchesCountry && !matchesTag) {
          return false;
        }
      }
      return true;
    });
  }, [searchQuery, selectedFormat, selectedTime]);

  const handleFormatToggle = (format: EventFormat) => {
    setSelectedFormat((prev) => (prev === format ? 'all' : format));
  };

  const handleTimeToggle = (time: EventTime) => {
    setSelectedTime((prev) => (prev === time ? 'all' : time));
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedFormat('all');
    setSelectedTime('all');
  };

  const scrollToEvents = () => {
    const el = document.getElementById('events-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
      const searchInput = document.getElementById(searchInputId);
      searchInput?.focus();
    }
  };

  return (
    <div className="space-y-16 sm:space-y-20 pb-16">
      {/* Hero Section */}
      <section
        aria-label="HackMatch hero"
        className="relative -mx-4 sm:-mx-6 lg:-mx-8 -mt-10 md:-mt-14 px-4 sm:px-6 lg:px-8 py-16 sm:py-24 bg-gradient-to-b from-cream-100 via-cream-50 to-cream border-b border-cream-200 overflow-hidden"
      >
        <div className="max-w-6xl mx-auto flex flex-col justify-center">
          <p className="font-sans text-xs sm:text-sm font-semibold uppercase tracking-[0.18em] text-forest-700">
            Pre-hackathon team formation
          </p>
          <h1 className="mt-3 font-display font-semibold uppercase leading-[1.04] text-balance text-forest-900 text-3xl sm:text-5xl lg:text-6xl tracking-tight">
            Find your hackathon team
          </h1>
          <p className="mt-4 max-w-2xl font-sans text-base sm:text-lg text-ink-muted leading-relaxed">
            Browse verified hackathons, join a team or build your own, then lock your roster.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              type="button"
              onClick={scrollToEvents}
              className="inline-flex items-center justify-center rounded-md bg-forest px-6 py-3 font-sans text-sm font-semibold text-white shadow-sm hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream transition"
            >
              Browse Events
            </button>
            {currentUser ? (
              <>
                <button
                  type="button"
                  onClick={onNavigateToTeams}
                  className="inline-flex items-center justify-center rounded-md border border-forest px-6 py-3 font-sans text-sm font-semibold text-forest bg-transparent hover:bg-forest-50 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream transition"
                >
                  Teams Workspace
                </button>
                <button
                  type="button"
                  onClick={onNavigateToProfile}
                  className="inline-flex items-center justify-center rounded-md border border-cream-300 px-6 py-3 font-sans text-sm font-medium text-ink bg-white hover:bg-cream-100 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream transition"
                >
                  Your Profile
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onNavigateToRegister}
                className="inline-flex items-center justify-center rounded-md border border-forest px-6 py-3 font-sans text-sm font-semibold text-forest bg-transparent hover:bg-forest-50 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream transition"
              >
                Create account
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Search and Filters Floating Card */}
      <section
        id="events-section"
        aria-labelledby="events-search-heading"
        className="max-w-6xl mx-auto px-4 sm:px-6 -mt-12 sm:-mt-16 relative z-10"
      >
        <h2 id="events-search-heading" className="sr-only">
          Search and filter verified hackathons
        </h2>

        <div className="rounded-xl border border-cream-200 bg-white p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <label htmlFor={searchInputId} className="sr-only">
              Search hackathons
            </label>
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <input
                id={searchInputId}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, location, or edition"
                className="w-full rounded-md border border-cream-200 bg-cream-50 py-2.5 pl-10 pr-3 font-sans text-sm text-ink placeholder:text-ink-muted focus:bg-white focus:outline-none focus:ring-2 focus:ring-forest"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                // Keep focus on search input or scroll to results
                const searchEl = document.getElementById(searchInputId);
                searchEl?.focus();
              }}
              className="rounded-md bg-forest px-5 py-2.5 font-sans text-sm font-semibold text-white hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest transition"
            >
              Search
            </button>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center gap-4 pt-2 border-t border-cream-100">
            {/* Format Chips */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-sans text-xs uppercase tracking-[0.1em] text-ink-muted font-semibold mr-1">
                Format
              </span>
              {(['Online', 'In-Person', 'Hybrid'] as const).map((fmt) => {
                const isActive = selectedFormat === fmt;
                return (
                  <button
                    key={fmt}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => handleFormatToggle(fmt)}
                    className={`shrink-0 rounded-full border px-3.5 py-1.5 font-sans text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-forest ${
                      isActive
                        ? 'border-forest bg-forest text-white'
                        : 'border-cream-200 bg-cream-50 text-ink hover:border-forest/50'
                    }`}
                  >
                    {fmt}
                  </button>
                );
              })}
            </div>

            {/* Time Chips */}
            <div className="flex flex-wrap items-center gap-2 lg:ml-4">
              <span className="font-sans text-xs uppercase tracking-[0.1em] text-ink-muted font-semibold mr-1">
                Time
              </span>
              {(['Upcoming', 'Ongoing', 'Concluded'] as const).map((time) => {
                const isActive = selectedTime === time;
                return (
                  <button
                    key={time}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => handleTimeToggle(time)}
                    className={`shrink-0 rounded-full border px-3.5 py-1.5 font-sans text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-forest ${
                      isActive
                        ? 'border-forest bg-forest text-white'
                        : 'border-cream-200 bg-cream-50 text-ink hover:border-forest/50'
                    }`}
                  >
                    {time}
                  </button>
                );
              })}
            </div>

            {(searchQuery || selectedFormat !== 'all' || selectedTime !== 'all') && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-xs text-forest-700 underline hover:text-forest-900 lg:ml-auto self-start lg:self-center"
              >
                Reset filters
              </button>
            )}
          </div>
        </div>

        {/* Live Filter Results Announcement */}
        <div role="status" aria-live="polite" className="sr-only">
          Showing {filteredEvents.length} events
        </div>

        {/* Filtered Events Directory List */}
        <div className="mt-6">
          {filteredEvents.length === 0 ? (
            <div
              role="status"
              className="rounded-lg border border-cream-200 bg-white p-8 text-center text-ink-muted"
            >
              <p className="font-medium text-ink">No events match your criteria</p>
              <p className="mt-1 text-sm">
                Try selecting different format or time filters, or clearing your search term.
              </p>
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-4 px-4 py-2 bg-cream-100 hover:bg-cream-200 text-forest-900 text-xs font-semibold rounded-md transition"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded-lg border border-cream-200 bg-white p-5 flex flex-col justify-between shadow-sm hover:border-forest-200 transition"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-forest-50 text-forest-800 border border-forest-100">
                        {event.format}
                      </span>
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                          event.time === 'Upcoming'
                            ? 'bg-blue-50 text-blue-800 border border-blue-100'
                            : event.time === 'Ongoing'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-100'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {event.time}
                      </span>
                    </div>

                    <h3 className="font-display font-semibold text-lg text-forest-900">
                      {event.name}
                    </h3>
                    <p className="text-xs text-ink-muted">
                      📍 {event.location} • 📅 {event.dates}
                    </p>

                    <div className="flex flex-wrap gap-1 pt-1">
                      {event.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded bg-cream-100 text-ink text-[10px] font-medium"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-cream-100 flex items-center justify-between">
                    <span className="text-xs font-medium text-forest-800">
                      {event.openTeams > 0
                        ? `${event.openTeams} open team${event.openTeams > 1 ? 's' : ''}`
                        : 'Roster forming'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (currentUser && onSelectEvent) {
                          onSelectEvent(event.id);
                        } else if (currentUser && onNavigateToTeams) {
                          onNavigateToTeams();
                        } else {
                          onNavigateToRegister();
                        }
                      }}
                      className="px-3 py-1.5 bg-forest text-white text-xs font-semibold rounded hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest transition"
                    >
                      {currentUser ? 'View / Build Team' : 'Join / Build Team'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Metrics Section */}
      <section aria-labelledby="metrics-heading" className="max-w-6xl mx-auto px-4 sm:px-6">
        <h2 id="metrics-heading" className="sr-only">
          Platform statistics
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-cream-200 bg-white p-6 text-center shadow-sm">
            <p className="font-display text-4xl text-forest font-bold" aria-live="polite">
              6
            </p>
            <p className="mt-2 font-sans text-xs uppercase tracking-[0.08em] text-ink-muted font-semibold">
              Verified events
            </p>
          </div>
          <div className="rounded-lg border border-cream-200 bg-white p-6 text-center shadow-sm">
            <p className="font-display text-4xl text-forest font-bold" aria-live="polite">
              3
            </p>
            <p className="mt-2 font-sans text-xs uppercase tracking-[0.08em] text-ink-muted font-semibold">
              Open teams
            </p>
          </div>
          <div className="rounded-lg border border-cream-200 bg-white p-6 text-center shadow-sm">
            <p className="font-display text-4xl text-forest font-bold" aria-live="polite">
              6
            </p>
            <p className="mt-2 font-sans text-xs uppercase tracking-[0.08em] text-ink-muted font-semibold">
              Countries
            </p>
          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <section
        aria-labelledby="how-it-works-heading"
        className="max-w-6xl mx-auto px-4 sm:px-6"
      >
        <h2
          id="how-it-works-heading"
          className="font-display text-2xl sm:text-3xl font-semibold text-forest-900 tracking-tight"
        >
          How it works
        </h2>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-cream-200 bg-white p-6 shadow-sm flex flex-col justify-between">
            <div>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-forest-600 bg-forest-50 font-display text-base font-semibold text-forest-800">
                1
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold text-forest-900">
                Find an event
              </h3>
              <p className="mt-2 font-sans text-sm text-ink-muted leading-relaxed">
                Browse verified hackathons by format, location, and dates.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-cream-200 bg-white p-6 shadow-sm flex flex-col justify-between">
            <div>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-forest-600 bg-forest-50 font-display text-base font-semibold text-forest-800">
                2
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold text-forest-900">
                Join or build a team
              </h3>
              <p className="mt-2 font-sans text-sm text-ink-muted leading-relaxed">
                Apply to open slots, accept an invite, or create your own team.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-cream-200 bg-white p-6 shadow-sm flex flex-col justify-between">
            <div>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-forest-600 bg-forest-50 font-display text-base font-semibold text-forest-800">
                3
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold text-forest-900">
                Lock your roster
              </h3>
              <p className="mt-2 font-sans text-sm text-ink-muted leading-relaxed">
                Confirm your members and lock the roster before the hackathon.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Call To Action Banner */}
      <section
        aria-labelledby="cta-heading"
        className="max-w-6xl mx-auto px-4 sm:px-6"
      >
        <div className="rounded-2xl bg-forest-900 text-white p-8 sm:p-12 shadow-sm text-center space-y-6">
          <div className="max-w-2xl mx-auto space-y-3">
            <h2
              id="cta-heading"
              className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-cream-50"
            >
              {currentUser
                ? 'Ready to assemble your winning hackathon team?'
                : 'Ready to find your hackathon teammates?'}
            </h2>
            <p className="text-sm sm:text-base text-cream-200 leading-relaxed">
              {currentUser
                ? 'Manage active vacancies for your project, review incoming applications, and lock your roster before kickoff.'
                : 'Create your technical profile, publish vacancies, and assemble a complete roster before opening ceremonies.'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {currentUser ? (
              <>
                <button
                  type="button"
                  onClick={onNavigateToTeams}
                  className="w-full sm:w-auto px-6 py-3 bg-cream text-forest-900 text-sm font-semibold rounded-md shadow hover:bg-cream-100 focus:outline-none focus:ring-2 focus:ring-cream focus:ring-offset-2 focus:ring-offset-forest-900 transition"
                >
                  Go to Teams Workspace
                </button>
                <button
                  type="button"
                  onClick={onNavigateToProfile}
                  className="w-full sm:w-auto px-6 py-3 border border-cream-200 text-cream text-sm font-semibold rounded-md hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-cream focus:ring-offset-2 focus:ring-offset-forest-900 transition"
                >
                  Edit Technical Profile
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onNavigateToRegister}
                  className="w-full sm:w-auto px-6 py-3 bg-cream text-forest-900 text-sm font-semibold rounded-md shadow hover:bg-cream-100 focus:outline-none focus:ring-2 focus:ring-cream focus:ring-offset-2 focus:ring-offset-forest-900 transition"
                >
                  Create free account
                </button>
                <button
                  type="button"
                  onClick={onNavigateToLogin}
                  className="w-full sm:w-auto px-6 py-3 border border-cream-200 text-cream text-sm font-semibold rounded-md hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-cream focus:ring-offset-2 focus:ring-offset-forest-900 transition"
                >
                  Sign in to your account
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Floating Role Preview Badge from wireframe */}
      <div className="fixed bottom-4 left-4 z-40 print:hidden">
        <div className="relative">
          <div
            className="flex items-center gap-2 rounded-full border border-cream-200 bg-white/95 px-3 py-2 shadow-md backdrop-blur text-xs"
            aria-label="Role preview status"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-forest shrink-0"
              aria-hidden="true"
            >
              <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span className="text-ink-muted">
              Preview as{' '}
              <span className="font-semibold text-forest-900">
                {currentUser ? 'Participant' : 'Visitor'}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
