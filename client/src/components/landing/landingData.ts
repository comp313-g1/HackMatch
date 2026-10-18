export type EventFormat = 'all' | 'Online' | 'In-Person' | 'Hybrid';
export type EventTime = 'all' | 'Upcoming' | 'Ongoing' | 'Concluded';

export interface VerifiedEvent {
  id: string;
  name: string;
  format: 'Online' | 'In-Person' | 'Hybrid';
  time: 'Upcoming' | 'Ongoing' | 'Concluded';
  location: string;
  country: string;
  dates: string;
  openTeams: number;
  tags: string[];
}

export const VERIFIED_EVENTS: VerifiedEvent[] = [];
