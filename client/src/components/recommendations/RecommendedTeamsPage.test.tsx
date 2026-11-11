import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './recommendedTeamsApi';
import { RecommendedTeamsPage } from './RecommendedTeamsPage';
import type { RecommendedTeam, RecommendedTeamsResponse } from './recommendedTeamsApi';

vi.mock('./recommendedTeamsApi', async () => {
  const actual = await vi.importActual<typeof import('./recommendedTeamsApi')>('./recommendedTeamsApi');
  return { ...actual, fetchRecommendedTeams: vi.fn() };
});

const team = (over: Partial<RecommendedTeam> = {}): RecommendedTeam => ({
  rank: 1,
  teamId: 't-1',
  vacancyId: 'v-1',
  teamName: 'Civic Signal',
  goal: 'Learning',
  commitmentHours: 12,
  vacancyRole: 'Backend',
  matchPercent: 80,
  matchedSkills: ['Node.js'],
  missingSkills: ['PostgreSQL'],
  roleMatched: true,
  contributions: { skill: 'Matched 1 of 2 required skills.', goal: 'Identical goals.', hours: 'Commitment 12h vs requested 12h.' },
  ...over,
});

const list = (teams: RecommendedTeam[], over: Partial<RecommendedTeamsResponse> = {}): RecommendedTeamsResponse => ({
  recommendations: teams,
  empty: teams.length === 0,
  ineligibleReason: null,
  message: null,
  notice: 'Scores use self-declared information.',
  ...over,
});

const handlers = () => ({
  onNavigateToSignIn: vi.fn(),
  onGoToLookingForTeam: vi.fn(),
  onGoToProfile: vi.fn(),
  onBrowseOpenTeams: vi.fn(),
});

async function show(props: Partial<React.ComponentProps<typeof RecommendedTeamsPage>> = {}) {
  const h = handlers();
  const view = render(<RecommendedTeamsPage {...h} {...props} />);
  await act(async () => {});
  return { ...h, ...view };
}

const fetchMock = () => vi.mocked(api.fetchRecommendedTeams);

