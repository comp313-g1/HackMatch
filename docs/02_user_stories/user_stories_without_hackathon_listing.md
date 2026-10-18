# HackMatch Event-Free Architecture: Remaining User Stories & Disaggregated Tasks

## 1. Architecture & Scope Baseline

### Completed User Stories (7 Stories)
- **US-001**: Participant Registration and Email Verification
- **US-002**: Federated OAuth Registration and Authentication
- **US-003**: User Login and Session Management
- **US-004**: Email-Based Login Two-Factor Authentication (2FA)
- **US-005**: Password Recovery for PART/ADMIN
- **US-006**: Participant Profile Management
- **US-012**: Create and Manage a Team Recruitment Listing *(Updated to support event-free team creation via backend shadow-event binding)*

### Deprecated User Stories (Removed — Event Directory & Verification)
- ~~**US-008**: Public Hackathon Discovery and Multi-Filter Search~~
- ~~**US-009**: Participant Hackathon Event Submission~~
- ~~**US-010**: Administrative Event Verification, Correction, and Lifecycle Management~~

### Core Event-Free Business Rules
1. **Platform-Wide Availability (`US-011`)**: Participant "Looking for Team" status, desired role, commitment hours (`0–168`), and goal (`Learning`, `Project Completion`, `Competitive`) are declared at the platform level without requiring an `eventId` in the UI or API payload.
2. **Global Team Discovery & Matching (`US-013`, `US-014`, `US-015`)**: Open team vacancies and candidate recommendations operate across the active platform pool rather than filtering by a specific hackathon event.
3. **Per-Team Membership Uniqueness (`US-017`–`US-020`)**: Because each team created under `US-012` is bound to an auto-generated shadow `event_id` under the hood, a participant can only hold one confirmed membership per team while remaining free to join or create multiple distinct teams across the platform.
4. **Default Team Size Limit (`US-012`, `US-022`)**: Maximum team capacity defaults to `4` members (minimum `2` confirmed members required to lock a roster).

---

## 2. Must-Have MVP User Stories & Disaggregated Tasks (10 Stories)

### US-011: Declare Platform Availability and Looking-for-Team Status
- **Delivery Category**: Must-Have — MVP
- **User/Role**: `PART`
- **Story Statement**: *"As a Participant, I want to declare my platform-wide availability and state my desired role, commitment hours, and project goal, so that Team Leads can discover me as an available candidate without selecting a specific event."*
- **Description**: Participants configure their Looking-for-Team (LFT) status and preferences globally. No `eventId` is required from the client. Confirmed placement into a team automatically deactivates the participant's active LFT toggle (which can be manually re-enabled if the participant wishes to join additional teams).
- **Acceptance Criteria**:
  1. A verified `PART` can toggle `Looking for Team` on or off at the platform level without supplying an `eventId`.
  2. The availability form captures desired role (`Frontend`, `Backend`, `Mobile`, `AI/ML`, `UI/UX`, `Pitch`), numeric weekly commitment hours (`0–168`), and goal (`Learning`, `Project Completion`, or `Competitive`).
  3. Authenticated `PART` users can inspect eligible available candidates; unauthenticated `VISITOR` users cannot access candidate availability cards.
  4. Creating a team or confirming membership via invitation acceptance or application approval automatically sets the participant's `Looking for Team` flag to `false`.

#### Disaggregated Tasks for US-011
1. **Task `US-011-T1`**
   - **Title**: `Create Express platform-wide availability read and update endpoints`
   - **Description**: `Complete the task "Create Express platform-wide availability read and update endpoints" for US-011. Implement the Node.js/Express API and PostgreSQL/Supabase repository methods (GET /api/availability/me and PUT /api/availability/me) without requiring an eventId parameter from the client. Include server-side validation for desired role, numeric commitment hours (0–168), and goal enums, enforce verified PART authorization, preserve existing data on validation errors, and cover user-visible success and failure outcomes.`
2. **Task `US-011-T2`**
   - **Title**: `Automatically clear Looking-for-Team status upon team creation or confirmed join`
   - **Description**: `Complete the task "Automatically clear Looking-for-Team status upon team creation or confirmed join" for US-011. Implement the supporting application behavior across the Node.js/Express and PostgreSQL/Supabase layers so that creating a team or confirming membership atomically deactivates the participant's Looking-for-Team status while allowing manual re-activation for multi-team participation.`
3. **Task `US-011-T3`**
   - **Title**: `Build React Looking-for-Team toggle and availability preferences form`
   - **Description**: `Complete the task "Build React Looking-for-Team toggle and availability preferences form" for US-011. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states without any event selector. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes.`
4. **Task `US-011-T4`**
   - **Title**: `Add Vitest and integration tests for platform availability and privacy rules`
   - **Description**: `Complete the task "Add Vitest and integration tests for platform availability and privacy rules" for US-011. Verify the happy path, invalid input, unauthorized visitor access rejection, boundary conditions (0–168 commitment hours), and automatic availability deactivation with repeatable evidence.`

---

