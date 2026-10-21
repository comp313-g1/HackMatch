import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubmissionReviewGate } from './SubmissionReviewGate';
import { SubmissionReviewPage } from './SubmissionReviewPage';
import {
  ReviewLoadError,
  recruitmentBlockReason,
  type ReviewLoader,
  type SubmissionReview,
} from './submissionReview';

const submissionId = '11111111-1111-4111-8111-111111111111';
const canonicalEventId = '22222222-2222-4222-8222-222222222222';

function approvedReview(): SubmissionReview {
  return {
    id: submissionId,
    status: 'Approved',
    adminFeedback: 'Official event rules verified.',
    canonicalEvent: {
      id: canonicalEventId,
      status: 'Published',
      endDate: '2099-01-01T00:00:00Z',
      minTeamSize: 1,
      maxTeamSize: 100,
    },
  };
}

const recruitmentActions = vi.fn((eventId: string) => (
  <div data-testid="recruitment-actions" data-event={eventId}>
    <button>Create team</button>
    <button>Declare availability</button>
    <button>Invite</button>
    <button>Apply</button>
  </div>
));

function show(loader: ReviewLoader): void {
  render(
    <SubmissionReviewGate
      submissionId={submissionId}
      loadReview={loader}
    >
      {recruitmentActions}
    </SubmissionReviewGate>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('US-009 frontend approval gate', () => {
  it('blocks all recruitment actions while loading', () => {
    show(() => new Promise(() => {}));

    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-busy',
      'true'
    );
    expect(recruitmentActions).not.toHaveBeenCalled();
  });

  it.each(['Pending', 'Rejected'] as const)(
    'blocks %s and displays ADMIN feedback',
    async status => {
      show(async () => ({
        ...approvedReview(),
        status,
        adminFeedback: 'Please check the official rules.',
      }));

      await screen.findByText('Please check the official rules.');

      expect(recruitmentActions).not.toHaveBeenCalled();
    }
  );

  it.each(['Approved', 'Merged'] as const)(
    'allows %s using the canonical event ID',
    async status => {
      show(async () => ({
        ...approvedReview(),
        status,
      }));

      expect(
        await screen.findByTestId('recruitment-actions')
      ).toHaveAttribute('data-event', canonicalEventId);

      expect(screen.getByRole('button', { name: 'Apply' })).toBeVisible();
    }
  );

  it('shows an empty state without recruitment actions', async () => {
    show(async () => null);

    await screen.findByText(/No visible submission was found/);

    expect(recruitmentActions).not.toHaveBeenCalled();
  });

  it('shows unauthorized feedback without leaking private details', async () => {
    show(async () => {
      throw new ReviewLoadError('unauthorized', 'Private server details');
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign in with permission'
    );
    expect(screen.queryByText('Private server details')).toBeNull();
    expect(recruitmentActions).not.toHaveBeenCalled();
  });

  it('retries an error and then shows approved actions', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(approvedReview());

    show(loader);

    await screen.findByRole('alert');

    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh review status' })
    );

    await screen.findByTestId('recruitment-actions');

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('removes approved actions while refreshing', async () => {
    let resolve!: (value: unknown) => void;

    const loader = vi.fn()
      .mockResolvedValueOnce(approvedReview())
      .mockImplementationOnce(
        () => new Promise(result => {
          resolve = result;
        })
      );

    show(loader);

    await screen.findByTestId('recruitment-actions');

    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh review status' })
    );

    expect(screen.queryByTestId('recruitment-actions')).toBeNull();

    await act(async () => {
      resolve({
        ...approvedReview(),
        status: 'Rejected',
      });
    });

    await screen.findByText('Rejected', { selector: 'h2' });

    expect(screen.queryByTestId('recruitment-actions')).toBeNull();
  });

  it('blocks an unknown status', async () => {
    show(async () => ({
      ...approvedReview(),
      status: 'UnexpectedStatus',
    }));

    await screen.findByRole('alert');

    expect(recruitmentActions).not.toHaveBeenCalled();
  });

  it('blocks approval without a canonical event', async () => {
    show(async () => ({
      ...approvedReview(),
      canonicalEvent: null,
    }));

    await screen.findByText(/canonical event is not available/);

    expect(recruitmentActions).not.toHaveBeenCalled();
  });

  it('blocks exactly at the event end time', () => {
    const review = approvedReview();

    expect(
      recruitmentBlockReason(
        review,
        Date.parse('2099-01-01T00:00:00Z')
      )
    ).toContain('ended');
  });

  it('blocks unresolved official limits', () => {
    const review = approvedReview();
    review.canonicalEvent!.maxTeamSize = null;

    expect(
      recruitmentBlockReason(review, Date.parse('2098-01-01'))
    ).toContain('unresolved');
  });

  it('preserves invalid form input and does not navigate', () => {
    const navigate = vi.fn();

    render(<SubmissionReviewPage onOpenEvent={navigate} />);

    fireEvent.change(screen.getByLabelText('Submission ID'), {
      target: { value: 'bad input' },
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Check review status' })
    );

    expect(screen.getByLabelText('Submission ID')).toHaveValue(
      'bad input'
    );
    expect(screen.getByLabelText('Submission ID')).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the production adapter explicitly unavailable', async () => {
    render(
      <SubmissionReviewGate submissionId={submissionId}>
        {recruitmentActions}
      </SubmissionReviewGate>
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'not connected yet'
    );
    expect(recruitmentActions).not.toHaveBeenCalled();
  });
});