describe('RecommendedTeamsPage (US-016 / #156)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock().mockResolvedValue(list([team()]));
  });

  describe('loading', () => {
    it('shows a loading message until the answer arrives, and no empty or error text', async () => {
      let finish: (value: RecommendedTeamsResponse) => void = () => undefined;
      fetchMock().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      const h = handlers();
      render(<RecommendedTeamsPage {...h} />);
      expect(screen.getByTestId('recommended-teams-loading')).toHaveTextContent('Finding teams for you');
      expect(screen.queryByTestId('recommended-teams-empty')).not.toBeInTheDocument();
      expect(screen.queryByTestId('recommended-teams-error')).not.toBeInTheDocument();
      expect(screen.queryByTestId('refresh-recommended-teams')).not.toBeInTheDocument();
      await act(async () => finish(list([team()])));
      expect(screen.queryByTestId('recommended-teams-loading')).not.toBeInTheDocument();
    });

    it('asks for the list once when the page opens', async () => {
      await show();
      expect(fetchMock()).toHaveBeenCalledTimes(1);
    });
  });

  describe('success', () => {
    it('shows the heading, the count and each team with its match percentage', async () => {
      fetchMock().mockResolvedValue(list([team(), team({ rank: 2, teamId: 't-2', vacancyId: 'v-2', teamName: 'Campus Compass', matchPercent: 55 })]));
      await show();
      expect(screen.getByRole('heading', { level: 1, name: 'Recommended teams' })).toBeInTheDocument();
      expect(screen.getByTestId('recommended-teams-count')).toHaveTextContent('2 suggested teams');
      const cards = screen.getAllByTestId('recommended-team');
      expect(cards).toHaveLength(2);
      expect(within(cards[0]!).getByText('Civic Signal')).toBeInTheDocument();
      expect(within(cards[0]!).getByTestId('match-percent')).toHaveTextContent('80%');
      expect(within(cards[1]!).getByTestId('match-percent')).toHaveTextContent('55%');
    });

    it('says "1 suggested team" for a single team', async () => {
      await show();
      expect(screen.getByTestId('recommended-teams-count')).toHaveTextContent('1 suggested team');
      expect(screen.getByTestId('recommended-teams-count')).not.toHaveTextContent('teams');
    });

    it('keeps the order the server gave (best first)', async () => {
      fetchMock().mockResolvedValue(list([
        team({ rank: 1, teamId: 'a', vacancyId: 'va', teamName: 'Alpha' }),
        team({ rank: 2, teamId: 'b', vacancyId: 'vb', teamName: 'Bravo' }),
        team({ rank: 3, teamId: 'c', vacancyId: 'vc', teamName: 'Charlie' }),
      ]));
      await show();
      expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('shows the server notice about self-declared scores, or a default one', async () => {
      await show();
      expect(screen.getByTestId('recommended-teams-notice')).toHaveTextContent('Scores use self-declared information.');
    });

    it('uses a default notice when the server sends none', async () => {
      fetchMock().mockResolvedValue(list([team()], { notice: null }));
      await show();
      expect(screen.getByTestId('recommended-teams-notice')).toHaveTextContent(/suggestions, not predictions/i);
    });

    it('shows two open roles of the same team as two separate suggestions', async () => {
      fetchMock().mockResolvedValue(list([team(), team({ rank: 2, vacancyId: 'v-2', vacancyRole: 'AI/ML' })]));
      await show();
      expect(screen.getAllByTestId('recommended-team')).toHaveLength(2);
    });
  });

  describe('empty states', () => {
    it('explains that nothing matches right now, using the server message, and offers browsing', async () => {
      fetchMock().mockResolvedValue(list([], { message: 'Nothing right now.' }));
      const { onBrowseOpenTeams } = await show();
      const empty = screen.getByTestId('recommended-teams-empty');
      expect(empty).toHaveAttribute('data-reason', 'no-matches');
      expect(empty).toHaveTextContent('No open teams match you right now');
      expect(empty).toHaveTextContent('Nothing right now.');
      expect(screen.queryByTestId('recommended-teams-results')).not.toBeInTheDocument();
      expect(screen.queryByTestId('refresh-recommended-teams')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('browse-open-teams'));
      expect(onBrowseOpenTeams).toHaveBeenCalledTimes(1);
    });

    it('explains what is left out when the server sends no message', async () => {
      fetchMock().mockResolvedValue(list([]));
      await show();
      expect(screen.getByTestId('recommended-teams-empty')).toHaveTextContent(/already belong to.*full, locked or closed.*already applied to or were invited by/i);
    });

    it('can check again, which asks the server once more', async () => {
      fetchMock().mockResolvedValueOnce(list([])).mockResolvedValueOnce(list([team()]));
      await show();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
      });
      expect(fetchMock()).toHaveBeenCalledTimes(2);
      expect(screen.getAllByTestId('recommended-team')).toHaveLength(1);
      expect(screen.queryByTestId('recommended-teams-empty')).not.toBeInTheDocument();
    });

    it('asks a person who is not Looking for Team to turn it on, and takes them there', async () => {
      fetchMock().mockResolvedValue(list([], { ineligibleReason: 'participant_not_looking' }));
      const { onGoToLookingForTeam } = await show();
      const empty = screen.getByTestId('recommended-teams-empty');
      expect(empty).toHaveAttribute('data-reason', 'participant_not_looking');
      expect(empty).toHaveTextContent('Turn on Looking for Team to see suggestions');
      expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('go-to-looking'));
      expect(onGoToLookingForTeam).toHaveBeenCalledTimes(1);
    });

    it('asks a person with no skills to add some, and takes them to their profile', async () => {
      fetchMock().mockResolvedValue(list([], { ineligibleReason: 'participant_no_skills' }));
      const { onGoToProfile } = await show();
      expect(screen.getByTestId('recommended-teams-empty')).toHaveTextContent('Add your skills to see suggestions');
      fireEvent.click(screen.getByTestId('go-to-profile'));
      expect(onGoToProfile).toHaveBeenCalledTimes(1);
    });

    it('hides the profile button when the page was given nowhere to go', async () => {
      fetchMock().mockResolvedValue(list([], { ineligibleReason: 'participant_no_skills' }));
      await show({ onGoToProfile: undefined });
      expect(screen.queryByTestId('go-to-profile')).not.toBeInTheDocument();
    });

    it.each(['participant_profile_hidden', 'participant_unavailable'] as const)(
      'gives a neutral message for %s, without saying why',
      async (reason) => {
        fetchMock().mockResolvedValue(list([], { ineligibleReason: reason }));
        await show();
        const empty = screen.getByTestId('recommended-teams-empty');
        expect(empty).toHaveTextContent('Suggestions are not available for your account right now');
        expect(empty.textContent).not.toMatch(/hidden|suspend|moderat|deactivat/i);
        expect(screen.getByTestId('browse-open-teams')).toBeInTheDocument();
      }
    );
  });

  describe('errors', () => {
    it('shows an error with a Try again button when loading fails, and retrying works', async () => {
      fetchMock()
        .mockRejectedValueOnce(new api.RecommendedTeamsApiError(500, 'UNKNOWN_ERROR', 'Server exploded.'))
        .mockResolvedValueOnce(list([team()]));
      await show();
      expect(screen.getByTestId('recommended-teams-error')).toHaveTextContent('Server exploded.');
      expect(screen.queryByTestId('recommended-teams-results')).not.toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      });
      expect(screen.queryByTestId('recommended-teams-error')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('recommended-team')).toHaveLength(1);
    });

    it('shows a friendly message for a network failure', async () => {
      fetchMock().mockRejectedValue(new api.RecommendedTeamsApiError(0, 'NETWORK', 'Network error. Please check your connection and try again.'));
      await show();
      expect(screen.getByTestId('recommended-teams-error')).toHaveTextContent('Network error');
    });

    it('shows the invalid-response message when the server answer is malformed', async () => {
      fetchMock().mockRejectedValue(new api.RecommendedTeamsApiError(502, 'INVALID_RESPONSE', 'The server returned an invalid recommendations response.'));
      await show();
      expect(screen.getByTestId('recommended-teams-error')).toHaveTextContent('invalid recommendations response');
    });

    it('explains a 403 without showing the raw server text', async () => {
      fetchMock().mockRejectedValue(new api.RecommendedTeamsApiError(403, 'FORBIDDEN', 'raw internal text'));
      await show();
      expect(screen.getByTestId('recommended-teams-error')).toHaveTextContent(/do not have access/i);
      expect(screen.getByTestId('recommended-teams-error').textContent).not.toContain('raw internal text');
    });

    it('uses a generic message for an unexpected failure', async () => {
      fetchMock().mockRejectedValue(new Error('boom'));
      await show();
      expect(screen.getByTestId('recommended-teams-error')).toHaveTextContent('Could not load your recommended teams.');
      expect(screen.getByTestId('recommended-teams-error').textContent).not.toContain('boom');
    });

    it('keeps the last list when a refresh fails, and says so', async () => {
      fetchMock().mockResolvedValueOnce(list([team()])).mockRejectedValueOnce(new api.RecommendedTeamsApiError(500, 'UNKNOWN_ERROR', 'Server exploded.'));
      await show();
      await act(async () => {
        fireEvent.click(screen.getByTestId('refresh-recommended-teams'));
      });
      expect(screen.getAllByTestId('recommended-team')).toHaveLength(1);
      expect(screen.getByTestId('recommended-teams-error')).toHaveTextContent('Showing your last results.');
    });
  });

  describe('signed out', () => {
    it('asks the person to sign in again when sign-in is required', async () => {
      fetchMock().mockRejectedValue(new api.AuthRequiredError());
      const { onNavigateToSignIn } = await show();
      expect(screen.getByTestId('recommended-teams-signed-out')).toHaveTextContent('Please sign in again');
      expect(screen.queryByTestId('recommended-teams-error')).not.toBeInTheDocument();
      expect(screen.queryByTestId('recommended-team')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      expect(onNavigateToSignIn).toHaveBeenCalledTimes(1);
    });

    it('treats a 401 answer the same way', async () => {
      fetchMock().mockRejectedValue(new api.RecommendedTeamsApiError(401, 'UNAUTHORIZED', 'x'));
      await show();
      expect(screen.getByTestId('recommended-teams-signed-out')).toBeInTheDocument();
    });

    it('drops a stale list when the person turns out to be signed out on refresh', async () => {
      fetchMock().mockResolvedValueOnce(list([team()])).mockRejectedValueOnce(new api.AuthRequiredError());
      await show();
      await act(async () => {
        fireEvent.click(screen.getByTestId('refresh-recommended-teams'));
      });
      expect(screen.queryByTestId('recommended-team')).not.toBeInTheDocument();
      expect(screen.getByTestId('recommended-teams-signed-out')).toBeInTheDocument();
    });
  });

  describe('refresh and timing', () => {
    it('disables Refresh while a refresh is running, so it cannot be sent twice', async () => {
      let finish: (value: RecommendedTeamsResponse) => void = () => undefined;
      fetchMock().mockResolvedValueOnce(list([team()])).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      await show();
      fireEvent.click(screen.getByTestId('refresh-recommended-teams'));
      const button = screen.getByTestId('refresh-recommended-teams');
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Refreshing');
      fireEvent.click(button);
      expect(fetchMock()).toHaveBeenCalledTimes(2);
      await act(async () => finish(list([team({ teamName: 'Fresh Team' })])));
      expect(screen.getByText('Fresh Team')).toBeInTheDocument();
      expect(screen.getByTestId('refresh-recommended-teams')).not.toBeDisabled();
    });

    it('keeps showing the current list while a refresh is running', async () => {
      let finish: (value: RecommendedTeamsResponse) => void = () => undefined;
      fetchMock().mockResolvedValueOnce(list([team()])).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      await show();
      fireEvent.click(screen.getByTestId('refresh-recommended-teams'));
      expect(screen.getAllByTestId('recommended-team')).toHaveLength(1);
      await act(async () => finish(list([team()])));
    });

    it('shows the newest answer when an older request finishes last (as happens when React starts the page twice)', async () => {
      let finishOld: (value: RecommendedTeamsResponse) => void = () => undefined;
      fetchMock()
        .mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
        .mockResolvedValueOnce(list([team({ teamName: 'New Team' })]));
      const h = handlers();
      render(
        <React.StrictMode>
          <RecommendedTeamsPage {...h} />
        </React.StrictMode>
      );
      await act(async () => {});
      expect(screen.getByText('New Team')).toBeInTheDocument();

      await act(async () => finishOld(list([team({ teamName: 'Old Team' })])));

      expect(screen.getByText('New Team')).toBeInTheDocument();
      expect(screen.queryByText('Old Team')).not.toBeInTheDocument();
    });

    it('ignores an answer that arrives after the page was closed', async () => {
      let finish: (value: RecommendedTeamsResponse) => void = () => undefined;
      fetchMock().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      const h = handlers();
      const { unmount } = render(<RecommendedTeamsPage {...h} />);
      unmount();
      await act(async () => finish(list([team()])));
      expect(screen.queryByTestId('recommended-team')).not.toBeInTheDocument();
    });
  });

  describe('apply hook (US-018)', () => {
    it('shows no Apply button unless the page is given somewhere to send it', async () => {
      await show();
      expect(screen.queryByTestId('apply-to-team')).not.toBeInTheDocument();
    });

    it('passes the chosen suggestion to the apply handler', async () => {
      const onApply = vi.fn();
      await show({ onApply });
      fireEvent.click(screen.getByTestId('apply-to-team'));
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply.mock.calls[0]![0]).toMatchObject({ teamId: 't-1', vacancyId: 'v-1' });
    });
  });
});