### US-013: Browse and Filter Open Team Vacancies
- **Delivery Category**: Must-Have — MVP
- **User/Role**: `PART` / `VISITOR`
- **Story Statement**: *"As a Participant or Visitor, I want to browse and filter open team vacancy slots across the platform without selecting an event first, so that I can identify active teams matching my technical stack and project goals."*
- **Description**: Displays a unified platform-wide recruitment board of active, unlocked teams that have at least one open vacancy slot. Visitors see anonymized team previews; authenticated Participants see full team pitches, member handles/roles, and apply controls.
- **Acceptance Criteria**:
  1. The recruitment board lists all active, unlocked, non-disbanded, and non-hidden teams with at least one open vacancy slot across the platform.
  2. Users can combine skill tag, vacancy role, team goal (`Learning`, `Project Completion`, `Competitive`), and minimum open slot count filters.
  3. Authenticated `PART` users see team pitch, confirmed member display handles/roles, and vacancy requirements; `VISITOR` users see anonymized previews and sign-in prompts.
  4. Clicking "Apply" on an open slot triggers `US-018` for authenticated `PART` users; when no teams match the active filters, a clear empty state with a "Reset Filters" action is displayed.

#### Disaggregated Tasks for US-013
1. **Task `US-013-T1`**
   - **Title**: `Create Express open team vacancies browse and multi-filter endpoint`
   - **Description**: `Complete the task "Create Express open team vacancies browse and multi-filter endpoint" for US-013. Implement GET /api/teams across the Node.js/Express and PostgreSQL/Supabase layers to return active, unlocked teams with open vacancy slots across the platform without requiring an eventId filter. Support combinable query filters for skill tags, role, goal, and open slot count.`
2. **Task `US-013-T2`**
   - **Title**: `Enforce visitor anonymization and authenticated PART field projection on team listings`
   - **Description**: `Complete the task "Enforce visitor anonymization and authenticated PART field projection on team listings" for US-013. Implement server-side response projection so unauthenticated visitors receive anonymized team previews without member handles or communication links, while authenticated PART users receive permitted team and member details.`
3. **Task `US-013-T3`**
   - **Title**: `Build React platform team discovery board, filter bar, and empty state components`
   - **Description**: `Complete the task "Build React platform team discovery board, filter bar, and empty state components" for US-013. Implement the React (Vite) frontend behavior including combinable skill/role/goal/slot filters, visitor sign-in prompts, apply action triggers, and a filter-reset empty state.`
4. **Task `US-013-T4`**
   - **Title**: `Add Vitest and integration tests for team vacancy filtering and visitor privacy`
   - **Description**: `Complete the task "Add Vitest and integration tests for team vacancy filtering and visitor privacy" for US-013. Verify multi-filter combinations, exclusion of locked/disbanded/full teams, visitor anonymization, and boundary conditions with repeatable evidence.`

---

### US-015: Candidate Recommendations for Team Leads
- **Delivery Category**: Must-Have — MVP
- **User/Role**: `PART` acting as Team Lead (`LEAD`)
- **Story Statement**: *"As a Team Lead, I want to view a ranked list of compatible available candidates from the platform pool for my team's open vacancy slots, so that I can invite teammates with complementary skills and matching commitments."*
- **Description**: Computes deterministic, explainable rule-based compatibility scores (`0–100`) comparing a specific open team vacancy slot against all active platform candidates who have `Looking for Team` enabled and are not already confirmed members of that team.
- **Acceptance Criteria**:
  1. Only the authenticated owner (`LEAD`) of an active, unlocked team can request candidate recommendations for an open slot on their team.
  2. The scoring engine evaluates declared skills, primary role, goal alignment, and numeric commitment hours, handling missing optional fields gracefully.
  3. Compatibility scores are deterministic and bounded between `0` and `100`; ties break deterministically by `display_handle` and then internal identifier, and the response explains component score contributions without exposing internal IDs.
  4. The candidate pool excludes suspended/inactive accounts, users not currently `Looking for Team`, and users already confirmed on the requesting team.
  5. Team Leads can issue direct invitations (`US-017`) from recommendation cards; empty candidate pools return a clear no-results state, and scoring errors fall back to an unranked eligible candidate list.

#### Disaggregated Tasks for US-015
1. **Task `US-015-T1`**
   - **Title**: `Implement deterministic rule-based candidate compatibility scoring service`
   - **Description**: `Complete the task "Implement deterministic rule-based candidate compatibility scoring service" for US-015. Implement the scoring engine in server/src/services/ to compute bounded 0–100 compatibility scores and human-readable score breakdowns based on skill overlap, role match, goal alignment, and commitment hours, with deterministic tie-breaking by display handle.`
2. **Task `US-015-T2`**
   - **Title**: `Create Express slot recommendation endpoint with owner authorization and unranked fallback`
   - **Description**: `Complete the task "Create Express slot recommendation endpoint with owner authorization and unranked fallback" for US-015. Implement GET /api/teams/:teamId/slots/:slotId/recommendations with Team Lead ownership verification, excluding inactive users, non-LFT users, and existing members of the team, and falling back to an unranked eligible list if scoring fails.`
3. **Task `US-015-T3`**
   - **Title**: `Build React recommended candidates panel with match breakdown badges`
   - **Description**: `Complete the task "Build React recommended candidates panel with match breakdown badges" for US-015. Implement the React (Vite) frontend behavior displaying ranked candidate cards, 0–100 match percentage badges, component score explanations, empty pool states, and direct Invite triggers.`
