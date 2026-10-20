import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApplicationForm } from './ApplicationForm';
import { ApplicationFormPanel } from './ApplicationFormPanel';
import * as applicationsApi from './applicationsApi';
import type { OpenTeamApplyTarget } from './openTeamsApi';

vi.mock('./applicationsApi', async () => {
  const actual = await vi.importActual<typeof import('./applicationsApi')>('./applicationsApi');
  return {
    ...actual,
    submitTeamApplication: vi.fn(),
  };
});

const submitMock = vi.mocked(applicationsApi.submitTeamApplication);

const target: OpenTeamApplyTarget = {
  teamId: '44444444-4444-4444-8444-444444444444',
  vacancyId: '66666666-6666-4666-8666-666666666666',
  role: 'Frontend',
  teamName: 'HackMatch Innovators',
};

describe('ApplicationForm (US-018 / #171)', () => {
  it('shows empty state when no apply target is selected', () => {
    render(
      <ApplicationForm
        target={null}
        message=""
        fieldErrors={{}}
        submitError={null}
        successNotice={null}
        submitting={false}
        onMessageChange={() => {}}
        onSubmit={(e) => e.preventDefault()}
        onCancel={() => {}}
      />
    );

    expect(screen.getByTestId('application-form-empty')).toHaveTextContent(/Select an open vacancy/i);
  });

  it('renders team/slot context and character counter for optional message', () => {
    render(
      <ApplicationForm
        target={target}
        message="Hello"
        fieldErrors={{}}
        submitError={null}
        successNotice={null}
        submitting={false}
        onMessageChange={() => {}}
        onSubmit={(e) => e.preventDefault()}
        onCancel={() => {}}
      />
    );

    expect(screen.getByTestId('application-form-team')).toHaveTextContent(/HackMatch Innovators/i);
    expect(screen.getByTestId('application-form-slot')).toHaveTextContent(/Frontend/i);
    expect(screen.getByTestId('application-message-count')).toHaveTextContent(/5 \/ 250/i);
  });

  it('shows FR-054 per-event pending quota hint (#174)', () => {
    render(
      <ApplicationForm
        target={target}
        message=""
        fieldErrors={{}}
        submitError={null}
        successNotice={null}
        submitting={false}
        onMessageChange={() => {}}
        onSubmit={(e) => e.preventDefault()}
        onCancel={() => {}}
      />
    );

    expect(screen.getByTestId('application-form-quota-hint')).toHaveTextContent(
      /at most 3 pending applications per event/i
    );
    expect(screen.getByTestId('application-form-quota-hint')).toHaveTextContent(
      /other events have separate limits/i
    );
  });
});

describe('ApplicationFormPanel (US-018 / #171)', () => {
  beforeEach(() => {
    submitMock.mockReset();
  });

  it('rejects messages longer than 250 characters and keeps the draft (NR-017)', async () => {
    const long = 'a'.repeat(251);
    render(<ApplicationFormPanel target={target} onClose={() => {}} />);

    fireEvent.change(screen.getByTestId('application-message-input'), {
      target: { value: long },
    });
    fireEvent.click(screen.getByTestId('submit-application'));

    expect(await screen.findByTestId('application-message-error')).toHaveTextContent(/250/i);
    expect(screen.getByTestId('application-message-input')).toHaveValue(long);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('submits successfully and shows Pending Review success notice', async () => {
    submitMock.mockResolvedValue({
      id: 'app-1',
      teamId: target.teamId,
      eventId: 'e1',
      vacancyId: target.vacancyId,
      applicantParticipantId: 'p1',
      status: 'Pending',
      requestType: 'Application',
      message: 'Ready to help',
      createdAt: '2026-10-19T12:00:00.000Z',
      teamName: target.teamName,
      vacancyRole: 'Frontend',
      notice: 'Pending Review application created. The team owner has been notified.',
    });

    const onSuccess = vi.fn();
    render(<ApplicationFormPanel target={target} onClose={() => {}} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByTestId('application-message-input'), {
      target: { value: 'Ready to help' },
    });
    fireEvent.click(screen.getByTestId('submit-application'));

    await waitFor(() => {
      expect(screen.getByTestId('application-form-success')).toHaveTextContent(/Pending Review/i);
    });
    expect(submitMock).toHaveBeenCalledWith(target.teamId, {
      vacancyId: target.vacancyId,
      message: 'Ready to help',
    });
    expect(onSuccess).toHaveBeenCalled();
    expect(screen.getByTestId('application-message-input')).toHaveValue('');
  });

  it('keeps message draft when API returns APPLICATION_PENDING_LIMIT (#174 / NR-017)', async () => {
    submitMock.mockRejectedValue(
      new applicationsApi.ApplicationsApiError(
        409,
        'APPLICATION_PENDING_LIMIT',
        { message: undefined },
        undefined,
        'You already have 3 pending applications for this event.'
      )
    );

    render(<ApplicationFormPanel target={target} onClose={() => {}} />);

    fireEvent.change(screen.getByTestId('application-message-input'), {
      target: { value: 'Still interested' },
    });
    fireEvent.click(screen.getByTestId('submit-application'));

    await waitFor(() => {
      expect(screen.getByTestId('application-form-error')).toHaveTextContent(
        /3 pending applications/i
      );
    });
    expect(screen.getByText(/message was kept/i)).toBeInTheDocument();
    expect(screen.getByTestId('application-message-input')).toHaveValue('Still interested');
  });

  it('shows loading label while submitting', async () => {
    let resolveSubmit: ((value: applicationsApi.SubmittedApplication) => void) | undefined;
    submitMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        })
    );

    render(<ApplicationFormPanel target={target} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('submit-application'));

    expect(await screen.findByTestId('submit-application')).toHaveTextContent(/Submitting/i);

    resolveSubmit?.({
      id: 'app-2',
      teamId: target.teamId,
      eventId: 'e1',
      vacancyId: target.vacancyId,
      applicantParticipantId: 'p1',
      status: 'Pending',
      requestType: 'Application',
      message: null,
      createdAt: '2026-10-19T12:00:00.000Z',
      teamName: target.teamName,
      vacancyRole: 'Frontend',
      notice: 'Pending Review application created.',
    });

    await waitFor(() => {
      expect(screen.getByTestId('application-form-success')).toBeInTheDocument();
    });
  });
});
