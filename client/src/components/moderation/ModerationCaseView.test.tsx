import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModerationCaseView } from './ModerationCaseView';
import type { ModerationCaseDetail } from './moderationTypes';

const detail: ModerationCaseDetail = {
  case: {
    id: '11111111-1111-4111-8111-111111111111',
    targetType: 'team',
    targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    reason: 'Suspicious link',
    status: 'Open',
    reportCount: 1,
    flaggedUrl: null,
    createdAt: '2026-10-18T10:00:00.000Z',
    createdBy: 'admin',
  },
  target: {
    type: 'team',
    team: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      name: 'Phishy Team',
      pitch: 'Join via this link',
      goal: 'Learning',
      commitmentHours: 10,
      communicationLink: 'https://evil.example/phish',
      recruitmentStatus: 'Open',
      eventId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      ownerHandle: 'ada',
      ownerDisplayName: 'Ada Lovelace',
    },
  },
};

describe('ModerationCaseView (US-026 / #241)', () => {
  it('shows idle prompt before a case is selected', () => {
    render(
      <ModerationCaseView
        detail={null}
        detailState="idle"
        detailError={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-case-idle')).toHaveTextContent(/Select a case/i);
  });

  it('shows loading state', () => {
    render(
      <ModerationCaseView
        detail={null}
        detailState="loading"
        detailError={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-case-loading')).toBeInTheDocument();
  });

  it('shows error state with message', () => {
    render(
      <ModerationCaseView
        detail={null}
        detailState="error"
        detailError="Case not found"
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-case-error')).toHaveTextContent(/Case not found/);
  });

  it('renders case reason, time, reports, and sanitized team target on success', () => {
    render(
      <ModerationCaseView
        detail={detail}
        detailState="success"
        detailError={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-case-detail')).toBeInTheDocument();
    expect(screen.getByTestId('moderation-case-reason')).toHaveTextContent('Suspicious link');
    expect(screen.getByTestId('moderation-case-report-count')).toHaveTextContent('1');
    expect(screen.getByTestId('moderation-target-team')).toHaveTextContent('Phishy Team');
    expect(screen.getByText('https://evil.example/phish')).toBeInTheDocument();
    expect(screen.queryByText(/@|firebase|secret/i)).not.toBeInTheDocument();
  });

  it('shows privacy notice that credentials and private workspace are not granted (#245)', () => {
    render(
      <ModerationCaseView
        detail={{
          ...detail,
          privacy: {
            credentialsIncluded: false,
            privateContactsIncluded: false,
            privateWorkspaceAccessGranted: false,
            notice:
              'Credentials, private contact handles, and private workspace content are not available through moderation cases.',
          },
        }}
        detailState="success"
        detailError={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-privacy-notice')).toHaveTextContent(
      /private workspace content are not available/i
    );
    expect(screen.getByTestId('moderation-privacy-notice')).toHaveTextContent(
      /credentials|private contact/i
    );
  });

  it('renders only privacy-safe chat-message evidence with an explicit UTC timestamp', () => {
    const chatDetail = {
      case: {
        ...detail.case,
        targetType: 'chat_message' as const,
        targetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      },
      target: {
        type: 'chat_message' as const,
        chatMessage: {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          availability: 'Available' as const,
          authorHandle: 'safe-handle',
          createdAt: '2026-11-10T15:30:00.000Z',
          messageContext: {
            text: 'Scoped evidence with [redacted email]',
            redacted: true,
            truncated: false,
          },
          email: 'private@example.test',
          token: 'secret-token',
          unrelatedMessages: ['private conversation'],
        },
      },
    } as unknown as ModerationCaseDetail;

    render(
      <ModerationCaseView
        detail={chatDetail}
        detailState="success"
        detailError={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByTestId('moderation-target-chat-message')).toHaveTextContent('safe-handle');
    expect(screen.getByTestId('moderation-target-chat-message')).toHaveTextContent(
      '2026-11-10T15:30:00.000Z'
    );
    expect(screen.getByText('Scoped evidence with [redacted email]')).toBeInTheDocument();
    expect(screen.getByTestId('moderation-chat-content-limited')).toHaveTextContent(/redacted/i);
    expect(screen.queryByText('private@example.test')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-token')).not.toBeInTheDocument();
    expect(screen.queryByText('private conversation')).not.toBeInTheDocument();
  });

  it('renders privacy-safe chat-channel context', () => {
    render(
      <ModerationCaseView
        detail={{
          case: {
            ...detail.case,
            targetType: 'chat_channel',
          },
          target: {
            type: 'chat_channel',
            chatChannel: {
              id: detail.case.targetId,
              availability: 'Available',
              channelType: 'team',
              title: 'Civic Signal private channel',
              description: 'Team coordination channel',
              creatorHandle: 'avery',
              createdAt: '2026-11-10T14:00:00.000Z',
              contentRedacted: false,
            },
          },
        }}
        detailState="success"
        detailError={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByTestId('moderation-target-chat-channel')).toHaveTextContent(
      'Civic Signal private channel'
    );
    expect(screen.getByTestId('moderation-target-chat-channel')).toHaveTextContent(
      'Private team channel'
    );
    expect(screen.getByTestId('moderation-target-chat-channel')).toHaveTextContent('avery');
  });

  it('keeps the moderation case usable when its chat target is stale', () => {
    render(
      <ModerationCaseView
        detail={{
          case: {
            ...detail.case,
            targetType: 'chat_message',
          },
          target: {
            type: 'chat_message',
            chatMessage: {
              id: detail.case.targetId,
              availability: 'Unavailable',
            },
          },
        }}
        detailState="success"
        detailError={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByTestId('moderation-case-detail')).toBeInTheDocument();
    expect(screen.getByTestId('moderation-chat-target-unavailable')).toHaveTextContent(
      /message unavailable/i
    );
  });
});