4. **Task `US-015-T4`**
   - **Title**: `Add Vitest unit and route tests for candidate matching, tie-breaking, and fallbacks`
   - **Description**: `Complete the task "Add Vitest unit and route tests for candidate matching, tie-breaking, and fallbacks" for US-015. Verify deterministic 0–100 scoring, missing-input handling, tie-breaker ordering, non-owner 403 rejection, and unranked fallback behavior with repeatable evidence.`

---

### US-017: Issue a Team Invitation
- **Delivery Category**: Must-Have — MVP
- **User/Role**: `PART` acting as Team Lead (`LEAD`)
- **Story Statement**: *"As a Team Lead, I want to issue a direct invitation for a specific open vacancy slot to an available candidate, so that they can review my team and decide whether to join."*
- **Description**: Allows the owner of an unlocked team to send a slot-specific invitation to an available candidate. Pending invitations expire after 48 hours and enforce strict one-per-slot and one-per-invitee-per-team quotas.
- **Acceptance Criteria**:
  1. Only the owner (`LEAD`) of an active, unlocked team can invite an available `PART` who is not already a confirmed member of that team.
  2. Each `Pending` invitation expires exactly `48 hours` after issuance (or earlier if the target slot closes or the team locks); expired invitations cannot be accepted.
  3. At most one `Pending` invitation is permitted per open vacancy slot at any time, and at most one `Pending` invitation is permitted per invitee per team.
  4. The Team Lead can cancel a `Pending` invitation at any time before response to free the slot's invitation quota, and both parties see basic status alerts in their invitation views.

#### Disaggregated Tasks for US-017
1. **Task `US-017-T1`**
   - **Title**: `Create Express team invitation issuance and cancellation endpoints with quota enforcement`
   - **Description**: `Complete the task "Create Express team invitation issuance and cancellation endpoints with quota enforcement" for US-017. Implement POST /api/teams/:teamId/invitations, GET /api/teams/:teamId/invitations, and DELETE /api/invitations/:invitationId across the Node.js/Express and PostgreSQL/Supabase layers. Enforce one pending invitation per slot, one pending invitation per invitee/team, and a 48-hour expiration timestamp.`
2. **Task `US-017-T2`**
   - **Title**: `Build React Team Lead invitation issuance controls and outbound invitations list`
   - **Description**: `Complete the task "Build React Team Lead invitation issuance controls and outbound invitations list" for US-017. Implement the React (Vite) frontend behavior allowing Team Leads to send slot-specific invitations, inspect Pending/Expired/Canceled invitation statuses, and cancel pending invitations.`
3. **Task `US-017-T3`**
   - **Title**: `Add Vitest and integration tests for invitation quotas, 48-hour expiry, and cancellation`
   - **Description**: `Complete the task "Add Vitest and integration tests for invitation quotas, 48-hour expiry, and cancellation" for US-017. Verify duplicate slot/invitee rejection, non-owner 403 rejection, 48-hour TTL enforcement, and quota release upon cancellation with repeatable evidence.`

---

### US-018: Apply to Join a Team Vacancy
- **Delivery Category**: Must-Have — MVP
- **User/Role**: `PART`
- **Story Statement**: *"As a Participant, I want to submit an application to an open team vacancy slot with a brief pitch message, so that the Team Lead can review my profile and consider me for membership."*
- **Description**: Enables verified Participants to proactively apply to open vacancy slots on active teams. Enforces an atomic platform-wide cap of at most 3 concurrent `Pending Review` applications per participant to prevent spam.
- **Acceptance Criteria**:
  1. A verified `PART` who is not already a confirmed member of the target team can apply to an open vacancy slot on an active, unlocked team.
  2. Applications attach permitted profile fields and an optional message of at most `250 characters`; duplicate pending applications to the same team are rejected.
  3. A participant can hold at most `3` concurrent `Pending Review` applications across the platform at any time, validated atomically.
  4. Applicants can view their submitted applications and withdraw a `Pending Review` application before the Team Lead commits a decision.

#### Disaggregated Tasks for US-018
1. **Task `US-018-T1`**
   - **Title**: `Create Express team vacancy application submission, list, and withdrawal endpoints`
   - **Description**: `Complete the task "Create Express team vacancy application submission, list, and withdrawal endpoints" for US-018. Implement POST /api/teams/:teamId/applications, GET /api/applications/mine, and POST /api/applications/:applicationId/withdraw with atomic validation of the 3-pending-application cap, duplicate team application rejection, and 250-character message validation.`
2. **Task `US-018-T2`**
   - **Title**: `Build React Apply-to-Slot modal and My Applications management view`
   - **Description**: `Complete the task "Build React Apply-to-Slot modal and My Applications management view" for US-018. Implement the React (Vite) frontend behavior with a 250-character pitch input, loading/error states, 3-application limit feedback, and withdrawal buttons.`
