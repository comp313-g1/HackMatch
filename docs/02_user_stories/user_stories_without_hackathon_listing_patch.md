# Patch Specification: Event-Free Architecture Alignment

## 1. Global Patch Rationale & Architectural Context

### 1.1 Architectural Pivot
HackMatch has transitioned from an event-scoped directory model to an **Event-Free Architecture**[cite: 4]:
- **Database & Constraint Compatibility:** To preserve PostgreSQL foreign keys and leverage existing stored procedures without breaking schema migrations, each team is bound upon creation to an auto-generated, isolated backend shadow event (`event_id`).
- **Platform-Wide Availability Pool:** Participant availability ("Looking for Team") is declared globally at the platform level rather than being scoped to a specific hackathon[cite: 6].
- **Multi-Team Participation Support:** A participant can only occupy one confirmed seat per team (`team_id`), but is free to join or create multiple distinct teams across the platform.

### 1.2 Purpose of This Patch File
For User Stories that already had their initial legacy tasks implemented under event-scoped assumptions, this document defines targeted **Refactoring Tasks (`-R1`, `-R2`, `-R3`)** to:
1. Preserve all reusable core business logic, database schemas, and React UI components.
2. Replace `team.event_id` query restrictions with platform-wide candidate pool and `team_id`-scoped membership checks.
3. Decouple API contracts and React components from `eventId` parameters and external event lifecycle gates.
4. Align Vitest unit and integration test suites with the event-free model.

---

## 2. US-015 Patch: Candidate Recommendations for Team Leads

### 2.1 Legacy State & Conflict Breakdown
- **Prior State:** The eight initial tasks for `US-015` (covering FR-043–045 scoring rules, 0–100 score bounds, deterministic tie-breaking, score contribution breakdowns without exposing internal IDs, and base React recommendation cards) were completed under legacy event-scoped assumptions.
- **Legacy Breakdowns:**
  1. **Empty Candidate Pools:** Queries filtering by `WHERE event_id = team.event_id` return zero candidates because every team possesses a distinct shadow `event_id`.
  2. **Overly Restrictive Exclusions:** Legacy logic excludes any candidate with a confirmed team for that event ID rather than checking only the requesting team (`team_id`).
  3. **Obsolete Contract Dependencies:** API routes and frontend recommendation panels still expect `eventId` parameters or evaluate external event lifecycle/date gates.

### 2.2 Target User Story Specification (US-015)
- **Feature Area:** Feature Area 4 — Rule-Based Matching[cite: 5]
- **Delivery Category:** Must-Have — MVP[cite: 5]
- **User/Role:** `PART` acting as Team Lead (`LEAD`)[cite: 5]
- **Story Statement:** 
  *"As a Team Lead, I want to view a ranked list of compatible available candidates from the platform pool for my team's open vacancy slots, so that I can invite teammates with complementary skills and matching commitments."*[cite: 5]
- **Description:** 
  Computes deterministic, explainable compatibility scores (0–100) comparing an open team vacancy slot against all active platform candidates who have `Looking for Team` enabled, excluding confirmed members of the requesting team (`team_id`)[cite: 5]. The workflow operates independently of external event listings or event identifiers.
- **Acceptance Criteria:**
  1. Only the authenticated owner (`LEAD`) of an active, unlocked team can request candidate recommendations for an open slot on their team[cite: 5].
  2. The scoring engine evaluates declared skills, primary role, goal alignment, and numeric commitment hours, handling missing optional fields gracefully[cite: 5].
  3. Compatibility scores are deterministic and bounded between 0 and 100; ties break deterministically by `display_handle` and then internal identifier. The response details component score contributions without exposing internal IDs[cite: 5].
  4. The candidate pool excludes suspended/inactive accounts, users not currently `Looking for Team`, and **confirmed members of the requesting team**.
  5. Team Leads can issue direct invitations from recommendation cards[cite: 5]. Empty candidate pools return a distinct empty state, and scoring runtime errors fall back to an unranked list of eligible candidates.

### 2.3 Disaggregated Refactoring Tasks Queue (US-015)

> **Execution Protocol:** Execute the following tasks sequentially. Ensure code and tests for each step are verified before moving forward.

#### Task `US-015-R1` (Backend Pool & Exclusion Refactor)
- **Title**: `Refactor US-015 candidate recommendation query and exclusions to platform-wide scope`
- **Description**: `Complete the task "Refactor US-015 candidate recommendation query and exclusions to platform-wide scope" for US-015. Update the recommendation repository/service and Express endpoint (GET /api/teams/:teamId/slots/:slotId/recommendations) so that it no longer restricts eligible candidates to the requesting team's shadow event_id. Instead, query all active, non-suspended participants who currently have Looking for Team enabled across the platform, and exclude only participants who are already confirmed members of the requesting team (team_id), preserving multi-team participation support.`

#### Task `US-015-R2` (API & Frontend Decoupling from Event ID)
- **Title**: `Remove eventId requirements from US-015 recommendation API contracts and React panel`
- **Description**: `Complete the task "Remove eventId requirements from US-015 recommendation API contracts and React panel" for US-015. Inspect and update the Express route/controller, client API helpers, and React recommendation components so that fetching, rendering, and inviting recommended candidates for an open vacancy slot require only teamId and slotId (no eventId query parameter, prop, or external event date/status gate), while preserving the existing 0–100 match breakdown badges, empty state, and unranked fallback state.`

