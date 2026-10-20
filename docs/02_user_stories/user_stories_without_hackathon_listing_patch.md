# Patch Specification: Event-Free Architecture Alignment (US-015)

## 1. Patch Rationale & Background

### 1.1 Context and Prior State
The team previously completed the eight initial tasks outlined in the legacy specification for `US-015` (covering the core FR-043–045 scoring rules, 0–100 score bounds, deterministic tie-breaking, score contribution breakdowns without exposing internal IDs, and base React recommendation cards).

### 1.2 Architectural Pivot and Conflict Cause
Subsequently, HackMatch executed an architectural shift to an **Event-Free Model**:
- **Database & Constraint Compatibility:** To preserve PostgreSQL foreign keys and leverage existing stored procedures without complex migrations, each team is bound upon creation to an auto-generated, isolated backend shadow event (`event_id`).
- **Platform-Wide Availability Pool:** Participant availability ("Looking for Team") is declared globally at the platform level rather than being scoped to a specific hackathon.

### 1.3 Breakdown in Legacy US-015 Implementation
Retaining the legacy implementation creates critical operational issues:
1. **Empty Candidate Pools:** Queries filtering by `WHERE event_id = team.event_id` will always return zero candidates because every team now possesses a distinct shadow event ID.
2. **Overly Restrictive Exclusions:** The legacy logic excludes any candidate with an existing confirmed team for that event ID. The revised platform model allows participants to join or create multiple distinct teams across the platform.
3. **Obsolete Contract Dependencies:** The API routes and frontend recommendation panels still expect `eventId` parameters and evaluate external event lifecycle/date gates.

### 1.4 Objectives of This Patch
For this completed User Story, this patch **preserves all reusable core algorithm math, deterministic scoring logic, and UI components**, introducing only targeted refactoring tasks to:
- Re-scope the candidate query to the active platform-wide pool.
- Update exclusion logic to exclude only confirmed members of the requesting team.
- Decouple API contracts and React components from `eventId`.
- Align automated unit and integration tests.

---

## 2. Target User Story Specification

### Feature Area 4: Rule-Based Matching

#### US-015: Candidate Recommendations for Team Leads
- **Delivery Category**: Must-Have — MVP
- **User/Role**: `PART` acting as Team Lead (`LEAD`)
- **Story Statement**: 
  *"As a Team Lead, I want to view a ranked list of compatible available candidates from the platform pool for my team's open vacancy slots, so that I can invite teammates with complementary skills and matching commitments."*
- **Description**: 
  Computes deterministic, explainable compatibility scores (0–100) comparing an open team vacancy slot against all active platform candidates who have `Looking for Team` enabled, excluding confirmed members of the requesting team (`team_id`). The workflow operates independently of external event listings or event identifiers.
- **Acceptance Criteria**:
  1. Only the authenticated owner (`LEAD`) of an active, unlocked team can request candidate recommendations for an open slot on their team.
  2. The scoring engine evaluates declared skills, primary role, goal alignment, and numeric commitment hours, handling missing optional fields gracefully.
  3. Compatibility scores are deterministic and bounded between 0 and 100; ties break deterministically by `display_handle` and then internal identifier. The response details component score contributions without exposing internal IDs.
  4. The candidate pool excludes suspended/inactive accounts, users not currently `Looking for Team`, and **confirmed members of the requesting team**.
  5. Team Leads can issue direct invitations from recommendation cards. Empty candidate pools return a distinct empty state, and scoring runtime errors fall back to an unranked list of eligible candidates.

---

## 3. Disaggregated Refactoring Tasks Queue

> **Execution Protocol:** Execute the following tasks sequentially. Ensure code and tests for each step are verified before moving forward.

### Task `US-015-R1` (Backend Pool & Exclusion Refactor)
- **Title**: `Refactor US-015 candidate recommendation query and exclusions to platform-wide scope`
- **Description**: `Complete the task "Refactor US-015 candidate recommendation query and exclusions to platform-wide scope" for US-015. Update the recommendation repository/service and Express endpoint (GET /api/teams/:teamId/slots/:slotId/recommendations) so that it no longer restricts eligible candidates to the requesting team's shadow event_id. Instead, query all active, non-suspended participants who currently have Looking for Team enabled across the platform, and exclude only participants who are already confirmed members of the requesting team (team_id), preserving multi-team participation support.`

---

### Task `US-015-R2` (API & Frontend Decoupling from Event ID)
- **Title**: `Remove eventId requirements from US-015 recommendation API contracts and React panel`
- **Description**: `Complete the task "Remove eventId requirements from US-015 recommendation API contracts and React panel" for US-015. Inspect and update the Express route/controller, client API helpers, and React recommendation components so that fetching, rendering, and inviting recommended candidates for an open vacancy slot require only teamId and slotId (no eventId query parameter, prop, or external event date/status gate), while preserving the existing 0–100 match breakdown badges, empty state, and unranked fallback state.`

---

### Task `US-015-R3` (Vitest & Integration Test Alignment)
- **Title**: `Update US-015 Vitest unit and integration tests for platform-wide candidate matching`
- **Description**: `Complete the task "Update US-015 Vitest unit and integration tests for platform-wide candidate matching" for US-015. Update and expand the server and client test suites to verify that: (1) candidates with Looking for Team enabled are recommended regardless of shadow event_id, (2) confirmed members of the requesting team are excluded while members of other teams who re-enabled LFT remain eligible, and (3) deterministic 0–100 scoring, tie-breaking, non-owner 403 rejection, and unranked fallback states all pass.`