3. **Task `US-018-T3`**
   - **Title**: `Add Vitest and integration tests for application rate limits, duplicate blocks, and withdrawal`
   - **Description**: `Complete the task "Add Vitest and integration tests for application rate limits, duplicate blocks, and withdrawal" for US-018. Verify the 3-pending-application cap (HTTP 422 on 4th pending application), 250-character boundary, duplicate team application block, and withdrawal state transitions with repeatable evidence.`

---

### US-019: Respond to a Team Invitation
- **Delivery Category**: Must-Have — MVP
- **User/Role**: `PART`
- **Story Statement**: *"As an invited Participant, I want to accept or decline a team invitation and retain the ability to leave an unlocked team, so that I can confirm my team placement or keep looking."*
- **Description**: Handles atomic invitation acceptance, decline, and pre-lock voluntary team exit. Accepting an invitation fills the vacancy slot, confirms membership, deactivates the user's LFT toggle, and cancels competing requests for that slot (or for the entire team if the roster reaches the 4-member cap).
- **Acceptance Criteria**:
  1. Only the addressed `PART` invitee can respond to a non-expired `Pending` invitation and inspect permitted team details.
  2. Accepting an invitation atomically verifies active account status, unlocked team state, open vacancy slot, team capacity (`< 4`), and no existing membership in that team; concurrent conflicting joins yield one success and one clear conflict rejection (`409`).
  3. Successful acceptance fills the slot, confirms team membership, sets the invitee's `Looking for Team` status to `false`, cancels any other pending applications/invitations for that filled slot, and—if the team reaches 4 members—cancels all remaining pending invitations and applications to that team.
  4. Declining an invitation marks only that invitation as `Declined` and alerts the Team Lead without altering the invitee's availability status.
  5. Before roster lock, any confirmed non-owner member (admitted via invitation or application) can leave the team, reopening capacity and alerting the Team Lead without reviving previously canceled requests.

#### Disaggregated Tasks for US-019
1. **Task `US-019-T1`**
   - **Title**: `Implement atomic invitation acceptance, slot/team auto-cancellation, and member leave transactions`
   - **Description**: `Complete the task "Implement atomic invitation acceptance, slot/team auto-cancellation, and member leave transactions" for US-019. Implement PostgreSQL/Supabase transactional logic and Express endpoints (POST /api/invitations/:invitationId/respond, GET /api/invitations/mine, and POST /api/teams/:teamId/leave) enforcing capacity limits, race-condition safety, automatic cancellation of competing slot/team requests, and pre-lock non-owner leave.`
2. **Task `US-019-T2`**
   - **Title**: `Build React inbound invitations view and non-owner Leave Team controls`
   - **Description**: `Complete the task "Build React inbound invitations view and non-owner Leave Team controls" for US-019. Implement the React (Vite) frontend behavior allowing invitees to inspect team offers, accept or decline invitations, and leave an unlocked team as a non-owner member.`
3. **Task `US-019-T3`**
   - **Title**: `Add Vitest and concurrency tests for invitation acceptance, auto-cancel cascades, and leaving`
   - **Description**: `Complete the task "Add Vitest and concurrency tests for invitation acceptance, auto-cancel cascades, and leaving" for US-019. Verify expired invitation rejection, concurrent last-slot acceptance conflict handling, full-team request auto-cancellation, and locked-team leave rejection with repeatable evidence.`

---

### US-020: Team Lead Approves or Declines an Application
- **Delivery Category**: Must-Have — MVP
- **User/Role**: `PART` acting as Team Lead (`LEAD`)
- **Story Statement**: *"As a Team Lead, I want to review incoming applications for my team's vacancy slots and approve or decline candidates, so that I can select the best teammates for our roster."*
- **Description**: Allows the Team Lead to review pending applications and commit an atomic approval or decline decision using the same capacity and slot-cleanup invariants as invitation acceptance.
- **Acceptance Criteria**:
  1. Only the team owner (`LEAD`) can inspect and decide `Pending Review` applications for their team, viewing permitted candidate profile fields and pitch messages.
  2. Approving an application atomically checks active accounts, unlocked team state, open slot, team capacity (`< 4`), and no duplicate membership in that team.
  3. Successful approval confirms membership, fills the target vacancy slot, sets the applicant's `Looking for Team` flag to `false`, cancels remaining requests for the filled slot, and—when the team reaches 4 members—cancels all remaining pending invitations and applications to that team.
  4. Declining an application marks it `Declined` and leaves team membership and vacancy slots unchanged; repeated or stale decisions return a clear conflict without duplicate writes.

#### Disaggregated Tasks for US-020
1. **Task `US-020-T1`**
   - **Title**: `Create Express Team Lead application review and atomic approval/decline endpoints`
   - **Description**: `Complete the task "Create Express Team Lead application review and atomic approval/decline endpoints" for US-020. Implement GET /api/teams/:teamId/applications and POST /api/applications/:applicationId/decide across the Node.js/Express and PostgreSQL/Supabase layers, enforcing owner authorization, atomic slot fulfillment, and automatic cancellation of competing slot and full-team requests.`
2. **Task `US-020-T2`**
   - **Title**: `Build React Team Lead application review queue and decision controls`
   - **Description**: `Complete the task "Build React Team Lead application review queue and decision controls" for US-020. Implement the React (Vite) frontend behavior displaying applicant profile summaries, skill tags, pitch messages, and Approve/Decline action buttons with loading and conflict feedback.`
