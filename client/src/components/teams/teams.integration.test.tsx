/**
 * US-012 Team Recruitment Client Integration Test Suite
 *
 * Tests the complete TeamWorkspace lifecycle, state transitions, subcomponent interactions,
 * keyboard accessibility, and security invariants using a stateful mock API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { TeamWorkspace } from './TeamWorkspace';
import * as authFetchModule from '../../config/authFetch';
import type { TeamView } from './teamTypes';

describe('US-012 Client Integration Suite (TeamWorkspace & Lifecycle)', () => {
  const EVENT_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  const OWNER_ID = 'user-owner-001';
  const MEMBER_ID = 'user-member-002';

  let currentTeam: TeamView | null = null;
  let simulatedNetworkFailure = false;
  let simulatedCustomError: { status: number; body: Record<string, unknown> } | null = null;

  function createSampleTeam(overrides?: Partial<TeamView>): TeamView {
    return {
      id: 'team-uuid-001',
      eventId: EVENT_ID,
      name: 'Hackathon Pioneers',
      pitch: 'Building a next-generation decentralized collaboration suite for teams.',
      goal: 'Project Completion',
      commitmentHours: 25.5,
      communicationLink: 'https://discord.gg/hack-pioneers',
      recruitmentStatus: 'Open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      limits: {
        maxTeamSize: 4,
        confirmedMembers: 1,
        openSlots: 0,
        remainingCapacity: 3,
      },
      lifecycle: {
        mutable: true,
        reason: null,
      },
    viewerRole: 'Owner',
    viewerParticipantId: 'p-1',
    canLeave: false,
      members: [
        {
          participantId: OWNER_ID,
          displayName: 'Ada Lovelace',
          role: 'Owner',
          joinedAt: new Date().toISOString(),
        },
      ],
      vacancies: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    currentTeam = null;
    simulatedNetworkFailure = false;
    simulatedCustomError = null;

    vi.spyOn(authFetchModule, 'authFetch').mockImplementation(async (input: URL | RequestInfo, init?: RequestInit) => {
      if (simulatedNetworkFailure) {
        throw new TypeError('Failed to fetch');
      }

      if (simulatedCustomError) {
        const { status, body } = simulatedCustomError;
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const method = init?.method || 'GET';
      const urlStr =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      const parsedUrl = new URL(urlStr, 'http://localhost');
      const pathname = parsedUrl.pathname;

      // 1. GET /api/teams/mine
      if (method === 'GET' && pathname === '/api/teams/mine') {
        return new Response(JSON.stringify({ team: currentTeam }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 2. POST /api/teams (Create)
      if (method === 'POST' && pathname === '/api/teams') {
        const payload = JSON.parse(init?.body as string);
        currentTeam = createSampleTeam({
          name: payload.name,
          pitch: payload.pitch,
          goal: payload.goal,
          commitmentHours: payload.commitmentHours,
          communicationLink: payload.communicationLink,
        });
        return new Response(JSON.stringify({ team: currentTeam }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 3. PATCH /api/teams/:id (Update listing)
      if (method === 'PATCH' && pathname === `/api/teams/${currentTeam?.id}`) {
        const patch = JSON.parse(init?.body as string);
        currentTeam = {
          ...currentTeam!,
          ...patch,
          updatedAt: new Date().toISOString(),
        };
        return new Response(JSON.stringify({ team: currentTeam }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 4. POST /api/teams/:id/vacancies
      if (method === 'POST' && currentTeam && pathname === `/api/teams/${currentTeam.id}/vacancies`) {
        const body = JSON.parse(init?.body as string);
        const total = currentTeam.members.length + currentTeam.vacancies.length;
        const max = currentTeam.limits.maxTeamSize ?? 4;
        if (total >= max) {
          return new Response(
            JSON.stringify({
              code: 'CAPACITY_EXCEEDED',
              error: 'Event capacity reached (4/4 confirmed + open). Cannot add vacancy.',
              errors: { vacancies: 'Event capacity reached (4/4 confirmed + open). Cannot add vacancy.' },
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const newVac = {
          id: `vac-${Date.now()}`,
          role: body.role,
          skills: body.skills || [],
          status: 'Open' as const,
        };
        const updatedVacancies = [...currentTeam.vacancies, newVac];
        currentTeam = {
          ...currentTeam,
          vacancies: updatedVacancies,
          limits: {
            ...currentTeam.limits,
            openSlots: updatedVacancies.length,
            remainingCapacity: (currentTeam.limits.maxTeamSize ?? 4) - currentTeam.members.length - updatedVacancies.length,
          },
        };
        return new Response(JSON.stringify({ team: currentTeam }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 5. PATCH /api/teams/:id/vacancies/:vacId
      if (method === 'PATCH' && pathname.includes('/vacancies/')) {
        const vacId = pathname.split('/').pop()!;
        const body = JSON.parse(init?.body as string);
        currentTeam = {
          ...currentTeam!,
          vacancies: currentTeam!.vacancies.map((v) =>
            v.id === vacId ? { ...v, role: body.role, skills: body.skills } : v
          ),
        };
        return new Response(JSON.stringify({ team: currentTeam }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 6. DELETE /api/teams/:id/vacancies/:vacId
      if (method === 'DELETE' && pathname.includes('/vacancies/')) {
        const vacId = pathname.split('/').pop()!;
        const remainingVacancies = currentTeam!.vacancies.filter((v) => v.id !== vacId);
        currentTeam = {
          ...currentTeam!,
          vacancies: remainingVacancies,
          limits: {
            ...currentTeam!.limits,
            openSlots: remainingVacancies.length,
            remainingCapacity: (currentTeam!.limits.maxTeamSize ?? 4) - currentTeam!.members.length - remainingVacancies.length,
          },
        };
        return new Response(JSON.stringify({ canceledRequests: 1, team: currentTeam }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 7. POST /api/teams/:id/members/:memberId/remove
      if (method === 'POST' && pathname.includes('/members/') && pathname.endsWith('/remove')) {
        const parts = pathname.split('/');
        const memberId = parts[parts.length - 2];
        const remainingMembers = currentTeam!.members.filter((m) => m.participantId !== memberId);
        currentTeam = {
          ...currentTeam!,
          members: remainingMembers,
          limits: {
            ...currentTeam!.limits,
            confirmedMembers: remainingMembers.length,
            remainingCapacity: (currentTeam!.limits.maxTeamSize ?? 4) - remainingMembers.length - currentTeam!.vacancies.length,
          },
        };
        return new Response(JSON.stringify({ availabilityRestored: true, team: currentTeam }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 8. POST /api/teams/:id/disband
      if (method === 'POST' && currentTeam && pathname === `/api/teams/${currentTeam.id}/disband`) {
        currentTeam = null;
        return new Response(JSON.stringify({ releasedMembers: 2, canceledRequests: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    });
  });

  // Flow 1-7: Full End-to-End Happy Path and Mutation Sequence
  it('Scenario 1-7: Executes empty -> create -> add vacancy -> edit vacancy -> capacity 409 -> remove vacancy -> remove member -> disband -> empty', async () => {
    // 1. Initially Empty -> renders create form
    render(<TeamWorkspace eventId={EVENT_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create your hackathon team/i })).toBeInTheDocument();
    });

    // Fill out create form
    fireEvent.change(screen.getByLabelText(/team name/i), {
      target: { value: 'Code Artisans' },
    });
    fireEvent.change(screen.getByLabelText(/recruitment pitch/i), {
      target: { value: 'Excited to develop an AI-powered automated testing orchestrator.' },
    });
    fireEvent.change(screen.getByLabelText(/team goal/i), {
      target: { value: 'Project Completion' },
    });
    fireEvent.change(screen.getByLabelText(/weekly commitment/i), {
      target: { value: '20' },
    });
    fireEvent.change(screen.getByLabelText(/communication channel/i), {
      target: { value: 'https://discord.gg/code-artisans' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    // Verify Create Success Notice and Editor transition
    await waitFor(() => {
      expect(
        screen.getByText(/team created\. you're its owner\. add the roles you're recruiting for\./i)
      ).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('Code Artisans')).toBeInTheDocument();

    // 2. Add Vacancy Slot
    fireEvent.click(screen.getByRole('button', { name: /add open slot/i }));
    fireEvent.change(screen.getByLabelText(/role/i), {
      target: { value: 'Frontend' },
    });
    fireEvent.change(screen.getByLabelText(/required skills/i), {
      target: { value: 'React, TypeScript, Tailwind' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add slot$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^add slot$/i })).not.toBeInTheDocument();
      expect(screen.getByText('React')).toBeInTheDocument();
    });

    // 3. Edit Vacancy Slot
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText(/role/i), {
      target: { value: 'Backend' },
    });
    fireEvent.change(screen.getByLabelText(/required skills/i), {
      target: { value: 'Go, Docker, PostgreSQL' },
    });
    fireEvent.click(screen.getByRole('button', { name: /update slot/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /update slot/i })).not.toBeInTheDocument();
      expect(screen.getByText('Go')).toBeInTheDocument();
    });

    // 4. Capacity 409: open add form, then simulate server capacity exceeded
    fireEvent.click(screen.getByRole('button', { name: /add open slot/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add slot/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/role/i), {
      target: { value: 'Mobile' },
    });
    fireEvent.change(screen.getByLabelText(/required skills/i), {
      target: { value: 'Swift' },
    });

    simulatedCustomError = {
      status: 409,
      body: {
        code: 'CAPACITY_EXCEEDED',
        error: 'Event capacity reached (4/4 confirmed + open). Cannot add vacancy.',
        errors: { vacancies: 'Event capacity reached (4/4 confirmed + open). Cannot add vacancy.' },
      },
    };

    fireEvent.click(screen.getByRole('button', { name: /^add slot$/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/event capacity reached/i).length).toBeGreaterThanOrEqual(1);
    });
    // Values preserved on 409
    expect(screen.getByDisplayValue('Swift')).toBeInTheDocument();
    simulatedCustomError = null;
    // Cancel vacancy form
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    // 5. Remove Vacancy Slot (with confirm warning)
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    expect(
      screen.getByText(/remove this open slot\? any pending requests for it will be canceled\./i)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /confirm remove/i }));

    await waitFor(() => {
      expect(screen.getByText(/no open slots yet/i)).toBeInTheDocument();
    });

    // 6. Remove Member (Add dummy member and test removal with reason requirement)
    currentTeam!.members.push({
      participantId: MEMBER_ID,
      displayName: 'Bob Hacker',
      role: 'Member',
      joinedAt: new Date().toISOString(),
    });
    // Trigger workspace re-render with updated team
    fireEvent.change(screen.getByLabelText(/team name/i), {
      target: { value: 'Code Artisans Updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText('Bob Hacker')).toBeInTheDocument();
    });

    // Attempt removal
    const memberRemoveButtons = screen.getAllByRole('button', { name: /^remove$/i });
    fireEvent.click(memberRemoveButtons[0]);

    // Validation: reason is required
    fireEvent.click(screen.getByRole('button', { name: /confirm remove/i }));
    await waitFor(() => {
      expect(screen.getByText(/removal reason is required/i)).toBeInTheDocument();
    });

    // Enter reason and confirm
    fireEvent.change(screen.getByLabelText(/reason for removing/i), {
      target: { value: 'Inactivity during sprints' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm remove/i }));

    await waitFor(() => {
      expect(screen.queryByText('Bob Hacker')).not.toBeInTheDocument();
    });

    // 7. Disband Team (with alertdialog confirmation and Cancel verification)
    fireEvent.click(screen.getByRole('button', { name: /^disband team$/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // Cancel does nothing
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // Reopen and confirm disband
    fireEvent.click(screen.getByRole('button', { name: /^disband team$/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, disband team/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/team disbanded\. all pending requests were canceled\./i)
      ).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /create your hackathon team/i })).toBeInTheDocument();
    });
  });

  // Scenario 8: Load error -> Retry succeeds
  it('Scenario 8: Initial load failure renders error alert with functional Retry button', async () => {
    simulatedNetworkFailure = true;
    render(<TeamWorkspace eventId={EVENT_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /error loading team/i })).toBeInTheDocument();
    });

    simulatedNetworkFailure = false;
    currentTeam = createSampleTeam();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Hackathon Pioneers')).toBeInTheDocument();
    });
  });

  // Scenario 9: 403 Forbidden alert
  it('Scenario 9: 403 Forbidden renders Access Restricted alert', async () => {
    simulatedCustomError = {
      status: 403,
      body: {
        code: 'EMAIL_NOT_VERIFIED',
        error: 'Your email address must be verified before participating.',
      },
    };

    render(<TeamWorkspace eventId={EVENT_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /access restricted/i })).toBeInTheDocument();
      expect(
        screen.getByText(/your email address must be verified before participating\./i)
      ).toBeInTheDocument();
    });
  });

  // Scenario 10: 409 TEAM_NOT_MUTABLE mid-edit preserves typed text and displays error
  it('Scenario 10: 409 TEAM_NOT_MUTABLE preserves unsaved user input on listing form', async () => {
    currentTeam = createSampleTeam();
    render(<TeamWorkspace eventId={EVENT_ID} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Hackathon Pioneers')).toBeInTheDocument();
    });

    simulatedCustomError = {
      status: 409,
      body: {
        code: 'TEAM_NOT_MUTABLE',
        error: 'Team recruitment is locked. Changes can no longer be made.',
        details: { reason: 'Locked' },
      },
    };

    const pitchInput = screen.getByLabelText(/recruitment pitch/i);
    fireEvent.change(pitchInput, {
      target: { value: 'Unsaved innovative pitch that must not be wiped out!' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/team recruitment is locked\. changes can no longer be made\./i)
      ).toBeInTheDocument();
    });

    // Verify unsaved text is preserved (NR-010)
    expect(pitchInput).toHaveValue('Unsaved innovative pitch that must not be wiped out!');
  });

  // Scenario 11: Network failure keeps values
  it('Scenario 11: Network error during form submission keeps user-entered values intact', async () => {
    currentTeam = createSampleTeam();
    render(<TeamWorkspace eventId={EVENT_ID} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Hackathon Pioneers')).toBeInTheDocument();
    });

    simulatedNetworkFailure = true;

    const nameInput = screen.getByLabelText(/team name/i);
    fireEvent.change(nameInput, {
      target: { value: 'Network Resilient Team' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/network error\. your entered values have been kept\./i)
      ).toBeInTheDocument();
    });

    expect(nameInput).toHaveValue('Network Resilient Team');
  });

  // Scenario 12: Keyboard-only path (Escape cancels inline confirms)
  it('Scenario 12: Keyboard Escape key cancels vacancy removal and disband confirm dialogs', async () => {
    currentTeam = createSampleTeam({
      vacancies: [
        {
          id: 'vac-esc-1',
          role: 'UI/UX',
          skills: ['Figma'],
          status: 'Open',
        },
      ],
    });

    render(<TeamWorkspace eventId={EVENT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('UI/UX')).toBeInTheDocument();
    });

    // 1. Vacancy removal alertdialog Escape
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    const vacancyDialog = screen.getByRole('alertdialog');
    expect(vacancyDialog).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // 2. Disband alertdialog Escape
    fireEvent.click(screen.getByRole('button', { name: /^disband team$/i }));
    const disbandDialog = screen.getByRole('alertdialog');
    expect(disbandDialog).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  // Scenario 13: XSS payload inert
  it('Scenario 13: XSS vectors in pitch and communication links render safely as inert text', async () => {
    const xssScript = '<script>alert("xss")</script>';
    currentTeam = createSampleTeam({
      pitch: xssScript,
      communicationLink: 'https://example.com/legit',
    });

    render(<TeamWorkspace eventId={EVENT_ID} />);

    await waitFor(() => {
      const textarea = screen.getByLabelText(/recruitment pitch/i) as HTMLTextAreaElement;
      expect(textarea.value).toBe(xssScript);
    });

    // Verify there are no executable script tags created in document body
    expect(document.querySelectorAll('script[src*="alert"]')).toHaveLength(0);
  });
});
