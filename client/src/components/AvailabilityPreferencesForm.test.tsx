import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AvailabilityPreferencesForm } from './AvailabilityPreferencesForm';
import { AvailabilityApiError } from '../services/availabilityApi';

const authFetchMock = vi.fn();

vi.mock('../config/authFetch', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

describe('AvailabilityPreferencesForm (combined Looking for Team card)', () => {
  beforeEach(() => {
    authFetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (String(url).includes('/api/profiles/me') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            profile: {
              handle: 'casey-demo',
              primaryRole: 'AI/ML',
              institution: 'HackMatch Demo Institute',
              skills: ['Python', 'TensorFlow'],
              portfolioLinks: [
                { url: 'https://example.com/ml', label: 'Self-declared machine-learning portfolio' },
              ],
              sharedContactHandle: null,
            },
          }),
        };
      }
      if (String(url).includes('/api/profiles/me') && init?.method === 'PUT') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ profile: {} }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
  });

  it('shows profile and availability fields in one form', async () => {
    render(<AvailabilityPreferencesForm />);

    await waitFor(() => {
      expect(screen.getByText('Looking for Team Card')).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/Display Handle/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Academic Institution/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Skills \(comma-separated\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Portfolio Links \(HTTPS\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Looking for Team \(LFT\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Weekly Commitment Hours/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Project Goal/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Save Looking for Team Card/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save Technical Profile/i })).not.toBeInTheDocument();
  });

  it('requires card profile fields when enabling Looking for Team', async () => {
    authFetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (String(url).includes('/api/profiles/me') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            profile: {
              handle: '',
              primaryRole: null,
              institution: '',
              skills: [],
              portfolioLinks: [],
              sharedContactHandle: null,
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const onSave = vi.fn();
    render(<AvailabilityPreferencesForm onSave={onSave} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Looking for Team \(LFT\)/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/Looking for Team \(LFT\)/i));
    fireEvent.change(screen.getByLabelText(/Desired Role/i), { target: { value: 'Backend' } });
    fireEvent.change(screen.getByLabelText(/Weekly Commitment Hours/i), {
      target: { value: '13' },
    });
    fireEvent.change(screen.getByLabelText(/Project Goal/i), {
      target: { value: 'Project Completion' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Looking for Team Card/i }));

    await waitFor(() => {
      expect(screen.getByText(/Handle is required/i)).toBeInTheDocument();
      expect(screen.getByText(/Academic institution is required/i)).toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves profile then availability with one submit', async () => {
    const onSave = vi.fn().mockResolvedValue({
      participantId: 'p1',
      isLooking: true,
      desiredRole: 'AI/ML',
      commitmentHours: 12,
      goal: 'Learning',
      updatedAt: '2026-10-22T00:00:00.000Z',
    });

    render(<AvailabilityPreferencesForm onSave={onSave} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('casey-demo')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/Looking for Team \(LFT\)/i));
    fireEvent.change(screen.getByLabelText(/Desired Role/i), { target: { value: 'AI/ML' } });
    fireEvent.change(screen.getByLabelText(/Weekly Commitment Hours/i), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByLabelText(/Project Goal/i), { target: { value: 'Learning' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Looking for Team Card/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        isLooking: true,
        desiredRole: 'AI/ML',
        commitmentHours: 12,
        goal: 'Learning',
      });
      expect(screen.getByRole('status')).toHaveTextContent(
        /Looking for Team card and availability were saved/i
      );
    });

    const putCall = authFetchMock.mock.calls.find(
      (call) => String(call[0]).includes('/api/profiles/me') && call[1]?.method === 'PUT'
    );
    expect(putCall).toBeDefined();
  });

  it('shows availability API field errors after a failed enable', async () => {
    const onSave = vi.fn().mockRejectedValue(
      new AvailabilityApiError(
        400,
        'VALIDATION_ERROR',
        {
          skills: 'Add at least one skill on your Profile before enabling Looking for Team.',
        },
        'Complete your Profile before enabling Looking for Team.'
      )
    );

    render(<AvailabilityPreferencesForm onSave={onSave} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('casey-demo')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/Looking for Team \(LFT\)/i));
    fireEvent.change(screen.getByLabelText(/Desired Role/i), { target: { value: 'AI/ML' } });
    fireEvent.change(screen.getByLabelText(/Weekly Commitment Hours/i), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByLabelText(/Project Goal/i), { target: { value: 'Learning' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Looking for Team Card/i }));

    await waitFor(() => {
      expect(screen.getByText(/Add at least one skill/i)).toBeInTheDocument();
    });
  });
});