#### Task `US-015-R3` (Vitest & Integration Test Alignment)
- **Title**: `Update US-015 Vitest unit and integration tests for platform-wide candidate matching`
- **Description**: `Complete the task "Update US-015 Vitest unit and integration tests for platform-wide candidate matching" for US-015. Update and expand the server and client test suites to verify that: (1) candidates with Looking for Team enabled are recommended regardless of shadow event_id, (2) confirmed members of the requesting team are excluded while members of other teams who re-enabled LFT remain eligible, and (3) deterministic 0–100 scoring, tie-breaking, non-owner 403 rejection, and unranked fallback states all pass.`

---

## 3. US-017 Patch: Issue a Team Invitation

### 3.1 Legacy State & Conflict Breakdown
- **Prior State:** The eight initial tasks for `US-017` (covering the PostgreSQL invitation model, owner-only Express endpoint, candidate/event/slot validation, one-pending-invitation-per-slot and per-invitee/team quotas, 48-hour expiry, cancellation endpoint with basic status alerts, React invite views, and initial Vitest suites) were completed under legacy event-scoped assumptions[cite: 5, 6].
- **Legacy Breakdowns:**
  1. **False-Negative Availability Rejections:** Legacy validation checks whether the invitee has `Looking for Team` enabled for `team.event_id`. Because each team holds a unique shadow `event_id`, no candidate's availability record matches the team's `event_id`, causing all invitation attempts to fail validation.
  2. **Event-Scoped Membership & Lifecycle Gates:** Legacy validation checks external event verification/date states and blocks candidates who belong to any team in the same event. Under the event-free model, validation must only verify that the requesting team is active/unlocked, the target slot is open, the invitee has platform-wide `Looking for Team` enabled, and the invitee is not already a confirmed member of the requesting team (`team_id`).
  3. **Obsolete Contract Dependencies:** API payloads, query parameters, and React invitation components that still require or pass `eventId` must be decoupled.

### 3.2 Target User Story Specification (US-017)
- **Feature Area:** Feature Area 5 — Invitations, Applications, and Rosters[cite: 5]
- **Delivery Category:** Must-Have — MVP[cite: 5]
- **User/Role:** `PART` acting as Team Lead (`LEAD`)[cite: 5]
- **Story Statement:** 
  *"As a Team Lead, I want to issue a direct invitation for a specific open vacancy slot to an available candidate, so that they can review my team and decide whether to join."*[cite: 5]
- **Description:** 
  Allows the owner of an active, unlocked team to send a slot-specific invitation to an available candidate from the platform pool[cite: 5]. Pending invitations expire after 48 hours and enforce strict one-per-slot and one-per-invitee-per-team quotas without relying on external event listings or event IDs[cite: 5, 6].
- **Acceptance Criteria:**
  1. Only the owner (`LEAD`) of an active, unlocked team can invite an active, non-suspended `PART` who currently has `Looking for Team` enabled platform-wide and is not already a confirmed member of that team (`team_id`)[cite: 5].
  2. Each `Pending` invitation expires exactly `48 hours` after issuance (or earlier if the target slot closes or the team locks); expired invitations cannot be accepted[cite: 5].
  3. At most one `Pending` invitation is permitted per open vacancy slot at any time, and at most one `Pending` invitation is permitted per invitee per team[cite: 6].
  4. The Team Lead can cancel a `Pending` invitation at any time before response to free the slot's invitation quota, and both parties see basic status alerts in their invitation views[cite: 5].

### 3.3 Disaggregated Refactoring Tasks Queue (US-017)

> **Execution Protocol:** Execute the following tasks sequentially. Ensure code and tests for each step are verified before moving forward.

#### Task `US-017-R1` (Backend Eligibility & Validation Refactor)
- **Title**: `Refactor US-017 invitation eligibility validation to platform-wide availability and team-scoped membership`
- **Description**: `Complete the task "Refactor US-017 invitation eligibility validation to platform-wide availability and team-scoped membership" for US-017. Update the invitation service, validator, and repository checks on POST /api/teams/:teamId/invitations so that issuing an invitation no longer requires the invitee's availability record to match the team's shadow event_id or gates on external event dates/statuses. Instead, verify that: (1) the requesting user is the owner of an active, unlocked team, (2) the target vacancy slot belongs to the team and is open, (3) the invitee is an active account with Looking for Team enabled platform-wide, and (4) the invitee is not already a confirmed member of the requesting team (team_id), while strictly preserving the 48-hour expiry and one-pending-invitation-per-slot and per-invitee/team quotas.`

#### Task `US-017-R2` (API & React UI Decoupling from Event ID)
- **Title**: `Remove eventId dependencies from US-017 invitation endpoints and React invitation controls`
- **Description**: `Complete the task "Remove eventId dependencies from US-017 invitation endpoints and React invitation controls" for US-017. Inspect and update the Express invitation routes/controllers (POST /api/teams/:teamId/invitations, GET /api/teams/:teamId/invitations, DELETE /api/invitations/:invitationId), client API helpers, and React invite form/outbound invitation list components so they operate solely with teamId, slotId, inviteeId, and invitationId without requiring or displaying eventId parameters or props, preserving loading, error, Pending/Expired/Canceled status alerts, and cancellation controls.`

#### Task `US-017-R3` (Vitest & Integration Test Alignment)
- **Title**: `Update US-017 Vitest unit and integration tests for event-free invitation issuance and quotas`
- **Description**: `Complete the task "Update US-017 Vitest unit and integration tests for event-free invitation issuance and quotas" for US-017. Update and expand the server and client test suites to verify that: (1) a Team Lead can invite a platform-wide LFT candidate even when the candidate has no availability row bound to the team's shadow event_id, (2) candidates already confirmed on the requesting team are rejected while members of other teams who have LFT enabled remain invitable, and (3) non-owner 403 rejection, one-pending-invite-per-slot/invitee quotas, 48-hour expiry, and invitation cancellation quota release all pass.`