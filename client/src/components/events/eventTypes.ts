export interface PublicEvent {
  id: string;
  title: string;
  official_url: string | null;
  link_disabled: boolean;
  event_edition: string | null;
  start_date: string;
  end_date: string;
  format: string;
  location: string | null;
  min_team_size: number | null;
  max_team_size: number | null;
  status: 'Published' | 'Archived';
  time_state: 'upcoming' | 'ongoing' | 'concluded';
}

export type TimeState = 'upcoming' | 'ongoing' | 'concluded';