3. **Task `US-020-T3`**
   - **Title**: `Add Vitest and integration tests for application approval, full-team auto-cancel, and idempotency`
   - **Description**: `Complete the task "Add Vitest and integration tests for application approval, full-team auto-cancel, and idempotency" for US-020. Verify non-owner 403 rejection, atomic slot fill, full-team pending request cancellation, and stale/duplicate decision handling with repeatable evidence.`

---

### US-022: Confirm and Lock a Team Roster
- **Delivery Category**: Must-Have — MVP
- **User/Role**: `PART` acting as Team Lead (`LEAD`)
- **Story Statement**: *"As a Team Lead, I want to confirm and lock my team's roster once we have at least 2 confirmed members, so that our membership is finalized and further roster mutations are frozen."*
- **Description**: Finalizes an unlocked team roster when confirmed membership is between `2` and `4` members. Locking is irreversible, cancels all remaining open recruitment requests for the team, and freezes all roster and vacancy mutations.
- **Acceptance Criteria**:
  1. Only the team owner (`LEAD`) can lock an active, unlocked team roster that has between `2` and `4` confirmed members.
  2. The lock operation executes atomically with join/leave operations and records the server-side lock timestamp (`locked_at`).
  3. Locking immediately cancels any remaining pending invitations and applications for the team and permanently rejects subsequent invitations, applications, member exits, member removals, vacancy edits, or team disbanding.
  4. Confirmed team members see the locked roster state and server lock timestamp on the team view.

#### Disaggregated Tasks for US-022
1. **Task `US-022-T1`**
   - **Title**: `Create Express atomic team roster lock endpoint and enforce post-lock mutation guards`
   - **Description**: `Complete the task "Create Express atomic team roster lock endpoint and enforce post-lock mutation guards" for US-022. Implement POST /api/teams/:teamId/lock verifying owner permissions and 2–4 confirmed members, recording locked_at, canceling remaining pending requests, and rejecting any post-lock roster/vacancy/disband mutations with HTTP 409.`
2. **Task `US-022-T2`**
   - **Title**: `Build React Confirm & Lock Roster confirmation modal and locked roster badge state`
   - **Description**: `Complete the task "Build React Confirm & Lock Roster confirmation modal and locked roster badge state" for US-022. Implement the React (Vite) frontend behavior enabling the lock action when confirmed members >= 2, rendering a confirmation modal, and freezing edit/recruitment controls once locked.`
3. **Task `US-022-T3`**
   - **Title**: `Add Vitest and integration tests for roster locking, minimum size checks, and post-lock guards`
   - **Description**: `Complete the task "Add Vitest and integration tests for roster locking, minimum size checks, and post-lock guards" for US-022. Verify rejection when a team has only 1 member, atomic cancellation of open requests on lock, and rejection of all post-lock mutations with repeatable evidence.`

---

### US-026: Administrative Content Moderation and Safety Queue
- **Delivery Category**: Must-Have — MVP
- **User/Role**: `ADMIN`
- **Story Statement**: *"As a Platform Administrator, I want to review flagged team listings, participant profiles, and suspicious external links in a moderation queue, so that the platform remains safe, compliant, and free of phishing threats."*
- **Description**: Provides `ADMIN` users with an inspection and moderation queue for team listings and participant profiles. Administrators can open moderation cases, dismiss cases, redact offensive text, issue warnings, disable malicious external URLs, or hide non-compliant team listings while recording immutable action logs.
- **Acceptance Criteria**:
  1. Only authenticated `ADMIN` users can view the moderation queue or create moderation cases specifying target (`team` or `profile`), reason, and timestamp, ordered newest first.
  2. `ADMIN` can dismiss a case, redact offending text, record/send a warning, disable a malicious external URL, or hide a team listing from discovery; every decision requires a non-empty reason and creates an administrative action record.
  3. Hidden team listings are excluded from public and participant discovery boards, while the team owner can see the moderation status.
  4. Action records store actor ID, target type/ID, safe state summary, reason, outcome, and UTC timestamp without exposing user credentials or private team workspace notes.
  5. `PART` and `VISITOR` users are strictly denied access (`401`/`403`) to all moderation endpoints and UI views.

#### Disaggregated Tasks for US-026
1. **Task `US-026-T1`**
   - **Title**: `Create moderation cases and admin action logs schema, repository, and Express endpoints`
   - **Description**: `Complete the task "Create moderation cases and admin action logs schema, repository, and Express endpoints" for US-026. Implement the PostgreSQL/Supabase schema and ADMIN-only Express routes (GET /api/admin/moderation/cases, POST /api/admin/moderation/cases, POST /api/admin/moderation/cases/:caseId/decide) supporting dismiss, text redaction, warning, malicious URL disabling, and listing hiding with mandatory reason logging.`
2. **Task `US-026-T2`**
   - **Title**: `Build React Administrator content moderation queue and enforcement action panel`
   - **Description**: `Complete the task "Build React Administrator content moderation queue and enforcement action panel" for US-026. Implement the React (Vite) frontend behavior for ADMIN users to inspect moderation cases, enter mandatory decision reasons, and execute moderation actions.`
