import { describe, it, expect } from 'vitest';
import { deriveTeamLifecycle } from './teamLifecycle.js';

describe('deriveTeamLifecycle unit tests (US-012 / Task 7 / #124)', () => {
  const referenceNow = new Date('2026-10-18T12:00:00.000Z');
  const futureEndDate = '2026-10-18T18:00:00.000Z';
  const pastEndDate = '2026-10-18T06:00:00.000Z';

  it('returns mutable true when team is Open, event is Published, and end_date is in future', () => {
    const lifecycle = deriveTeamLifecycle(
      { recruitment_status: 'Open' },
      { status: 'Published', end_date: futureEndDate },
      referenceNow
    );

    expect(lifecycle).toEqual({ mutable: true, reason: null });
  });

  describe('temporal boundaries', () => {
    it('is mutable when event ends exactly at now', () => {
      const exactEndDate = referenceNow.toISOString();
      const lifecycle = deriveTeamLifecycle(
        { recruitment_status: 'Open' },
        { status: 'Published', end_date: exactEndDate },
        referenceNow
      );

      expect(lifecycle).toEqual({ mutable: true, reason: null });
    });

    it('is not mutable when event ended 1 millisecond before now', () => {
      const oneMsBeforeNow = new Date(referenceNow.getTime() - 1).toISOString();
      const lifecycle = deriveTeamLifecycle(
        { recruitment_status: 'Open' },
        { status: 'Published', end_date: oneMsBeforeNow },
        referenceNow
      );

      expect(lifecycle).toEqual({ mutable: false, reason: 'EventNotRecruiting' });
    });
  });

  describe('status precedence: Disbanded > Locked > EventNotRecruiting', () => {
    it('prioritizes Disbanded even when event is Archived and ended', () => {
      const lifecycle = deriveTeamLifecycle(
        { recruitment_status: 'Disbanded' },
        { status: 'Archived', end_date: pastEndDate },
        referenceNow
      );

      expect(lifecycle).toEqual({ mutable: false, reason: 'Disbanded' });
    });

    it('prioritizes Locked when recruitment_status is Locked even if event is Disabled and ended', () => {
      const lifecycle = deriveTeamLifecycle(
        { recruitment_status: 'Locked' },
        { status: 'Disabled', end_date: pastEndDate },
        referenceNow
      );

      expect(lifecycle).toEqual({ mutable: false, reason: 'Locked' });
    });

    it('returns EventNotRecruiting when team is Open but event is Archived', () => {
      const lifecycle = deriveTeamLifecycle(
        { recruitment_status: 'Open' },
        { status: 'Archived', end_date: futureEndDate },
        referenceNow
      );

      expect(lifecycle).toEqual({ mutable: false, reason: 'EventNotRecruiting' });
    });

    it('returns EventNotRecruiting when team is Open but event is Disabled', () => {
      const lifecycle = deriveTeamLifecycle(
        { recruitment_status: 'Open' },
        { status: 'Disabled', end_date: futureEndDate },
        referenceNow
      );

      expect(lifecycle).toEqual({ mutable: false, reason: 'EventNotRecruiting' });
    });

    it('returns EventNotRecruiting when team is Open, event is Published, but end_date has passed', () => {
      const lifecycle = deriveTeamLifecycle(
        { recruitment_status: 'Open' },
        { status: 'Published', end_date: pastEndDate },
        referenceNow
      );

      expect(lifecycle).toEqual({ mutable: false, reason: 'EventNotRecruiting' });
    });
  });
});
