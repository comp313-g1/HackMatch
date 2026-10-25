import React from 'react';
import { MyApplicationsPanel } from './teams/MyApplicationsPanel';
import { MyInvitationsPanel } from './teams/MyInvitationsPanel';

export type RequestsTab = 'applications' | 'invitations';

export interface RequestsPageProps {
  activeTab: RequestsTab;
  onTabChange: (tab: RequestsTab) => void;
  onStatusNotice?: (notice: string | null) => void;
  onViewRoster?: (eventId: string) => void;
}

/**
 * Combined Applications + Invitations under one "Requests" destination (#358).
 */
export function RequestsPage({
  activeTab,
  onTabChange,
  onStatusNotice,
  onViewRoster,
}: RequestsPageProps): React.JSX.Element {
  const tabClass = (tab: RequestsTab) =>
    `px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 ${
      activeTab === tab
        ? 'bg-forest-50 text-forest-900 border-forest'
        : 'bg-white text-ink-muted border-cream-200 hover:text-forest-800'
    }`;

  return (
    <section aria-labelledby="requests-heading" className="space-y-6">
      <div>
        <h2 id="requests-heading" className="text-2xl font-bold text-forest-900">
          Requests
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Applications you sent and invitations you received, in one place.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Request types"
        className="flex flex-wrap gap-2"
      >
        <button
          type="button"
          role="tab"
          id="requests-tab-applications"
          aria-selected={activeTab === 'applications'}
          aria-controls="requests-panel-applications"
          className={tabClass('applications')}
          onClick={() => onTabChange('applications')}
        >
          Applications
        </button>
        <button
          type="button"
          role="tab"
          id="requests-tab-invitations"
          aria-selected={activeTab === 'invitations'}
          aria-controls="requests-panel-invitations"
          className={tabClass('invitations')}
          onClick={() => onTabChange('invitations')}
        >
          Invitations
        </button>
      </div>

      {activeTab === 'applications' ? (
        <div
          role="tabpanel"
          id="requests-panel-applications"
          aria-labelledby="requests-tab-applications"
        >
          <MyApplicationsPanel onStatusNotice={onStatusNotice} />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="requests-panel-invitations"
          aria-labelledby="requests-tab-invitations"
        >
          <MyInvitationsPanel
            onStatusNotice={onStatusNotice}
            onViewRoster={onViewRoster}
          />
        </div>
      )}
    </section>
  );
}