3. **Task `US-026-T3`**
   - **Title**: `Add Vitest and integration tests for ADMIN moderation RBAC, URL disabling, and action logging`
   - **Description**: `Complete the task "Add Vitest and integration tests for ADMIN moderation RBAC, URL disabling, and action logging" for US-026. Verify 403 rejection for PART/VISITOR roles, exclusion of hidden teams from discovery, mandatory reason validation, and audit record creation with repeatable evidence.`

---

### US-027: Administrative Account Management and Enforcement
- **Delivery Category**: Must-Have — MVP
- **User/Role**: `ADMIN`
- **Story Statement**: *"As a Platform Administrator, I want to suspend non-compliant accounts and process verified account deletion requests, so that bad actors cannot harass students or disrupt team formation."*
- **Description**: Enables `ADMIN` users to inspect account metadata, suspend or reactivate accounts, and execute privacy-compliant PII deletion/pseudonymization while recording administrative action logs.
- **Acceptance Criteria**:
  1. Only `ADMIN` users can inspect account identifiers, roles, account status, and associated listings; passwords, OTP codes, and private team workspace notes are never exposed.
  2. Suspending an account immediately revokes active Firebase refresh tokens/sessions, blocks sign-in, cancels the user's pending applications and incoming invitations, hides their profile and LFT availability, and pauses recruitment on any unlocked team they own (canceling outgoing pending invitations).
  3. Processing an ownership-verified account deletion request erases live personal identifiable information (PII) and pseudonymizes historical locked-team memberships; an owner of an unlocked team must disband before deletion.
  4. Every administrative account enforcement action requires a reason and records actor ID, target account ID, reason, outcome, and UTC timestamp; non-`ADMIN` users cannot invoke these controls.

#### Disaggregated Tasks for US-027
1. **Task `US-027-T1`**
   - **Title**: `Create Express ADMIN account inspection, suspension cascade, and PII pseudonymization endpoints`
   - **Description**: `Complete the task "Create Express ADMIN account inspection, suspension cascade, and PII pseudonymization endpoints" for US-027. Implement GET /api/admin/accounts, POST /api/admin/accounts/:accountId/suspend, and POST /api/admin/accounts/:accountId/delete with Firebase token revocation, atomic cancellation of pending invitations/applications, profile hiding, PII erasure/pseudonymization, and admin action logging.`
2. **Task `US-027-T2`**
   - **Title**: `Build React Administrator account management and enforcement view`
   - **Description**: `Complete the task "Build React Administrator account management and enforcement view" for US-027. Implement the React (Vite) frontend behavior allowing ADMIN users to search/inspect accounts, review account status, and trigger suspension or verified deletion with mandatory reason confirmation.`
3. **Task `US-027-T3`**
   - **Title**: `Add Vitest and integration tests for account suspension cascades, token revocation, and PII deletion`
   - **Description**: `Complete the task "Add Vitest and integration tests for account suspension cascades, token revocation, and PII deletion" for US-027. Verify suspended user session blocking, pending recruitment cleanup, locked-team membership pseudonymization, and non-ADMIN 403 rejection with repeatable evidence.`

---

## 3. Should-Have Post-MVP User Stories & Disaggregated Tasks (7 Stories)

### US-007: Participant Hackathon History and Portfolio Records
- **Delivery Category**: Should-Have — early post-MVP
- **User/Role**: `PART`
- **Story Statement**: *"As a Participant, I want to record past hackathons and project links on my profile, so that Team Leads can review my self-declared experience tier."*
- **Description**: Allows participants to add free-text past hackathon history entries (hackathon name, date, role, project title, and HTTPS project URL) and automatically computes a self-reported experience badge (`Beginner` for 0 records, `Competitor` for 1–3, `Veteran` for 4+).
- **Disaggregated Tasks**:
  1. **Task `US-007-T1` — Title**: `Create Express hackathon history CRUD endpoints and self-reported experience badge calculator`
     - **Description**: `Implement GET/POST/PUT/DELETE /api/profiles/me/history with HTTPS project URL validation and automatic calculation of Beginner (0), Competitor (1–3), and Veteran (4+) badges.`
  2. **Task `US-007-T2` — Title**: `Build React hackathon history editor and self-reported experience badge components`
     - **Description**: `Implement the React UI for adding, editing, and removing past hackathon entries and displaying the self-reported experience badge on profile and candidate views.`
  3. **Task `US-007-T3` — Title**: `Add Vitest tests for hackathon history validation, badge recalculation, and visitor privacy`
     - **Description**: `Verify HTTPS URL enforcement, badge tier transitions (0, 1–3, 4+), owner-only mutation rules, and visitor access restriction.`

---

