# User Stories

## Overview

This document defines HackMatch user stories using the roles established in [Roles and Personas](../01_roles_and_personas/roles_and_personas.md). The system architecture defines two global authenticated account types (**Participant** — `PART`, and **Platform Administrator** — `ADMIN`), one contextual permission set (**Team Lead** — `LEAD`, assumed by a `PART` who creates a team), and one unauthenticated public state (**Unauthenticated Visitor** — `VISITOR`).

The canonical expanded backlog contains **29 stories: 20 Must-Have MVP stories, 7 Should-Have early post-MVP stories, and 2 May-Have future stories**. Current IDs are retained. Older Word/issue references require later reconciliation by meaning.

Categories follow [MVP Definition](../03_mvp/mvp_definition.md). Proposed numerical/lifecycle defaults and remaining confirmations are centralized in the [policy register](../04_requirements/functional_nonfunctional_requirements.md#policy-register); they are not professor mandates. All features are delivered through a responsive browser interface including tablet/iPad and phone portrait/landscape layouts.

### Structure of a User Story

Every story below follows the standardized format:
- **Identifier:** A unique sequential identifier in the format `US-XXX`.
- **User/Role:** The specific user role (`VISITOR`, `PART`, `LEAD`, `ADMIN`).
- **Story Statement:** *"As a [user role], I want to [action/capability], so that [benefit/value]."*
- **Description:** Contextual details, business rules, and architectural intent.
- **Acceptance Criteria:** A numbered list of specific, testable conditions.
- **Priority:** High, Medium, or Low.
- **Complexity/Effort Estimate:** Small, Medium, or Large.
- **Related Stories:** References to current canonical IDs; related stories are not automatically blockers.

---

## User Stories by Feature Area

| Feature Area | Must-Have MVP | Should-Have post-MVP | May-Have future |
|---|---|---|---|
| Authentication and Participant Profiles | US-001, US-002, US-003, US-004, US-005, US-006 | US-007 | US-029 |
| Hackathon Directory and Event Management | US-008, US-009, US-010 | — | — |
| Team Recruitment and Looking-for-Team Boards | US-011, US-012, US-013 | US-014 | — |
| Rule-Based Matching | US-015 | — | US-016 |
| Invitations, Applications, and Rosters | US-017, US-018, US-019, US-020, US-022 | US-021, US-023, US-024 | — |
| Platform Administration and Trust | US-026, US-027 | US-025, US-028 | — |

---

### Feature Area 1: Authentication and Participant Profiles

These stories govern account creation, federated single sign-on, multi-factor credential authentication, session security, profile management, and historical hackathon records.

<a id="us-001"></a>

#### US-001: Participant Registration and Email Verification

**Delivery Category:** Must-Have — MVP

**User/Role:** VISITOR

**Story Statement:** As an unauthenticated visitor, I want to create an account with my email and password and verify my email address, so that I can establish a verified Participant profile.

**Description:** Standard email/password registration through Firebase Authentication creates a `PART` account in an `Unverified` state. Full access to interactive team formation is gated behind email verification handled by Firebase Authentication, to prevent mailbox spoofing. Public registration never grants `ADMIN` privileges.


**Acceptance Criteria:**
1. A visitor can submit full name, email, and a password that meets the configured Firebase password policy (at least 8 characters, mixed case, a digit, and a special character). An academic domain is not required.
2. Email format and uniqueness are checked by Firebase Authentication, which sends a verification link to the address. Link expiry is managed by Firebase.
3. A valid unused link marks the email as verified in Firebase and the PART account as Verified; expired, consumed, or tampered links fail without granting access. A replacement may be requested.
4. Unverified accounts cannot declare availability, create teams, apply, or accept invitations. Public registration never grants ADMIN; administrator provisioning is restricted to an authorized deployment operator, who sets the ADMIN role as a Firebase custom claim.
5. Email ownership verification does not create a full login session: Firebase MFA (US-004) must succeed first.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-002, US-003, US-004, US-005

---

<a id="us-002"></a>

#### US-002: Federated OAuth Registration and Authentication

**Delivery Category:** Must-Have — MVP

**User/Role:** VISITOR / PART

**Story Statement:** As a visitor or Participant, I want to register and sign in using my Google or GitHub account, so that I can access the platform quickly without creating separate credentials.

**Description:** Google and GitHub are alternative primary sign-in methods for PART. Every provider sign-in still completes mandatory email OTP in US-004. Verified provider identity is not proof of skill or portfolio authorship.

**Acceptance Criteria:**
1. A visitor can choose Google or GitHub. Cancellation, invalid provider responses, or provider failure return an actionable error without a session.
2. Only validated provider identity with a verified email may provision a Verified PART account. Without verified email, direct the user to email registration/verification.
3. With consent, populate provider handle/avatar. Portfolio claims remain self-declared.
4. Link an existing PART account only after reauthentication to that account and successful email OTP; matching email text alone is insufficient. Public OAuth cannot create, link to, or promote an ADMIN account.
5. Every provider sign-in proceeds to US-004. No full session or team action is allowed before email OTP.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-001, US-003, US-004, US-006

---

<a id="us-003"></a>

#### US-003: User Login and Session Management

**Delivery Category:** Must-Have — MVP

**User/Role:** PART / ADMIN

**Story Statement:** As a Participant or Administrator, I want to sign in, maintain an authorized session, and sign out, so that I can safely use my authorized functions.

**Description:** Firebase Authentication validates credentials for existing `PART` and `ADMIN` accounts and coordinates the transition into the mandatory Login Multi-Factor Authentication workflow (US-004) before the backend accepts a session. The backend authorizes each request by verifying the signed Firebase ID token and the user's role custom claim.


**Acceptance Criteria:**
1. Primary credentials are validated by Firebase Authentication (passwords are salted and hashed by Firebase), and the UI shows generic failure messages that do not reveal whether an account exists.
2. Valid primary authentication grants no usable session until Firebase MFA (US-004) succeeds; the backend rejects any token without a second-factor claim. Suspended accounts cannot start or renew sessions.
3. Repeated incorrect passwords are throttled by Firebase Authentication (limits are Firebase-managed), and the UI shows retry guidance. This password throttling is separate from MFA attempt throttling in US-004.
4. After MFA, the backend verifies the Firebase ID token on every protected request. ID tokens expire after 1 hour and refresh automatically; if a shorter access lifetime or a fixed 7-day renewal limit is required, the backend issues session cookies through the Firebase Admin SDK. Tokens are sent over HTTPS only. Because the Firebase web SDK keeps tokens where scripts can read them, XSS protection is mandatory; any cookie-based session is HttpOnly, Secure, and protected against request forgery.
5. Logout signs the user out and revokes their Firebase refresh tokens; replaying the old credentials fails on protected endpoints, where the backend checks token revocation. Expired or revoked sessions cannot invoke protected endpoints.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-001, US-002, US-004, US-005

---

<a id="us-004"></a>

#### US-004: Email-Based Login Two-Factor Authentication (2FA)

**Delivery Category:** Must-Have — MVP

**User/Role:** PART / ADMIN

**Story Statement:** As a Participant or Platform Administrator, I want to verify my identity via a one-time code sent to my email during login, so that a compromised password alone does not grant account access.

**Description:** Mandatory email login 2FA for PART and ADMIN, including Google/GitHub sign-in. The 10-minute OTP lifetime and account lock for 15 minutes after 5 incorrect OTP attempts implement the supplied professor/Issue #9 direction.

**Acceptance Criteria:**
1. After successful primary authentication, send a cryptographically random 6-digit OTP to the verified email, bound to account and challenge. It expires 10 minutes after issuance; at or after expiry reject it.
2. Only the matching current unused OTP completes authentication. Consume it atomically and reset the account OTP failure counter on success.
3. The fifth incorrect OTP attempt locks the account for 15 minutes and invalidates outstanding challenges. No login or session renewal succeeds during the lock. Changing browser, IP, provider, or requesting another code cannot reset the counter or bypass the lock.
4. After lock expiry, require primary authentication and a fresh OTP; reset the failure counter for the new cycle. Existing sessions are not revoked solely by an OTP lockout, avoiding unauthenticated forced logout.
5. Reissuing a code invalidates its predecessor without resetting failures. Expired/consumed codes never authenticate. Resend and email failure behaviour follow FR-081 and FR-084.
6. OAuth and password recovery do not exempt an account from email OTP. Provider MFA is not an alternative in the MVP.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-001, US-002, US-003, US-005, US-029

---

<a id="us-005"></a>

#### US-005: Password Recovery for PART/ADMIN

**Delivery Category:** Must-Have — MVP

**User/Role:** PART / ADMIN

**Story Statement:** As a user, I want to request a secure password reset link via my registered email, so that I can regain access if I forget my password.

**Description:** Self-service password recovery using Firebase-managed reset emails with single-use, time-limited links. Resetting credentials terminates all existing active sessions.

**Acceptance Criteria:**
1. For credential accounts, Firebase sends a single-use reset link (expiry is Firebase-managed). Known OAuth-only accounts use their provider recovery flow without publicly revealing account type.
2. Return the same generic confirmation for known and unknown addresses (enable Firebase email enumeration protection). Expired, invalid, or already-used links cannot change a password.
3. A valid link allows a password satisfying the registration policy; success consumes the link.
4. After reset, the backend revokes existing Firebase refresh tokens across devices. Reset does not sign the user in or bypass MFA; the next login requires US-004.

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-001, US-003, US-004

---

<a id="us-006"></a>

#### US-006: Participant Profile Management

**Delivery Category:** Must-Have — MVP

**User/Role:** PART

**Story Statement:** As a Participant, I want to maintain my technical profile with my role, skill tags, academic institution, and portfolio links, so that prospective teammates can assess my capabilities.

**Description:** Maintains self-declared skills and portfolio URLs. URL format validation is not independent verification of skills, identity, or achievements. Visitors see anonymized team previews; authenticated PART users may inspect candidate cards.

**Acceptance Criteria:**
1. A PART can edit only their own handle, primary role (Frontend, Backend, Mobile, AI/ML, UI/UX, Pitch), institution if applicable, skills, portfolio links, and optional shared contact handle.
2. Portfolio links must be valid HTTPS URLs and are labelled self-declared. The platform does not certify linked claims.
3. Visitors cannot access participant cards, member handles, portfolio links, or private contacts. Authenticated PART users can view permitted profile fields; account email, internal IDs, and authentication data remain private.
4. A shared contact handle is visible only to confirmed teammates with the owner informed of that audience; leaving/removal revokes that access. Account email is never automatically shared.
5. Valid edits persist and update candidate views; invalid input yields field-specific errors without discarding other entered values.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-001, US-002, US-007, US-011, US-015

---

<a id="us-007"></a>

#### US-007: Participant Hackathon History and Portfolio Records

**Delivery Category:** Should-Have — early post-MVP

**User/Role:** PART

**Story Statement:** As a Participant, I want to record past hackathons and project links, so that Team Leads can review my self-declared experience.

**Description:** Post-MVP history with URL format checks and self-reported experience badges; not independently verified achievements.

**Acceptance Criteria:**
1. A PART can add event name, date, team role, project title, and HTTPS project URL to their own history.
2. Compute Beginner (0 records), Competitor (1–3), or Veteran (4+); label count and badge self-reported.
3. Authenticated PART users can inspect permitted history/links; Visitors cannot.
4. Owners can edit/remove records and badges recalculate. MVP recruitment and matching do not depend on this later feature.

**Priority:** Medium

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-006, US-014, US-015

---

<a id="us-029"></a>

#### US-029: Authenticator-App Two-Factor Authentication (Future Scope)

**Delivery Category:** May-Have — future, uncommitted

**User/Role:** PART / ADMIN

**Story Statement:** As a Participant or Platform Administrator, I want to link a standard authenticator app (such as Google Authenticator or Microsoft Authenticator) to my account, so that I can generate instant 6-digit verification codes on my mobile device without waiting for email delivery.

**Description:** May-Have requiring a future security design before replacing or supplementing email OTP. QR enrollment transfers a secret over a protected channel; the QR payload is not itself encrypted. No release date is committed.

**Acceptance Criteria:**
1. In a future approved release, an authenticated PART or ADMIN can begin enrollment and confirm an authenticator code before activation.
2. Protect enrollment secrets/recovery credentials from other accounts and logs; failed setup never activates the method.
3. Any recovery codes must be single-use and obtainable/replaced only after reauthentication. Quantity and recovery design require future approval.
4. Until that design is approved, every login uses mandatory email OTP in US-004. Future alternatives must specify fallback/recovery behaviour.
5. Retain the account-wide five-incorrect-attempt/15-minute lock policy; do not introduce a conflicting three-attempt exception.

**Priority:** Low

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-003, US-004

---

### Feature Area 2: Hackathon Directory and Event Management

These stories define crowdsourced event discovery, unlisted event submissions by authenticated Participants, and administrative verification workflows that maintain a single source of truth without requiring a separate Organizer account role.

<a id="us-008"></a>

#### US-008: Public Hackathon Discovery and Multi-Filter Search

**Delivery Category:** Must-Have — MVP

**User/Role:** VISITOR / PART

**Story Statement:** As a visitor or Participant, I want to browse and filter upcoming hackathons, so that I can identify events I want to attend and inspect available teams.

**Description:** Public discovery of approved HackMatch event records. Verification concerns official event identity and published rules; it does not register attendees with organizers.

**Acceptance Criteria:**
1. Visitors and PART users can browse Verified records with title, dates, format, location, official team limits, and HTTPS URL. Pending/rejected submissions are not public listings.
2. Keyword, format, and time-state filters (Upcoming, Ongoing, Concluded) combine consistently.
3. Official links open separately with safe link attributes; ADMIN-disabled links cannot be followed from listings.
4. Each event opens a team board. Visitors see anonymized pitches/vacancies; PART users see permitted details. Concluded/archived events are read-only.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-009, US-010, US-011, US-013

---

<a id="us-009"></a>

#### US-009: Participant Hackathon Event Submission

**Delivery Category:** Must-Have — MVP

**User/Role:** PART

**Story Statement:** As a Participant, I want to submit an unlisted hackathon for verification, so that users can form teams around one trusted event record.

**Description:** Any verified signed-in PART may submit, including someone who has not created a team. ADMIN approval is required before publication or recruitment. This maintains an external event record, not ticketing, payments, attendee registration, judging, or event scheduling.

**Acceptance Criteria:**
1. Search first; submission captures title, official HTTPS URL, start/end dates, format/location, and team limits from official rules. End cannot precede start.
2. Server-side duplicate checks reuse an exact normalized official URL plus event edition/start date match. Show similar title/date/location candidates for review; similarity alone never merges records.
3. New submissions are Pending Verification, visible only to submitter and ADMIN. Teams, availability, invitations, and applications are blocked until approval.
4. Submitters can inspect Pending, Approved, Rejected, or Merged status, ADMIN feedback, and the canonical record link.
5. Approval publishes the record and enables recruitment. Fake/invalid links remain unpublished; a rejected submission can be corrected and resubmitted. Simultaneous duplicates cannot create separate identical pending records.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-008, US-010, US-012

---

<a id="us-010"></a>

#### US-010: Administrative Event Verification, Correction, and Lifecycle Management

**Delivery Category:** Must-Have — MVP

**User/Role:** ADMIN

**Story Statement:** As a Platform Administrator, I want to review, correct, and verify crowdsourced hackathon submissions and manage published listings, so that the platform maintains an accurate single source of truth.

**Description:** ADMIN creates official listings directly or verifies PART submissions against organizer identity and published dates/team rules. HTTPS alone is not verification. Only approved records support recruitment.

**Acceptance Criteria:**
1. Only ADMIN may inspect the queue or create/edit/approve/reject/merge/archive records. Decisions record actor, target, reason, outcome, and time in the basic action record.
2. Before approval, check official organizer source, event edition, dates, destination URL, and official team limits. Missing/inconsistent rules keep the submission pending; there is no universal four- or six-person cap.
3. Approval publishes a Verified record and enables recruitment. Direct ADMIN creation requires the same checks; pending edits never publish a record.
4. Resolve duplicates to one canonical event. Published-record merges must preserve every membership, capacity, vacancy, and availability invariant; reject conflicting merges without partial changes, identifying conflicts for affected teams to resolve.
5. Reject invalid submissions with feedback. For an already-published unsafe/invalid event, disable the link and recruitment and notify affected users while retaining historical memberships.
6. Metadata corrections cannot silently overfill teams or create duplicate memberships. Reject conflicting changes and identify affected teams; ADMIN cannot directly rewrite private rosters.
7. ADMIN may archive concluded events; reaching end date also closes recruitment. Authorized users retain historical roster access and see status updates.

**Priority:** High

**Complexity/Effort Estimate:** Large

**Related Stories:** US-008, US-009, US-012, US-026, US-028

---

### Feature Area 3: Team Recruitment and Looking-for-Team Boards

These stories govern event-specific participant availability declarations, structured vacancy-based recruitment listings, self-service editing by Team Leads, open vacancy discovery, and multi-filter candidate search.

<a id="us-011"></a>

#### US-011: Declare Event Availability and Looking-for-Team Status

**Delivery Category:** Must-Have — MVP

**User/Role:** PART

**Story Statement:** As a Participant, I want to declare my availability for a specific hackathon and state my desired role and commitment level, so that Team Leads can discover me as an available candidate.

**Description:** Participant availability is strictly scoped to an event. Participants specify event-specific preferences without altering their global profile. Availability flags automatically deactivate upon confirmed team placement.

**Acceptance Criteria:**
1. A verified PART without confirmed membership in the event may toggle Looking for Team on a Verified recruiting event.
2. Capture desired event role, non-negative numeric commitment hours for the event, and goal: Learning, Project Completion, or Competitive. Team listings and matching use the same labels.
3. Authorized PART users can inspect eligible candidates; Visitors cannot. Availability feeds lead recommendations.
4. Team creation or either joining route confirms membership and clears event availability. It cannot be re-enabled while confirmed; other events are unaffected.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-006, US-012, US-014, US-015, US-019, US-020, US-022

---

<a id="us-012"></a>

#### US-012: Create and Manage a Team Recruitment Listing

**Delivery Category:** Must-Have — MVP

**User/Role:** PART (becomes Team Lead on creation; ownership permissions apply only to that team)

**Story Statement:** As a Team Lead, I want to create a structured recruitment listing with discrete skill vacancy slots and edit it as our needs evolve, so that I can attract targeted teammates.

**Description:** A PART creates a team and becomes its first confirmed member and contextual owner. A PART may lead in one event and be a regular member elsewhere. Listing management includes the retained pre-lock lifecycle below.

**Acceptance Criteria:**
1. A verified PART without confirmed membership in the event may create a listing under a Verified recruiting event: name, pitch (maximum 500 characters), goal, numeric commitment hours, and optional external communication link.
2. Creation atomically confirms the owner, clears event availability, and cancels their other pending incoming invitations/applications for that event. Permissions apply only to this team.
3. Only the owner can edit listing/vacancy details before lock. Members plus open slots cannot exceed official event maximum. Open slots define role/skills; only one pending invitation per slot and invitee/team is allowed.
4. Removing a slot cancels its pending invitations/applications with alerts; it never removes a confirmed member.
5. Before lock the owner may remove a non-owner member with a reason and notification, reopening capacity and event availability when recruitment remains open. Canceled requests are not revived.
6. The owner may disband an unlocked team, releasing members and canceling requests with alerts. Owners cannot leave/remove themselves without disbanding; ownership transfer is not included.
7. Locked, archived, disabled, or disbanded teams reject roster mutations through UI and direct requests. Retained lifecycle defaults are recorded in policy R-02.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-009, US-010, US-011, US-013, US-015, US-017, US-019, US-020, US-022

---

<a id="us-013"></a>

#### US-013: Browse and Filter Open Team Vacancies

**Delivery Category:** Must-Have — MVP

**User/Role:** PART

**Story Statement:** As a Participant, I want to browse and filter open team vacancy slots for a hackathon, so that I can identify teams matching my technical stack and project goals.

**Description:** Participants inspect active recruitment boards for a specific event. Listings display remaining open slots, required skill pills, and team objectives.

**Acceptance Criteria:**
1. The selected Verified event shows active unlocked teams with open slots, excluding hidden/disbanded teams.
2. PART users can combine skill, role, goal (Learning, Project Completion, Competitive), and slot-count filters.
3. PART users see pitch, member display handles/roles, and vacancy requirements; Visitors see anonymized previews and sign-in prompts.
4. Apply opens US-018. No matches produces a clear empty state with filter reset. MVP participants receive no algorithmic team recommendations.

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-008, US-012, US-016, US-018

---

<a id="us-014"></a>

#### US-014: Advanced Candidate Directory Search and Filter for Team Leads

**Delivery Category:** Should-Have — early post-MVP

**User/Role:** PART acting as Team Lead (LEAD)

**Story Statement:** As a Team Lead, I want to search and filter the event candidate pool using specific skill combinations and experience tiers, so that I can manually discover candidates who fit our vacancy needs.

**Description:** Dedicated candidate discovery directory for Team Leads. Complements algorithmic recommendations with multi-parameter filter controls across declared participant skills, experience tiers, and availability.

**Acceptance Criteria:**
1. The owner of an active team can search eligible candidates for that event, excluding every confirmed participant.
2. Filters include skills with AND/OR, primary role, numeric commitment hours, and self-reported US-007 experience badges.
3. Cards show permitted display handle, role, self-reported history/badge, and skills under US-006 privacy rules.
4. The owner can inspect a profile or invite via US-017. This advanced directory is post-MVP; the MVP recommendation list does not depend on it.

**Priority:** Medium

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-006, US-007, US-011, US-012, US-015, US-017

---

### Feature Area 4: Rule-Based Matching

These stories compute deterministic compatibility scores between solo participant availability profiles and open team vacancy requirements.

<a id="us-015"></a>

#### US-015: Candidate Recommendations for Team Leads

**Delivery Category:** Must-Have — MVP

**User/Role:** PART acting as Team Lead (LEAD)

**Story Statement:** As a Team Lead, I want to view a ranked list of compatible candidates for my team's open vacancy slots, so that I can invite teammates with complementary skills and matching commitments.

**Description:** Explainable rule-based scores compare an open slot with available event candidates. Exclude all confirmed participants regardless of full/locked state. Proposed scoring policy FR-043–045 is a recommendation aid, not a probability of team success.

**Acceptance Criteria:**
1. Only the owner can request recommendations for an open slot on their Verified recruiting team.
2. Use declared skills, primary role, goal, and numeric commitment hours with FR-043–045 handling of missing inputs. History badges/advanced search are not prerequisites.
3. Scores are deterministic and bounded 0–100; ties use display handle then internal identifier. Explain component contributions without exposing internal identifiers.
4. Exclude inactive accounts, participants not Looking for Team, and anyone already confirmed for the event.
5. Eligible candidates can be invited through US-017. Empty pools give a no-results message; scoring failure falls back to an unranked eligible list.

**Priority:** High

**Complexity/Effort Estimate:** Large

**Related Stories:** US-006, US-011, US-012, US-014, US-016, US-017, US-022

---

<a id="us-016"></a>

#### US-016: Recommended Teams for Participants (Future Scope)

**Delivery Category:** May-Have — future, uncommitted

**User/Role:** PART

**Story Statement:** As a Participant, I want to receive proactive recommendations of open teams matching my profile, so that I can discover compatible projects without manual filtering.

**Description:** Reverse matching algorithm computing compatibility between a solo participant's skills and open team vacancy slots. Deferred to future releases; MVP users browse and filter listings manually via US-013.

**Acceptance Criteria:**
1. The system evaluates a Participant's profile against open vacancy slots for a selected hackathon and outputs top-ranked team suggestions.
2. Recommendations surface a match percentage score and highlight matched skill tags.
3. Participants can apply directly to suggested teams via US-018.

**Priority:** Medium

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-006, US-011, US-013, US-018

---

### Feature Area 5: Invitations, Applications, and Rosters

These stories manage formal team recruitment state transitions, in-app alerts, concurrency conflict resolution, roster freezing, private collaboration workspaces, and check-in manifest export.

<a id="us-017"></a>

#### US-017: Issue a Team Invitation

**Delivery Category:** Must-Have — MVP

**User/Role:** PART acting as Team Lead (LEAD)

**Story Statement:** As a Team Lead, I want to issue a direct invitation to an available candidate, so that they can review my team and decide whether to join.

**Description:** Owner invitations target one vacancy. Pending invitations do not confirm membership or reserve capacity against applications; acceptance revalidates capacity and eligibility.

**Acceptance Criteria:**
1. Only the owner of an active unlocked team can invite an available PART without a confirmed team for that Verified event.
2. A Pending invitation expires 48 hours after issuance or earlier if its slot closes or recruitment ends. Reject expired acceptance even if cleanup has not run.
3. Allow one pending invitation per slot and per invitee/team, bounded by open slots. Application approval may fill a slot and cancel its invitation.
4. Owners can cancel Pending invitations. Both parties see basic status alerts in invitation views without depending on the full US-021 notification centre.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-012, US-015, US-019, US-020, US-021, US-022

---

<a id="us-018"></a>

#### US-018: Apply to Join a Team Vacancy

**Delivery Category:** Must-Have — MVP

**User/Role:** PART

**Story Statement:** As a Participant, I want to submit an application to an open team vacancy slot, so that the Team Lead can review my profile and consider me for membership.

**Description:** Allows solo participants to express interest in specific vacancy slots. Rate-limited to prevent platform-wide spam applications.

**Acceptance Criteria:**
1. A verified PART may apply to an open slot on an active unlocked team only without confirmed membership in that event.
2. Attach permitted self-declared profile data and an optional message of at most 250 characters. Reject duplicate pending applications to the same team.
3. At most 3 Pending Review applications per PART per event are allowed; count validation/update is atomic. Other events have separate limits.
4. Applicants inspect status and may withdraw until a decision commits. Owners receive basic alerts; US-021 is not required.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-012, US-013, US-020, US-021

---

<a id="us-019"></a>

#### US-019: Respond to a Team Invitation

**Delivery Category:** Must-Have — MVP

**User/Role:** PART

**Story Statement:** As an invited Participant, I want to accept or decline a team invitation, so that I can confirm my team placement or keep looking.

**Description:** Acceptance immediately confirms membership before roster lock. All mutations use FR-083. Leaving before lock is retained as the lifecycle of placement and applies equally to application-approved members.

**Acceptance Criteria:**
1. Only the addressed PART can respond to a current Pending invitation and inspect permitted team details.
2. Acceptance atomically rechecks active accounts, Verified recruiting event, unlocked team, open slot, capacity, and no confirmed membership in this event. Concurrent conflicting joins yield one success and one clear rejection without partial writes.
3. Success fills the slot, confirms membership, clears event availability, cancels all other incoming invitations, and withdraws all other applications by this PART for this event. Other events remain unchanged.
4. Cancel remaining requests for the filled slot; when full, cancel every remaining request to that team. Repeated decisions cannot duplicate membership.
5. Decline affects only that invitation and alerts the owner without changing availability. Both parties see basic status alerts without US-021.
6. A confirmed non-owner admitted by either route can leave before lock, reopening capacity and restoring event availability when recruitment remains open. Alert the owner; do not revive old canceled requests. Locked teams reject leaving; owners must disband under US-012.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-011, US-017, US-020, US-021, US-022

---

<a id="us-020"></a>

#### US-020: Team Lead Approves or Declines an Application

**Delivery Category:** Must-Have — MVP

**User/Role:** PART acting as Team Lead (LEAD)

**Story Statement:** As a Team Lead, I want to review incoming applications and approve or decline candidates, so that I can select the best teammates for our vacancies.

**Description:** Owners decide applications through the same capacity and one-team-per-event transaction as invitation acceptance. Approval revalidates eligibility at decision time.

**Acceptance Criteria:**
1. Only the owner can inspect and decide Pending Review applications using permitted profile fields and notes.
2. Approval atomically checks active accounts, Verified recruiting event, unlocked team, open slot, capacity, and no confirmed membership for the applicant in this event. A concurrent invitation/approval cannot create a second membership.
3. Success confirms membership, fills the slot, clears availability, cancels the applicant's other incoming invitations, and withdraws their other applications for this event only.
4. Cancel remaining requests for the filled slot and, when full, all requests to the team. Stale/repeated decisions return the existing outcome or a clear conflict without duplicate writes.
5. Decline leaves membership/slot unchanged. Both parties receive basic status alerts without US-021; leaving follows US-019.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-012, US-018, US-019, US-021, US-022

---

<a id="us-021"></a>

#### US-021: In-App Notification Center and Real-Time Recruitment Alerts

**Delivery Category:** Should-Have — early post-MVP

**User/Role:** PART (including a PART acting as Team Lead for their team)

**Story Statement:** As an active user, I want an in-app notification center that alerts me to invitations, applications, and event verification updates, so that I can take timely action.

**Description:** Post-MVP notification centre adds unread counts, a feed, navigation, and read management. Basic event/recruitment/roster alerts already exist in their ordinary MVP views and do not depend on this enhancement.

**Acceptance Criteria:**
1. The global navigation bar displays an interactive notification bell icon with an unread badge counter.
2. The notification dropdown renders distinct alert types: Inbound Invitations, Join Applications Received, Application Approval/Decline Decisions, Roster Confirmation, and Event Verification Approvals.
3. Clicking a notification redirects the user directly to the relevant action view (e.g., Invitation response modal or Team review view).
4. Users can mark individual notifications as read or click "Mark all as read".

**Priority:** Medium

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-009, US-010, US-017, US-018, US-019, US-020

---

<a id="us-022"></a>

#### US-022: Confirm and Lock a Team Roster

**Delivery Category:** Must-Have — MVP

**User/Role:** PART acting as Team Lead (LEAD)

**Story Statement:** As a Team Lead, I want to confirm and lock my team's roster, so that our membership is finalized and membership mutations are frozen.

**Description:** Owner finalization of a valid roster. Locking depends on confirmed memberships, not completion of both joining interfaces. Workspace/export are separately scheduled post-MVP enhancements.

**Acceptance Criteria:**
1. Only the owner can lock an active unlocked roster meeting the official event minimum/maximum; every member has exactly one confirmed membership for that event.
2. Lock is atomic with join/leave operations: mutations either commit before lock and enter validation or fail after lock. Record members and server lock time.
3. Cancel pending recruitment requests; reject later invitations, applications, exits, removals, slot edits, or disbanding. Ordinary users and ADMIN cannot unlock or rewrite the roster through this workflow.
4. Members see the locked roster and basic status confirmation. When US-023/024 later ship, lock enables workspace/export; neither is required for MVP completion.

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-011, US-012, US-015, US-017, US-019, US-020, US-023, US-024

---

<a id="us-023"></a>

#### US-023: Team Private Coordination Workspace

**Delivery Category:** Should-Have — early post-MVP

**User/Role:** PART (confirmed member of a locked team, including the owner)

**Story Statement:** As a confirmed team member, I want to access a private team workspace with shared communication links, project concept notes, and teammate contacts, so that we can coordinate before the hackathon begins.

**Description:** Post-MVP workspace for confirmed members of locked teams. External links and shared notes support coordination without chat/video or simultaneous live editing.

**Acceptance Criteria:**
1. Only active confirmed members of a locked team can access its workspace. Visitors, unrelated PART users, and ADMIN without membership are denied.
2. Show permitted shared contact handles, self-declared portfolio links, and roles; never automatically expose account email or authentication data.
3. Only the owner updates shared external tool links; reject non-HTTPS/unsafe schemes.
4. Members may read/edit a shared markdown note and inspect revisions with author/time. Reject stale concurrent saves instead of overwriting newer edits. Note revisions follow deletion/privacy policy.

**Priority:** Medium

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-012, US-019, US-022, US-024

---

<a id="us-024"></a>

#### US-024: Export Team Manifest and Check-In Verification Card

**Delivery Category:** Should-Have — early post-MVP

**User/Role:** PART (confirmed member of a locked team, including the owner)

**Story Statement:** As a confirmed member of a locked team, I want to export our roster record, so that we can share consistent team information if an event accepts it.

**Description:** Post-MVP printable/exportable roster. Organizer acceptance is not assumed. A checksum supports comparison with the server record; it is not independent evidence of time, eligibility, or organizer endorsement.

**Acceptance Criteria:**
1. Only active confirmed members of a locked team may export it.
2. Printable HTML/PDF and JSON include team/event, server lock time, member display names, institution if provided, portfolio handles, and roles. Exclude account email/private contact handles.
3. Include a checksum of documented canonical serialization of the stored snapshot. Identical snapshots have the same checksum; changes to included fields change it.
4. Label time as recorded by HackMatch and checksum as an integrity check. It does not independently prove pre-event formation or official approval; verification requires comparison with the stored record.

**Priority:** Medium

**Complexity/Effort Estimate:** Small

**Related Stories:** US-010, US-022, US-023

---

### Feature Area 6: Platform Administration and Trust

These stories govern user abuse reporting, administrative moderation, account enforcement, and immutable audit logging to protect students from spam, harassment, and phishing threats.

<a id="us-025"></a>

#### US-025: User Reporting Modal for Abusive Content and Malicious Links

**Delivery Category:** Should-Have — early post-MVP

**User/Role:** PART

**Story Statement:** As a Participant, I want to report an abusive profile, offensive team listing, or suspicious external URL, so that Administrators can investigate misconduct.

**Description:** Self-service reporting modal available across candidate profiles, team cards, and event listings. Submissions feed directly into the administrative moderation queue.

**Acceptance Criteria:**
1. In the post-MVP release, signed-in PART users can report a visible team listing, permitted profile, or Verified event listing.
2. Capture target, category (Harassment, Spam, Phishing Link, Fake Account), and optional explanation; other participants cannot read reports.
3. Permit at most 5 reports per account per rolling hour, with a retry message on rejection.
4. Create a US-026 moderation case and confirm receipt. MVP ADMIN can create cases independently; basic moderation does not depend on reports.

**Priority:** Medium

**Complexity/Effort Estimate:** Small

**Related Stories:** US-006, US-012, US-026

---

<a id="us-026"></a>

#### US-026: Administrative Content Moderation and Safety Queue

**Delivery Category:** Must-Have — MVP

**User/Role:** ADMIN

**Story Statement:** As a Platform Administrator, I want to review flagged team content and malicious links in a moderation queue, so that the platform remains safe, compliant, and free of phishing threats.

**Description:** MVP ADMIN inspection/moderation with a case queue. ADMIN may open a case directly from an event/profile/team; participant reporting joins later through US-025. Basic administrative records exist in MVP; US-028 adds their searchable interface later.

**Acceptance Criteria:**
1. Only ADMIN inspects content and creates cases with target, reason, and time. Order newest first; report counts appear when reporting ships.
2. ADMIN may dismiss, redact text, record/send a warning, or hide a listing. Require a reason and basic action record.
3. Disable confirmed malicious URLs immediately. Invalid events also stop recruitment through US-010; preserve historical memberships.
4. Record actor, target, safe state summary, reason, outcome, and time, excluding credentials and private contacts. ADMIN gains no private-workspace access.
5. PART and Visitors cannot invoke moderation through UI or direct requests. Hidden content is excluded from ordinary discovery; owners can see status.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-010, US-012, US-025, US-027, US-028

---

<a id="us-027"></a>

#### US-027: Administrative Account Management and Enforcement

**Delivery Category:** Must-Have — MVP

**User/Role:** ADMIN

**Story Statement:** As a Platform Administrator, I want to suspend or deactivate non-compliant accounts, so that bad actors cannot harass students or disrupt team formation.

**Description:** MVP suspension and authorized deletion controls. The retained 30-day deletion target is a proposed product service policy, not an assertion of automatic PIPEDA/GDPR applicability; policy R-06 records the remaining retention decision.

**Acceptance Criteria:**
1. Only ADMIN inspects account identifier, role, state, and relevant listings; credentials, OTPs, and private team notes are not exposed.
2. Suspension revokes sessions, blocks sign-in, cancels pending applications/incoming invitations, and hides the profile. Pause owned unlocked-team recruitment and cancel outgoing invitations; do not delete unrelated teams or confirmed memberships.
3. Record an ownership-verified deletion request and process live PII within the proposed 30-day target. Pseudonymize historical memberships; an unlocked owner must disband before deletion. Preserve locked membership integrity without identifying fields.
4. Backups, audits, and note revisions follow NR-023; confirm unresolved retention policy before production. Public ADMIN registration/self-promotion is prohibited.
5. Record actor, reason, outcome, and time for account actions. Non-ADMIN users cannot invoke the controls.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-003, US-004, US-010, US-026, US-028

---

<a id="us-028"></a>

#### US-028: Administrative Audit Review and Filtering

**Delivery Category:** Should-Have — early post-MVP

**User/Role:** ADMIN

**Story Statement:** As an Administrator, I want to review and filter administrative action records, so that I can investigate past decisions.

**Description:** Post-MVP searchable interface over basic records already required by US-010/026/027. Append-only means ordinary application actors cannot edit records; it does not mean infrastructure-proof storage or exemption from privacy policy.

**Acceptance Criteria:**
1. Display event, moderation, and account action records already collected in MVP.
2. Show record ID, actor identifier, action type, target, safe state summary, reason/outcome, and UTC time.
3. ADMIN has read-only audit access; PART and Visitors are denied. Ordinary application controls cannot alter/delete entries.
4. Filters by actor, action type, and date return only matches with an empty state for no results. Retention/pseudonymization follows NR-023.

**Priority:** Medium

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-010, US-026, US-027
