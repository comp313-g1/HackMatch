import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HackathonHistorySection } from './HackathonHistorySection';
import type { HackathonHistoryItem } from './hackathonHistoryValidation';

describe('HackathonHistorySection (US-007 / #280)', () => {
  const sampleHistory: HackathonHistoryItem[] = [
    {
      id: 'hist-1',
      participantId: 'part-1',
      eventName: 'Hack The North 2024',
      eventDate: '2024-09-15',
      teamRole: 'Frontend',
      projectTitle: 'EcoTrack AI',
      projectUrl: 'https://github.com/org/ecotrack',
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Viewer Permissions & Privacy Boundaries (US-007 AC 3 / FR-015)', () => {
    it('VISITOR viewerCategory renders restriction notice and suppresses history cards, project links, and edit buttons', () => {
      render(
        <HackathonHistorySection
          viewerCategory="VISITOR"
          initialHistory={sampleHistory}
        />
      );

      expect(screen.getByTestId('visitor-history-restricted')).toHaveTextContent(
        /sign in as a registered participant to view self-reported hackathon history/i
      );
      expect(screen.queryByText('Hack The North 2024')).not.toBeInTheDocument();
      expect(screen.queryByText('EcoTrack AI')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /\+ add past hackathon/i })).not.toBeInTheDocument();
      expect(screen.queryByTestId('experience-badge-pill')).not.toBeInTheDocument();
    });

    it('PART viewerCategory renders read-only history cards, badge pill, and external links without Add/Edit/Remove buttons', () => {
      render(
        <HackathonHistorySection
          viewerCategory="PART"
          initialHistory={sampleHistory}
        />
      );

      // Permitted data visible
      expect(screen.getByText('Hack The North 2024')).toBeInTheDocument();
      expect(screen.getByText('(1 record)')).toBeInTheDocument();
      expect(screen.getByTestId('experience-badge-pill')).toHaveTextContent('Competitor');
      const link = screen.getByRole('link', { name: 'https://github.com/org/ecotrack' });
      expect(link).toHaveAttribute('href', 'https://github.com/org/ecotrack');
      expect(link).toHaveAttribute('target', '_blank');

      // Edit controls hidden
      expect(screen.queryByRole('button', { name: /\+ add past hackathon/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^remove$/i })).not.toBeInTheDocument();
    });
  });

  describe('Experience Badge Recalculation & Lifecycle (US-007 AC 2 & AC 4)', () => {
    it('defaults to Beginner (0 records) when initial history is empty', () => {
      render(
        <HackathonHistorySection
          viewerCategory="OWNER"
          initialHistory={[]}
        />
      );

      expect(screen.getByTestId('experience-badge-pill')).toHaveTextContent('Beginner');
      expect(screen.getByTestId('experience-record-count')).toHaveTextContent('(0 records)');
      expect(screen.getByText(/no hackathon history recorded yet/i)).toBeInTheDocument();
    });

    it('transitions badge from Beginner -> Competitor upon adding first record', async () => {
      const mockGetIdToken = vi.fn().mockResolvedValue('test-token');
      const onHistoryUpdated = vi.fn();

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: 'Entry added successfully.',
            entry: {
              id: 'hist-new-1',
              participantId: 'me',
              eventName: 'UofT Hacks XI',
              eventDate: '2024-01-20',
              teamRole: 'Backend',
              projectTitle: 'StudyBuddy',
              projectUrl: 'https://github.com/org/studybuddy',
            },
            history: [
              {
                id: 'hist-new-1',
                participantId: 'me',
                eventName: 'UofT Hacks XI',
                eventDate: '2024-01-20',
                teamRole: 'Backend',
                projectTitle: 'StudyBuddy',
                projectUrl: 'https://github.com/org/studybuddy',
              },
            ],
            experienceBadge: 'Competitor',
            hackathonCount: 1,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        )
      );

      render(
        <HackathonHistorySection
          viewerCategory="OWNER"
          initialHistory={[]}
          getIdToken={mockGetIdToken}
          onHistoryUpdated={onHistoryUpdated}
        />
      );

      expect(screen.getByTestId('experience-badge-pill')).toHaveTextContent('Beginner');

      // Open Add Form
      fireEvent.click(screen.getByRole('button', { name: /\+ add past hackathon/i }));
      expect(screen.getByLabelText(/event name/i)).toBeInTheDocument();

      // Fill in valid fields
      fireEvent.change(screen.getByLabelText(/event name/i), {
        target: { value: 'UofT Hacks XI' },
      });
      fireEvent.change(screen.getByLabelText(/date/i), {
        target: { value: '2024-01-20' },
      });
      fireEvent.change(screen.getByLabelText(/team role/i), {
        target: { value: 'Backend' },
      });
      fireEvent.change(screen.getByLabelText(/project title/i), {
        target: { value: 'StudyBuddy' },
      });
      fireEvent.change(screen.getByLabelText(/project https url/i), {
        target: { value: 'https://github.com/org/studybuddy' },
      });

      // Submit
      fireEvent.click(screen.getByRole('button', { name: /save record/i }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/profiles/me/history',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              Authorization: 'Bearer test-token',
            }),
          })
        );
      });

      expect(await screen.findByText('UofT Hacks XI')).toBeInTheDocument();
      expect(screen.getByTestId('experience-badge-pill')).toHaveTextContent('Competitor');
      expect(screen.getByTestId('experience-record-count')).toHaveTextContent('(1 record)');
      expect(onHistoryUpdated).toHaveBeenCalledWith(
        expect.any(Array),
        'Competitor'
      );
    });

    it('transitions badge from Competitor (3 records) -> Veteran (4 records) -> Competitor (after deleting)', async () => {
      const mockGetIdToken = vi.fn().mockResolvedValue('test-token');
      const onHistoryUpdated = vi.fn();
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      const threeItems: HackathonHistoryItem[] = [
        { id: '1', participantId: 'me', eventName: 'H1', eventDate: '2024-01-01', teamRole: 'Frontend', projectTitle: 'P1', projectUrl: 'https://ex.com/1' },
        { id: '2', participantId: 'me', eventName: 'H2', eventDate: '2024-02-01', teamRole: 'Backend', projectTitle: 'P2', projectUrl: 'https://ex.com/2' },
        { id: '3', participantId: 'me', eventName: 'H3', eventDate: '2024-03-01', teamRole: 'AI/ML', projectTitle: 'P3', projectUrl: 'https://ex.com/3' },
      ];

      const fourthItem: HackathonHistoryItem = {
        id: '4', participantId: 'me', eventName: 'H4', eventDate: '2024-04-01', teamRole: 'Pitch', projectTitle: 'P4', projectUrl: 'https://ex.com/4'
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        // POST 4th record
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              entry: fourthItem,
              history: [...threeItems, fourthItem],
              experienceBadge: 'Veteran',
              hackathonCount: 4,
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          )
        )
        // DELETE 4th record
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              message: 'Record deleted.',
              history: threeItems,
              experienceBadge: 'Competitor',
              hackathonCount: 3,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );

      render(
        <HackathonHistorySection
          viewerCategory="OWNER"
          initialHistory={threeItems}
          getIdToken={mockGetIdToken}
          onHistoryUpdated={onHistoryUpdated}
        />
      );

      // Initially Competitor (3 records)
      expect(screen.getByTestId('experience-badge-pill')).toHaveTextContent('Competitor');
      expect(screen.getByTestId('experience-record-count')).toHaveTextContent('(3 records)');

      // Add 4th record
      fireEvent.click(screen.getByRole('button', { name: /\+ add past hackathon/i }));
      fireEvent.change(screen.getByLabelText(/event name/i), { target: { value: 'H4' } });
      fireEvent.change(screen.getByLabelText(/date/i), { target: { value: '2024-04-01' } });
      fireEvent.change(screen.getByLabelText(/team role/i), { target: { value: 'Pitch' } });
      fireEvent.change(screen.getByLabelText(/project title/i), { target: { value: 'P4' } });
      fireEvent.change(screen.getByLabelText(/project https url/i), { target: { value: 'https://ex.com/4' } });
      fireEvent.click(screen.getByRole('button', { name: /save record/i }));

      // Badge transitions to Veteran
      expect(await screen.findByText('H4')).toBeInTheDocument();
      expect(screen.getByTestId('experience-badge-pill')).toHaveTextContent('Veteran');
      expect(screen.getByTestId('experience-record-count')).toHaveTextContent('(4 records)');

      // Now Delete 4th record
      const removeButtons = screen.getAllByRole('button', { name: /^remove$/i });
      fireEvent.click(removeButtons[3]); // remove fourth item

      // Badge transitions back to Competitor
      await waitFor(() => {
        expect(screen.getByTestId('experience-badge-pill')).toHaveTextContent('Competitor');
      });
      expect(screen.getByTestId('experience-record-count')).toHaveTextContent('(3 records)');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Form Draft Preservation on Error (NR-010)', () => {
    it('preserves user input and displays field error when validation fails', () => {
      render(
        <HackathonHistorySection
          viewerCategory="OWNER"
          initialHistory={[]}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /\+ add past hackathon/i }));

      // Type invalid non-HTTPS url and future date
      fireEvent.change(screen.getByLabelText(/event name/i), {
        target: { value: 'Hackathon 2024' },
      });
      fireEvent.change(screen.getByLabelText(/date/i), {
        target: { value: '2099-01-01' },
      });
      fireEvent.change(screen.getByLabelText(/project title/i), {
        target: { value: 'My Cool App' },
      });
      fireEvent.change(screen.getByLabelText(/project https url/i), {
        target: { value: 'http://insecure.site' },
      });

      fireEvent.click(screen.getByRole('button', { name: /save record/i }));

      // Verify errors displayed
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/event date cannot be in the future/i)).toBeInTheDocument();
      expect(screen.getByText(/project url must be a valid https url/i)).toBeInTheDocument();

      // NR-010: Verify all user typed values are preserved intact
      expect(screen.getByLabelText(/event name/i)).toHaveValue('Hackathon 2024');
      expect(screen.getByLabelText(/date/i)).toHaveValue('2099-01-01');
      expect(screen.getByLabelText(/project title/i)).toHaveValue('My Cool App');
      expect(screen.getByLabelText(/project https url/i)).toHaveValue('http://insecure.site');
    });

    it('preserves user input when server returns 400 error', async () => {
      const mockGetIdToken = vi.fn().mockResolvedValue('test-token');
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: 'DUPLICATE_HISTORY_RECORD',
            message: 'You have already recorded this hackathon and project.',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        )
      );

      render(
        <HackathonHistorySection
          viewerCategory="OWNER"
          initialHistory={[]}
          getIdToken={mockGetIdToken}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /\+ add past hackathon/i }));

      fireEvent.change(screen.getByLabelText(/event name/i), {
        target: { value: 'Duplicate Hackathon' },
      });
      fireEvent.change(screen.getByLabelText(/date/i), {
        target: { value: '2024-05-01' },
      });
      fireEvent.change(screen.getByLabelText(/project title/i), {
        target: { value: 'Duplicate Title' },
      });
      fireEvent.change(screen.getByLabelText(/project https url/i), {
        target: { value: 'https://github.com/org/dup' },
      });

      fireEvent.click(screen.getByRole('button', { name: /save record/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /you have already recorded this hackathon and project/i
      );

      // Verify values remain intact
      expect(screen.getByLabelText(/event name/i)).toHaveValue('Duplicate Hackathon');
      expect(screen.getByLabelText(/date/i)).toHaveValue('2024-05-01');
      expect(screen.getByLabelText(/project title/i)).toHaveValue('Duplicate Title');
      expect(screen.getByLabelText(/project https url/i)).toHaveValue('https://github.com/org/dup');
    });
  });

  describe('Owner Edit Flow', () => {
    it('populates form with existing record on Edit click and updates via PUT', async () => {
      const mockGetIdToken = vi.fn().mockResolvedValue('test-token');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: 'Record updated.',
            entry: {
              ...sampleHistory[0],
              projectTitle: 'EcoTrack AI 2.0',
            },
            history: [
              {
                ...sampleHistory[0],
                projectTitle: 'EcoTrack AI 2.0',
              },
            ],
            experienceBadge: 'Competitor',
            hackathonCount: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      render(
        <HackathonHistorySection
          viewerCategory="OWNER"
          initialHistory={sampleHistory}
          getIdToken={mockGetIdToken}
        />
      );

      // Click Edit
      fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

      // Form populated with existing values
      expect(screen.getByLabelText(/event name/i)).toHaveValue('Hack The North 2024');
      expect(screen.getByLabelText(/project title/i)).toHaveValue('EcoTrack AI');

      // Update project title
      fireEvent.change(screen.getByLabelText(/project title/i), {
        target: { value: 'EcoTrack AI 2.0' },
      });
      fireEvent.click(screen.getByRole('button', { name: /update record/i }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/profiles/me/history/hist-1',
          expect.objectContaining({
            method: 'PUT',
          })
        );
      });

      expect(await screen.findByText('EcoTrack AI 2.0')).toBeInTheDocument();
    });
  });

  describe('Capacity Limit Guardrail', () => {
    it('disables Add button when HISTORY_MAX_ENTRIES (20) is reached', () => {
      const twentyRecords: HackathonHistoryItem[] = Array.from({ length: 20 }, (_, i) => ({
        id: `hist-${i}`,
        participantId: 'me',
        eventName: `Hackathon ${i}`,
        eventDate: '2024-01-01',
        teamRole: 'Frontend',
        projectTitle: `Project ${i}`,
        projectUrl: `https://example.com/${i}`,
      }));

      render(
        <HackathonHistorySection
          viewerCategory="OWNER"
          initialHistory={twentyRecords}
        />
      );

      const addButton = screen.getByRole('button', { name: /limit reached \(20\/20\)/i });
      expect(addButton).toBeDisabled();
    });
  });
});
