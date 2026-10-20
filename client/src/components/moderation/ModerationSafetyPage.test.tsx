import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ModerationSafetyPage } from './ModerationSafetyPage';
import * as moderationApi from './moderationApi';

vi.mock('./moderationApi', async () => {
  const actual = await vi.importActual<typeof import('./moderationApi')>('./moderationApi');
  return {
    ...actual,
    probeAdminModerationAccess: vi.fn(),
    fetchModerationCases: vi.fn(),
    fetchModerationCaseDetail: vi.fn(),
    createModerationCase: vi.fn(),
  };
});

const probeMock = vi.mocked(moderationApi.probeAdminModerationAccess);
const fetchCasesMock = vi.mocked(moderationApi.fetchModerationCases);
const fetchDetailMock = vi.mocked(moderationApi.fetchModerationCaseDetail);
const createMock = vi.mocked(moderationApi.createModerationCase);

const older = {
  id: '11111111-1111-4111-8111-111111111111',
  targetType: 'team' as const,
  targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  reason: 'Older spam',
  status: 'Open' as const,
  reportCount: 0,
  flaggedUrl: null,
  createdAt: '2026-10-18T10:00:00.000Z',
  createdBy: 'admin',
};

const newer = {
  id: '22222222-2222-4222-8222-222222222222',
  targetType: 'profile' as const,
  targetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  reason: 'Newer phishing',
  status: 'Open' as const,
  reportCount: 2,
  flaggedUrl: null,
  createdAt: '2026-10-18T12:00:00.000Z',
  createdBy: 'admin',
};

describe('ModerationSafetyPage (US-026 / #241)', () => {
  beforeEach(() => {
    probeMock.mockReset();
    fetchCasesMock.mockReset();
    fetchDetailMock.mockReset();
    createMock.mockReset();
  });

  it('shows access denied for non-ADMIN callers', async () => {
    probeMock.mockResolvedValue('denied');
    render(<ModerationSafetyPage />);
    await waitFor(() => {
      expect(screen.getByTestId('moderation-access-denied')).toBeInTheDocument();
    });
    expect(fetchCasesMock).not.toHaveBeenCalled();
  });

  it('loads empty queue for ADMIN', async () => {
    probeMock.mockResolvedValue('granted');
    fetchCasesMock.mockResolvedValue([]);
    render(<ModerationSafetyPage />);
    await waitFor(() => {
      expect(screen.getByTestId('moderation-queue-empty')).toBeInTheDocument();
    });
  });

  it('lists cases newest first and opens case detail on select', async () => {
    probeMock.mockResolvedValue('granted');
    fetchCasesMock.mockResolvedValue([older, newer]);
    fetchDetailMock.mockResolvedValue({
      case: newer,
      target: {
        type: 'profile',
        profile: {
          participantId: newer.targetId,
          handle: 'ada',
          primaryRole: 'Frontend',
          institution: null,
          displayName: 'Ada',
          skills: ['React'],
          portfolios: [],
        },
      },
    });

    render(<ModerationSafetyPage />);

    await waitFor(() => {
      expect(screen.getByTestId('moderation-queue-list')).toBeInTheDocument();
    });

    const rows = screen.getAllByTestId(/moderation-case-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', `moderation-case-row-${newer.id}`);

    fireEvent.click(screen.getByTestId(`moderation-case-row-${newer.id}`));

    await waitFor(() => {
      expect(screen.getByTestId('moderation-case-detail')).toBeInTheDocument();
    });
    expect(screen.getByTestId('moderation-case-reason')).toHaveTextContent('Newer phishing');
    expect(screen.getByTestId('moderation-target-profile')).toHaveTextContent('ada');
  });

  it('shows queue load failure on first fetch error', async () => {
    probeMock.mockResolvedValue('granted');
    fetchCasesMock.mockRejectedValue(
      new moderationApi.ModerationApiError(500, 'SERVER', undefined, undefined, 'Server down')
    );
    render(<ModerationSafetyPage />);
    await waitFor(() => {
      expect(screen.getByTestId('moderation-queue-error')).toHaveTextContent(/Server down/);
    });
  });

  it('opens a case successfully and selects it in the queue', async () => {
    probeMock.mockResolvedValue('granted');
    fetchCasesMock.mockResolvedValue([]);
    const created = {
      ...newer,
      reason: 'Suspicious pitch',
    };
    createMock.mockResolvedValue(created);
    fetchDetailMock.mockResolvedValue({
      case: created,
      target: {
        type: 'profile',
        profile: {
          participantId: created.targetId,
          handle: 'ada',
          primaryRole: null,
          institution: null,
          displayName: 'Ada',
          skills: [],
          portfolios: [],
        },
      },
    });

    render(<ModerationSafetyPage />);
    await waitFor(() => {
      expect(screen.getByTestId('open-moderation-case-form')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('moderation-target-type'), {
      target: { value: 'profile' },
    });
    fireEvent.change(screen.getByTestId('moderation-target-id'), {
      target: { value: created.targetId },
    });
    fireEvent.change(screen.getByTestId('moderation-reason'), {
      target: { value: 'Suspicious pitch' },
    });
    fireEvent.click(screen.getByTestId('open-case-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('open-case-success')).toHaveTextContent(/Case opened/i);
    });
    expect(createMock).toHaveBeenCalled();
    expect(screen.getByTestId(`moderation-case-row-${created.id}`)).toBeInTheDocument();
  });

  it('keeps form draft when create returns validation errors', async () => {
    probeMock.mockResolvedValue('granted');
    fetchCasesMock.mockResolvedValue([]);
    createMock.mockRejectedValue(
      new moderationApi.ModerationApiError(
        400,
        'VALIDATION_ERROR',
        { reason: 'reason is required.' },
        { targetType: 'team', targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', reason: 'kept' },
        'Validation failed.'
      )
    );

    render(<ModerationSafetyPage />);
    await waitFor(() => {
      expect(screen.getByTestId('open-moderation-case-form')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('moderation-target-id'), {
      target: { value: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    });
    fireEvent.change(screen.getByTestId('moderation-reason'), {
      target: { value: 'kept draft reason' },
    });
    fireEvent.click(screen.getByTestId('open-case-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('open-case-form-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('moderation-reason')).toHaveValue('kept draft reason');
    expect(screen.getByTestId('moderation-target-id')).toHaveValue(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    );
  });
});