describe('RecommendedTeamCard (US-016 / #156)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function card(over: Partial<RecommendedTeam> = {}) {
    fetchMock().mockResolvedValue(list([team(over)]));
    await show();
    return screen.getByTestId('recommended-team');
  }

  it.each([0, 37, 100])('draws the bar %s%% full', async (percent) => {
    const c = await card({ matchPercent: percent });
    const fill = within(c).getByRole('progressbar', { name: 'Match percentage' }).firstElementChild as HTMLElement;
    expect(fill.style.width).toBe(`${percent}%`);
  });

  it('lists two open roles of the same team without a duplicate-key warning', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock().mockResolvedValue(list([team(), team({ rank: 2, vacancyId: 'v-2', vacancyRole: 'AI/ML' })]));
    await show();
    expect(screen.getAllByTestId('recommended-team')).toHaveLength(2);
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/i);
  });

  it('shows the open role, goal and weekly hours', async () => {
    const c = await card();
    expect(c).toHaveTextContent('Open role: Backend');
    expect(c).toHaveTextContent('Goal: Learning');
    expect(c).toHaveTextContent('12 h/week');
  });

  it('leaves out the goal and hours when the team has not stated them', async () => {
    const c = await card({ goal: null, commitmentHours: null });
    expect(c).not.toHaveTextContent('Goal:');
    expect(c).not.toHaveTextContent('h/week');
  });

  it('shows 0 hours when the team asks for none', async () => {
    const c = await card({ commitmentHours: 0 });
    expect(c).toHaveTextContent('0 h/week');
  });

  it('highlights the skills the person has and lists the ones they could learn', async () => {
    const c = await card({ matchedSkills: ['Node.js', 'Go'], missingSkills: ['Rust'] });
    expect(within(c).getByTestId('matched-skills')).toHaveTextContent('Node.js');
    expect(within(c).getByTestId('matched-skills')).toHaveTextContent('Go');
    expect(within(c).getByTestId('missing-skills')).toHaveTextContent('Rust');
    expect(c).toHaveTextContent('You have 2 of 3 skills this role asks for.');
  });

  it('says "1 skill" in the singular', async () => {
    const c = await card({ matchedSkills: ['A'], missingSkills: [] });
    expect(c).toHaveTextContent('You have 1 of 1 skill this role asks for.');
  });

  it('has no missing-skills list when the person has everything', async () => {
    const c = await card({ matchedSkills: ['A', 'B'], missingSkills: [] });
    expect(within(c).queryByTestId('missing-skills')).not.toBeInTheDocument();
  });

  it('has no matched-skills list when the person has none of them', async () => {
    const c = await card({ matchedSkills: [], missingSkills: ['A', 'B'] });
    expect(within(c).queryByTestId('matched-skills')).not.toBeInTheDocument();
    expect(c).toHaveTextContent('You have 0 of 2 skills this role asks for.');
  });

  it('says so when the role lists no required skills', async () => {
    const c = await card({ matchedSkills: [], missingSkills: [] });
    expect(within(c).getByTestId('no-required-skills')).toHaveTextContent('does not list any required skills');
    expect(within(c).queryByTestId('matched-skills')).not.toBeInTheDocument();
  });

  it.each([0, 1, 50, 100])('shows %s%% as a text value and as an accessible progress bar', async (percent) => {
    const c = await card({ matchPercent: percent });
    expect(within(c).getByTestId('match-percent')).toHaveTextContent(`${percent}%`);
    const bar = within(c).getByRole('progressbar', { name: 'Match percentage' });
    expect(bar).toHaveAttribute('aria-valuenow', String(percent));
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(c).toHaveAccessibleName(/% match$/);
  });

  it('shows the explanations only after "Why this match?" is chosen, and can hide them again', async () => {
    const c = await card();
    expect(within(c).queryByTestId('match-details')).not.toBeInTheDocument();
    const toggle = within(c).getByTestId('toggle-why');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(within(c).getByTestId('match-details')).toHaveTextContent('Matched 1 of 2 required skills.');
    expect(within(c).getByTestId('match-details')).toHaveTextContent('Identical goals.');
    expect(within(c).getByTestId('match-details')).toHaveTextContent('Commitment 12h vs requested 12h.');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(within(c).queryByTestId('match-details')).not.toBeInTheDocument();
  });

  it('wraps a very long team name instead of breaking the layout', async () => {
    const long = 'A'.repeat(120);
    const c = await card({ teamName: long });
    const heading = within(c).getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent(long);
    expect(heading.className).toContain('break-words');
  });

  it('shows team text as plain text, never as markup', async () => {
    const c = await card({ teamName: '<img src=x onerror=alert(1)>', matchedSkills: ['<b>bold</b>'], missingSkills: [] });
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('b')).toBeNull();
    expect(c).toHaveTextContent('<b>bold</b>');
  });

  it('never shows an id, email or other private field', async () => {
    const c = await card();
    expect(c.textContent).not.toMatch(/t-1|v-1|@/);
  });
});
