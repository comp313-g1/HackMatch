import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RequestsPage } from './RequestsPage';

vi.mock('./teams/MyApplicationsPanel', () => ({
  MyApplicationsPanel: () => <div>Applications panel</div>,
}));

vi.mock('./teams/MyInvitationsPanel', () => ({
  MyInvitationsPanel: () => <div>Invitations panel</div>,
}));

describe('RequestsPage (#358)', () => {
  it('switches between Applications and Invitations tabs', () => {
    const onTabChange = vi.fn();
    const { rerender } = render(
      <RequestsPage activeTab="applications" onTabChange={onTabChange} />
    );

    expect(screen.getByText('Applications panel')).toBeInTheDocument();
    expect(screen.queryByText('Invitations panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /^invitations$/i }));
    expect(onTabChange).toHaveBeenCalledWith('invitations');

    rerender(<RequestsPage activeTab="invitations" onTabChange={onTabChange} />);
    expect(screen.getByText('Invitations panel')).toBeInTheDocument();
  });
});
