-- Migration: 0011_create_team_recruitment_tables.sql
-- Description: Creates teams, team_memberships, team_vacancies, team_requests,
-- participant_notifications, and event_availability tables with strict constraints,
-- business-rule partial unique indexes, RLS enabled, and updated_at triggers.
-- Lock order contract: participants (FOR UPDATE) -> teams (FOR UPDATE) -> child records.

-- 1. Teams Table (US-012 AC 1, AC 6 / FR-032 / FR-035)
CREATE TABLE IF NOT EXISTS teams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  owner_participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  name VARCHAR(100) NOT NULL CHECK (LENGTH(TRIM(name)) > 0),
  pitch VARCHAR(500) NOT NULL CHECK (LENGTH(TRIM(pitch)) > 0),
  goal VARCHAR(30) NOT NULL CHECK (goal IN ('Learning', 'Project Completion', 'Competitive')),
  commitment_hours NUMERIC(4,1) NOT NULL CHECK (commitment_hours >= 0 AND commitment_hours <= 168.0),
  communication_link VARCHAR(2048) CHECK (communication_link IS NULL OR (communication_link LIKE 'https://%' AND LENGTH(communication_link) > 8)),
  recruitment_status VARCHAR(20) NOT NULL DEFAULT 'Open' CHECK (recruitment_status IN ('Open', 'Locked', 'Disbanded')),
  disbanded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_teams_id_event UNIQUE (id, event_id)
);

-- 2. Team Memberships Table (US-012 AC 2, AC 5, AC 6 / FR-083 / FR-036)
CREATE TABLE IF NOT EXISTS team_memberships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  event_id UUID NOT NULL,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  role VARCHAR(20) NOT NULL CHECK (role IN ('Owner', 'Member')),
  status VARCHAR(20) NOT NULL DEFAULT 'Confirmed' CHECK (status IN ('Confirmed', 'Removed', 'Released')),
  removal_reason VARCHAR(500),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_team_memberships_team_event FOREIGN KEY (team_id, event_id) REFERENCES teams(id, event_id) ON DELETE RESTRICT,
  CONSTRAINT chk_team_memberships_status CHECK (status = 'Confirmed' OR ended_at IS NOT NULL)
);

-- 3. Team Vacancies Table (US-012 AC 3, AC 4 / FR-033 / FR-035)
CREATE TABLE IF NOT EXISTS team_vacancies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('Frontend', 'Backend', 'Mobile', 'AI/ML', 'UI/UX', 'Pitch')),
  skills TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(skills) <= 10),
  status VARCHAR(20) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Filled', 'Removed')),
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Team Requests Table (US-012 AC 2, AC 4, AC 6 / R-02 / FR-049)
CREATE TABLE IF NOT EXISTS team_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  vacancy_id UUID REFERENCES team_vacancies(id) ON DELETE SET NULL,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  request_type VARCHAR(20) NOT NULL CHECK (request_type IN ('Invitation', 'Application')),
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted', 'Declined', 'Withdrawn', 'Expired', 'Canceled')),
  cancel_reason VARCHAR(40),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Participant Notifications Table (US-012 AC 4, AC 5, AC 6 / FR-064)
CREATE TABLE IF NOT EXISTS participant_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  type VARCHAR(50) NOT NULL CHECK (LENGTH(TRIM(type)) > 0),
  message VARCHAR(500) NOT NULL CHECK (LENGTH(TRIM(message)) > 0),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Event Availability Table (US-012 AC 2, AC 5, AC 6 / FR-031 / baseline for US-011)
CREATE TABLE IF NOT EXISTS event_availability (
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  is_looking BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (participant_id, event_id)
);

-- 7. Row Level Security (Explicitly enabled with zero public anon policies)
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_vacancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_availability ENABLE ROW LEVEL SECURITY;

-- 8. Business Rule Indexes & Foreign Key Lookups
-- At most one confirmed membership per participant per event (FR-083)
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_memberships_confirmed_per_event
  ON team_memberships(event_id, participant_id)
  WHERE status = 'Confirmed';

-- At most one active confirmed owner per team
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_memberships_one_owner
  ON team_memberships(team_id)
  WHERE role = 'Owner' AND status = 'Confirmed';

-- Only one pending invitation per team and invitee (AC 3, R-02, FR-049)
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_requests_pending_invite
  ON team_requests(team_id, participant_id)
  WHERE request_type = 'Invitation' AND status = 'Pending';

-- Lookups for teammate visibility check (profile.repository.ts)
CREATE INDEX IF NOT EXISTS idx_team_memberships_participant_status
  ON team_memberships(participant_id, status);

-- Open vacancies lookup for recruitment board
CREATE INDEX IF NOT EXISTS idx_team_vacancies_team_open
  ON team_vacancies(team_id)
  WHERE status = 'Open';

-- Pending requests lookups for cancellation and status resolution
CREATE INDEX IF NOT EXISTS idx_team_requests_team_status
  ON team_requests(team_id, status);

CREATE INDEX IF NOT EXISTS idx_team_requests_vacancy_pending
  ON team_requests(vacancy_id)
  WHERE status = 'Pending';

CREATE INDEX IF NOT EXISTS idx_team_requests_participant_event_pending
  ON team_requests(participant_id, event_id)
  WHERE status = 'Pending';

-- Notification retrieval index
CREATE INDEX IF NOT EXISTS idx_participant_notifications_participant
  ON participant_notifications(participant_id, created_at DESC);

-- Availability lookup by event
CREATE INDEX IF NOT EXISTS idx_event_availability_event
  ON event_availability(event_id, is_looking);

-- 9. Automatic updated_at Triggers
DROP TRIGGER IF EXISTS trigger_teams_updated_at ON teams;
CREATE TRIGGER trigger_teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trigger_team_memberships_updated_at ON team_memberships;
CREATE TRIGGER trigger_team_memberships_updated_at
  BEFORE UPDATE ON team_memberships
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trigger_team_vacancies_updated_at ON team_vacancies;
CREATE TRIGGER trigger_team_vacancies_updated_at
  BEFORE UPDATE ON team_vacancies
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trigger_team_requests_updated_at ON team_requests;
CREATE TRIGGER trigger_team_requests_updated_at
  BEFORE UPDATE ON team_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trigger_event_availability_updated_at ON event_availability;
CREATE TRIGGER trigger_event_availability_updated_at
  BEFORE UPDATE ON event_availability
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
