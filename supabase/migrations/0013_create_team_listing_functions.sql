-- Migration: 0013_create_team_listing_functions.sql
-- Description: Creates atomic PL/pgSQL functions for team listing updates and vacancy management (US-012 / #120)

-- 1. Shared internal guard: lock_team_for_owner_mutation
CREATE OR REPLACE FUNCTION lock_team_for_owner_mutation(
  p_actor UUID,
  p_team UUID
) RETURNS teams
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_event RECORD;
BEGIN
  -- 1. Select team FOR UPDATE
  SELECT * INTO v_team
  FROM teams
  WHERE id = p_team
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Verify actor is owner
  IF v_team.owner_participant_id <> p_actor THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_TEAM_OWNER' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Verify recruitment_status is Open
  IF v_team.recruitment_status <> 'Open' THEN
    RAISE EXCEPTION 'TEAM_NOT_MUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('reason', v_team.recruitment_status)::text;
  END IF;

  -- 4. Lock event FOR SHARE and verify it is recruiting
  SELECT id, status, end_date
  INTO v_event
  FROM events
  WHERE id = v_team.event_id
  FOR SHARE;

  IF NOT FOUND OR v_event.status <> 'Published' OR v_event.end_date < now() THEN
    RAISE EXCEPTION 'TEAM_NOT_MUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('reason', 'EventNotRecruiting')::text;
  END IF;

  RETURN v_team;
END;
$$;

-- 2. Update team listing
CREATE OR REPLACE FUNCTION update_team_listing(
  p_actor UUID,
  p_team UUID,
  p_patch JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
BEGIN
  v_team := lock_team_for_owner_mutation(p_actor, p_team);

  IF p_patch ? 'name' THEN
    v_team.name := (p_patch->>'name');
  END IF;

  IF p_patch ? 'pitch' THEN
    v_team.pitch := (p_patch->>'pitch');
  END IF;

  IF p_patch ? 'goal' THEN
    v_team.goal := (p_patch->>'goal');
  END IF;

  IF p_patch ? 'commitment_hours' THEN
    v_team.commitment_hours := (p_patch->>'commitment_hours')::NUMERIC;
  END IF;

  IF p_patch ? 'communication_link' THEN
    v_team.communication_link := (p_patch->>'communication_link');
  END IF;

  v_team.updated_at := now();

  UPDATE teams
  SET name = v_team.name,
      pitch = v_team.pitch,
      goal = v_team.goal,
      commitment_hours = v_team.commitment_hours,
      communication_link = v_team.communication_link,
      updated_at = v_team.updated_at
  WHERE id = p_team
  RETURNING * INTO v_team;

  RETURN jsonb_build_object('team', to_jsonb(v_team));
END;
$$;

-- 3. Add team vacancy with capacity check
CREATE OR REPLACE FUNCTION add_team_vacancy(
  p_actor UUID,
  p_team UUID,
  p_role VARCHAR,
  p_skills TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_max_team_size INTEGER;
  v_confirmed_count INTEGER;
  v_open_count INTEGER;
  v_vacancy team_vacancies%ROWTYPE;
BEGIN
  v_team := lock_team_for_owner_mutation(p_actor, p_team);

  SELECT COALESCE(max_team_size, 4)
  INTO v_max_team_size
  FROM events
  WHERE id = v_team.event_id;

  SELECT count(*)::INTEGER
  INTO v_confirmed_count
  FROM team_memberships
  WHERE team_id = p_team
    AND status = 'Confirmed';

  SELECT count(*)::INTEGER
  INTO v_open_count
  FROM team_vacancies
  WHERE team_id = p_team
    AND status = 'Open';

  IF (v_confirmed_count + v_open_count + 1) > v_max_team_size THEN
    RAISE EXCEPTION 'CAPACITY_EXCEEDED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'max', v_max_team_size,
              'confirmed', v_confirmed_count,
              'open', v_open_count
            )::text;
  END IF;

  INSERT INTO team_vacancies (
    team_id,
    role,
    skills,
    status
  ) VALUES (
    p_team,
    p_role,
    COALESCE(p_skills, '{}'),
    'Open'
  ) RETURNING * INTO v_vacancy;

  RETURN jsonb_build_object('vacancy', to_jsonb(v_vacancy));
END;
$$;

-- 4. Update team vacancy
CREATE OR REPLACE FUNCTION update_team_vacancy(
  p_actor UUID,
  p_team UUID,
  p_vacancy UUID,
  p_role VARCHAR,
  p_skills TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_vacancy team_vacancies%ROWTYPE;
BEGIN
  v_team := lock_team_for_owner_mutation(p_actor, p_team);

  SELECT *
  INTO v_vacancy
  FROM team_vacancies
  WHERE id = p_vacancy
    AND team_id = p_team;

  IF NOT FOUND OR v_vacancy.status <> 'Open' THEN
    RAISE EXCEPTION 'VACANCY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  UPDATE team_vacancies
  SET role = p_role,
      skills = COALESCE(p_skills, '{}'),
      updated_at = now()
  WHERE id = p_vacancy
  RETURNING * INTO v_vacancy;

  RETURN jsonb_build_object('vacancy', to_jsonb(v_vacancy));
END;
$$;

-- 5. Revoke from anon/public and grant only to service_role
REVOKE ALL ON FUNCTION lock_team_for_owner_mutation(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lock_team_for_owner_mutation(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION update_team_listing(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION update_team_listing(UUID, UUID, JSONB) TO service_role;

REVOKE ALL ON FUNCTION add_team_vacancy(UUID, UUID, VARCHAR, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION add_team_vacancy(UUID, UUID, VARCHAR, TEXT[]) TO service_role;

REVOKE ALL ON FUNCTION update_team_vacancy(UUID, UUID, UUID, VARCHAR, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION update_team_vacancy(UUID, UUID, UUID, VARCHAR, TEXT[]) TO service_role;
