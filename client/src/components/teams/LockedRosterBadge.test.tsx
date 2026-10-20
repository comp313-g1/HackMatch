import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LockedRosterBadge } from './LockedRosterBadge';

describe('LockedRosterBadge (US-022 / #211)', () => {
  it('renders compact Locked badge without timestamp (boundary)', () => {
    render(<LockedRosterBadge />);
    expect(screen.getByTestId('locked-roster-badge')).toHaveTextContent(/^Locked$/);
    expect(screen.queryByTestId('locked-roster-badge-time')).not.toBeInTheDocument();
  });

  it('includes lock timestamp on badge when lockedAt is set (happy path)', () => {
    render(<LockedRosterBadge lockedAt="2026-10-20T15:30:00.000Z" />);
    expect(screen.getByTestId('locked-roster-badge')).toHaveTextContent(/Locked/);
    expect(screen.getByTestId('locked-roster-badge-time')).toHaveTextContent(/·/);
  });

  it('renders expanded status note with freeze copy and timestamp (happy path)', () => {
    render(<LockedRosterBadge lockedAt="2026-10-20T15:30:00.000Z" variant="note" />);
    expect(screen.getByTestId('locked-roster-status-note')).toHaveTextContent(/roster locked/i);
    expect(screen.getByTestId('locked-roster-status-note')).toHaveTextContent(/leaving/i);
    expect(screen.getByTestId('locked-roster-locked-at')).toHaveTextContent(/locked at/i);
  });
});
