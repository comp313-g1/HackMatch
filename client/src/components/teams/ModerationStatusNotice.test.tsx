import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModerationStatusNotice } from './ModerationStatusNotice';

describe('ModerationStatusNotice (US-026 / #244)', () => {
  it('renders nothing when status is None and no link notice', () => {
    const { container } = render(<ModerationStatusNotice moderationStatus="None" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows hidden listing copy and membership preservation (success path)', () => {
    render(
      <ModerationStatusNotice
        moderationStatus="Hidden"
        moderationHiddenAt="2026-10-19T12:00:00.000Z"
      />
    );
    expect(screen.getByTestId('moderation-status-hidden')).toHaveTextContent(
      /excluded from ordinary discovery/i
    );
    expect(screen.getByTestId('moderation-status-hidden')).toHaveTextContent(
      /memberships are preserved/i
    );
  });

  it('shows warning status for Warned listings', () => {
    render(<ModerationStatusNotice moderationStatus="Warned" />);
    expect(screen.getByTestId('moderation-status-warned')).toHaveTextContent(/moderation warning/i);
  });

  it('surfaces link removal notice when present without Hidden status', () => {
    render(
      <ModerationStatusNotice
        moderationStatus="None"
        linkRemovalNotice="A communication link was removed by moderation."
      />
    );
    expect(screen.getByTestId('moderation-link-removal-on-team')).toHaveTextContent(
      /removed by moderation/i
    );
  });
});