### US-014: Advanced Candidate Directory Search and Filter for Team Leads
- **Delivery Category**: Should-Have — early post-MVP
- **User/Role**: `PART` acting as Team Lead (`LEAD`)
- **Story Statement**: *"As a Team Lead, I want to manually search and filter the platform-wide available candidate pool using skill combinations, roles, commitment hours, and experience tiers, so that I can discover candidates who fit our vacancy needs."*
- **Description**: Provides active Team Leads with a manual multi-filter candidate directory across all users currently `Looking for Team`, supporting `AND`/`OR` skill tag matching, primary role, commitment hours, and `US-007` experience badges.
- **Disaggregated Tasks**:
  1. **Task `US-014-T1` — Title**: `Create Express advanced candidate directory search endpoint with AND/OR skill filtering`
     - **Description**: `Implement GET /api/candidates for active Team Leads to filter platform-wide LFT candidates by skills (AND/OR mode), primary role, commitment hours, and experience badge while excluding existing members of the lead's team.`
  2. **Task `US-014-T2` — Title**: `Build React candidate directory search and multi-filter panel for Team Leads`
     - **Description**: `Implement the React candidate search interface with AND/OR skill toggles, role/commitment/badge filters, candidate profile modal inspection, and direct Invite buttons.`
  3. **Task `US-014-T3` — Title**: `Add Vitest tests for AND/OR candidate skill filtering and Team Lead authorization`
     - **Description**: `Verify AND vs. OR skill filter accuracy, exclusion of non-LFT users, and 403 rejection for users who do not own an active team.`

---

### US-021: In-App Notification Center and Real-Time Recruitment Alerts
- **Delivery Category**: Should-Have — early post-MVP
- **User/Role**: `PART` (including `PART` acting as `LEAD`)
- **Story Statement**: *"As an active user, I want an in-app notification center that alerts me to invitations, applications, and roster decisions, so that I can take timely action."*
- **Description**: Adds a global navigation notification bell with an unread badge counter, dropdown alert feed (Inbound Invitations, Applications Received, Approval/Decline Decisions, Roster Lock Confirmation), direct action navigation, and mark-as-read controls.
- **Disaggregated Tasks**:
  1. **Task `US-021-T1` — Title**: `Create Express notification list, unread count, and mark-as-read endpoints`
     - **Description**: `Implement GET /api/notifications, PATCH /api/notifications/:id/read, and POST /api/notifications/read-all scoped strictly to the authenticated user.`
  2. **Task `US-021-T2` — Title**: `Build React navigation notification bell, unread badge, and alert dropdown feed`
     - **Description**: `Implement the notification bell component in the header bar with unread count badge, clickable alert items navigating to the target team/invitation view, and mark-all-as-read support.`
  3. **Task `US-021-T3` — Title**: `Add Vitest tests for notification delivery, read-state transitions, and cross-user isolation`
     - **Description**: `Verify unread counter accuracy, individual and bulk mark-as-read updates, and strict cross-account notification privacy.`

---

### US-023: Team Private Coordination Workspace
- **Delivery Category**: Should-Have — early post-MVP
- **User/Role**: `PART` (confirmed member of a locked team, including the owner)
- **Story Statement**: *"As a confirmed member of a locked team, I want to access a private team workspace with shared communication links, project concept notes, and teammate contacts, so that we can coordinate our project effectively."*
- **Description**: Grants confirmed members of a locked team exclusive access to a private workspace displaying teammate shared contact handles, owner-managed HTTPS external tool links, and a shared Markdown note with optimistic concurrency control.
- **Disaggregated Tasks**:
  1. **Task `US-023-T1` — Title**: `Create Express private workspace endpoints with locked-member authorization and optimistic note locking`
     - **Description**: `Implement GET /api/teams/:teamId/workspace, PUT /api/teams/:teamId/workspace/links (owner only, HTTPS validated), and PUT /api/teams/:teamId/workspace/note (all confirmed members, rejecting stale revision numbers with HTTP 409), denying visitors, non-members, and non-member ADMINs with HTTP 403.`
  2. **Task `US-023-T2` — Title**: `Build React private team workspace view with shared Markdown editor and teammate contact cards`
     - **Description**: `Implement the React workspace screen showing confirmed teammate shared contact handles, HTTPS tool links, and a collaborative Markdown note editor with revision history and stale-save conflict alerts.`
  3. **Task `US-023-T3` — Title**: `Add Vitest tests for workspace 403 access boundaries and concurrent note edit conflict detection`
     - **Description**: `Verify 403 denial for unlocked teams, non-members, and ADMINs, non-HTTPS link rejection, and 409 conflict rejection on stale note revisions.`

---

### US-024: Export Team Manifest and Check-In Verification Card
- **Delivery Category**: Should-Have — early post-MVP
- **User/Role**: `PART` (confirmed member of a locked team, including the owner)
- **Story Statement**: *"As a confirmed member of a locked team, I want to export our locked roster record as a printable card or JSON manifest with an integrity checksum, so that we can share consistent team information."*
- **Description**: Allows confirmed members of a locked team to export a canonical JSON manifest and printable HTML/PDF check-in verification card containing team name, server lock timestamp, member display names, institutions, portfolio links, roles, and a deterministic SHA-256 snapshot checksum (excluding private emails and private contact handles).
- **Disaggregated Tasks**:
  1. **Task `US-024-T1` — Title**: `Create Express locked team manifest export endpoint with canonical SHA-256 checksum generation`
     - **Description**: `Implement GET /api/teams/:teamId/manifest for confirmed members of locked teams, serializing permitted roster fields in canonical order, computing a deterministic SHA-256 checksum, and excluding account emails and private contact handles.`
  2. **Task `US-024-T2` — Title**: `Build React printable team verification card and JSON manifest download controls`
     - **Description**: `Implement the React manifest preview card, print-friendly layout trigger, checksum integrity label, and JSON download button.`
  3. **Task `US-024-T3` — Title**: `Add Vitest tests for manifest checksum determinism, PII exclusion, and locked-team authorization`
     - **Description**: `Verify identical snapshots produce identical SHA-256 checksums, private emails/contacts are excluded, and unlocked or non-member requests are rejected.`

---

### US-025: User Reporting Modal for Abusive Content and Malicious Links
- **Delivery Category**: Should-Have — early post-MVP
- **User/Role**: `PART`
- **Story Statement**: *"As a Participant, I want to report an abusive profile, offensive team listing, or suspicious external URL, so that Administrators can investigate misconduct."*
- **Description**: Enables authenticated `PART` users to submit structured abuse reports (`Harassment`, `Spam`, `Phishing Link`, `Fake Account`) against visible team listings or participant profiles, rate-limited to at most 5 reports per account per rolling hour, feeding directly into the `US-026` moderation queue.
- **Disaggregated Tasks**:
  1. **Task `US-025-T1` — Title**: `Create Express user report submission endpoint with 5-per-hour rate limiting`
     - **Description**: `Implement POST /api/reports for authenticated PART users targeting team listings or profiles, enforcing a 5-reports-per-rolling-hour rate limit (HTTP 429) and automatically creating or linking a US-026 moderation case.`
  2. **Task `US-025-T2` — Title**: `Build React Report modal for team cards and candidate profiles`
     - **Description**: `Implement the React reporting modal with category selection (Harassment, Spam, Phishing Link, Fake Account), optional explanation input, confirmation receipt, and rate-limit error feedback.`
  3. **Task `US-025-T3` — Title**: `Add Vitest tests for report creation, rolling-hour rate limiting, and reporter privacy`
     - **Description**: `Verify moderation case creation on report submission, 6th report rejection within an hour (HTTP 429), and strict non-exposure of reports to other participants.`

---

### US-028: Administrative Audit Review and Filtering
- **Delivery Category**: Should-Have — early post-MVP
- **User/Role**: `ADMIN`
- **Story Statement**: *"As a Platform Administrator, I want to review and filter administrative action records in a read-only audit interface, so that I can investigate past moderation and account enforcement decisions."*
- **Description**: Provides `ADMIN` users with a searchable, read-only audit log interface over the append-only administrative action records generated by `US-026` and `US-027`.
- **Disaggregated Tasks**:
  1. **Task `US-028-T1` — Title**: `Create Express read-only administrative audit log query and filter endpoint`
     - **Description**: `Implement GET /api/admin/audit-logs restricted to ADMIN users, supporting combinable filters by actorId, actionType, targetType, and UTC date range with zero mutation or deletion endpoints.`
  2. **Task `US-028-T2` — Title**: `Build React read-only administrative audit log table and filter bar`
     - **Description**: `Implement the React audit log viewer displaying record ID, actor ID, action type, target summary, reason, outcome, and UTC timestamp with filter controls and an empty state.`
  3. **Task `US-028-T3` — Title**: `Add Vitest tests for audit log filtering, read-only immutability, and ADMIN-only access`
     - **Description**: `Verify actor/action/date filtering accuracy, empty-result states, and 403 rejection for PART and VISITOR users.`

---

## 4. May-Have Future Scope User Stories (2 Stories — Uncommitted)

### US-016: Recommended Teams for Participants (Future Scope)
- **Delivery Category**: May-Have — future, uncommitted
- **User/Role**: `PART`
- **Story Statement**: *"As a Participant, I want to receive proactive recommendations of open teams matching my profile across the platform, so that I can discover compatible projects without manual filtering."*

### US-029: Authenticator-App Two-Factor Authentication (Future Scope)
- **Delivery Category**: May-Have — future, uncommitted
- **User/Role**: `PART` / `ADMIN`
- **Story Statement**: *"As a Participant or Platform Administrator, I want to link a standard authenticator app to my account, so that I can generate instant 6-digit verification codes on my mobile device."*

---

## 5. Recommended Implementation Order (Next Steps)

1. **`US-013`** (Browse and Filter Open Team Vacancies) — Exposes the teams created via `US-012` on the public/participant recruitment board.
2. **`US-011`** (Declare Platform Availability and Looking-for-Team Status) — Populates the available candidate pool.
3. **`US-018` & `US-020`** (Apply to Join a Team Vacancy & Team Lead Approves/Declines Application) — Completes the inbound application recruitment loop.
4. **`US-017` & `US-019`** (Issue a Team Invitation & Respond to a Team Invitation) — Completes the outbound invitation and pre-lock leave loop.
5. **`US-015`** (Candidate Recommendations for Team Leads) — Adds ranked algorithmic candidate suggestions to open team slots.
6. **`US-022`** (Confirm and Lock a Team Roster) — Finalizes and freezes team rosters.
7. **`US-026` & `US-027`** (Administrative Content Moderation & Account Enforcement) — Completes all remaining Must-Have MVP governance requirements.