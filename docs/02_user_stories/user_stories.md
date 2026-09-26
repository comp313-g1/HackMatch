# User Stories

## Overview

This document defines HackMatch user stories using the roles established in [Roles and Personas](../01_roles_and_personas/roles_and_personas.md). The system architecture defines two global authenticated account types (**Participant** — `PART`, and **Platform Administrator** — `ADMIN`), one contextual permission set (**Team Lead** — `LEAD`, assumed by a `PART` who creates a team), and one unauthenticated public state (**Unauthenticated Visitor** — `VISITOR`).

The specification covers twenty-seven core MVP user stories and two future-scope stories (US-016, US-029), totaling **twenty-nine user stories** organized across six cohesive feature areas. This expanded suite provides balanced workload distribution across a 6-person engineering team, eliminates ambiguous compound features, and enforces rigorous end-to-end traceability with upstream roles and downstream technical requirements.

### Structure of a User Story

Every story below follows the standardized format:
- **Identifier:** A unique sequential identifier in the format `US-XXX`.
- **User/Role:** The specific user role (`VISITOR`, `PART`, `LEAD`, `ADMIN`).
- **Story Statement:** *"As a [user role], I want to [action/capability], so that [benefit/value]."*
- **Description:** Contextual details, business rules, and architectural intent.
- **Acceptance Criteria:** A numbered list of specific, testable conditions.
- **Priority:** High, Medium, or Low.
- **Complexity/Effort Estimate:** Small, Medium, or Large.
- **Related Stories:** Cross-referenced sequential identifiers.

---

## User Stories by Feature Area

| Feature Area | MVP Stories | Future Stories |
|---|---|---|
| **1. Authentication and Participant Profiles** | US-001, US-002, US-003, US-004, US-005, US-006, US-007 | US-029 |
| **2. Hackathon Directory and Event Management** | US-008, US-009, US-010 | — |
| **3. Team Recruitment and Looking-for-Team Boards** | US-011, US-012, US-013, US-014 | — |
| **4. Rule-Based Matching** | US-015 | US-016 |
| **5. Invitations, Applications, and Rosters** | US-017, US-018, US-019, US-020, US-021, US-022, US-023, US-024 | — |
| **6. Platform Administration and Trust** | US-025, US-026, US-027, US-028 | — |

---

### Feature Area 1: Authentication and Participant Profiles

These stories govern account creation, federated single sign-on, multi-factor credential authentication, session security, profile management, and historical hackathon records.

#### US-001: Participant Registration and Email Verification

**User/Role:** VISITOR

**Story Statement:** As an unauthenticated visitor, I want to create an account with my email and password and verify my email address, so that I can establish a verified Participant profile.

**Description:** Standard email/password registration creates a `PART` account in an `Unverified` state. Full access to interactive team formation is gated behind cryptographic email verification to prevent mailbox spoofing. Public registration never grants `ADMIN` privileges.

**Acceptance Criteria:**
1. A visitor can submit their full name, academic email address, and a password complying with security complexity standards (minimum 8 characters, mixed case, numbers, special characters).
2. The system validates email format, confirms uniqueness, and dispatches a 256-bit cryptographically secure verification token link expiring in 24 hours.
3. Clicking a valid verification link transitions the account to `Verified` status; expired or tampered links return an explanatory error.
4. An unverified account cannot declare availability, create teams, submit applications, or accept invitations.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-002, US-003, US-004, US-005

---

#### US-002: Federated OAuth Registration and Authentication

**User/Role:** VISITOR / PART

**Story Statement:** As a visitor or Participant, I want to register and sign in using my Google or GitHub account, so that I can access the platform quickly without creating separate credentials.

**Description:** Provides frictionless third-party authentication via Google OAuth 2.0 and GitHub OAuth. First-time OAuth sign-in automatically provisions a verified `PART` account and pre-populates relevant developer attributes (e.g., GitHub profile URL, avatar).

**Acceptance Criteria:**
1. A visitor can initiate single-click sign-in via "Continue with Google" or "Continue with GitHub".
2. Successful identity provider authorization returns a verified token; if no account exists with that email, a new `PART` record is automatically created in `Verified` state.
3. GitHub OAuth authorization securely captures and verifies the user's public GitHub handle and repository portfolio link.
4. If an existing account registered with email/password shares the verified OAuth email, the accounts are linked without data loss.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-001, US-003, US-006

---

#### US-003: User Login and Session Management

**User/Role:** PART / ADMIN

**Story Statement:** As an authenticated user, I want to submit my credentials securely and maintain an active session, so that I can access features authorized for my role.

**Description:** Validates credentials for existing `PART` and `ADMIN` accounts and coordinates the transition into the mandatory Login Multi-Factor Authentication workflow (US-004) before issuing a cryptographically signed session token.

**Acceptance Criteria:**
1. The system verifies submitted credentials using constant-time hashing comparison (`bcrypt` / `Argon2id`) to prevent timing attacks.
2. For valid credentials, the system transitions to the secondary verification challenge in US-004 before issuing a fully authenticated session.
3. The system enforces progressive rate-limiting, locking authentication attempts after 5 consecutive failures per IP address for 15 minutes.
4. Fully authenticated sessions emit signed JWT access tokens (15-minute expiry) and refresh tokens stored in HTTP-only, `SameSite=Strict`, `Secure` cookies.
5. Explicit logout revokes the refresh token and invalidates active session state immediately.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-001, US-002, US-004, US-005

---

#### US-004: Login Multi-Factor Authentication (MFA)

**User/Role:** PART / ADMIN

**Story Statement:** As a Participant or Platform Administrator, I want to verify my identity via a one-time code sent to my email during login, so that a compromised password alone does not grant account access.

**Description:** Implements mandatory secondary identity verification for standard credential logins. After primary password verification, a time-limited one-time password (OTP) is dispatched to the account's verified email.

**Acceptance Criteria:**
1. Following successful password entry, the system generates a 6-digit numeric OTP valid for exactly 10 minutes and dispatches it to the user's verified email address.
2. The user is prompted with an MFA challenge view; submitting the matching current OTP completes authentication and issues session tokens.
3. Submitting an incorrect code increments an invalid attempt counter; 3 failed OTP entries invalidate the code and terminate the login sequence.
4. Expired or previously consumed OTPs are rejected immediately.
5. Users authenticated through federated OAuth (US-002) are exempted from email OTP challenges if the provider enforces multi-factor security.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-001, US-002, US-003, US-005

---

#### US-005: Password Recovery for PART/ADMIN

**User/Role:** PART / ADMIN

**Story Statement:** As a user, I want to request a secure password reset link via my registered email, so that I can regain access if I forget my password.

**Description:** Self-service password recovery issuing single-use, time-limited cryptographic reset tokens. Resetting credentials terminates all existing active sessions.

**Acceptance Criteria:**
1. Submitting a registered email address dispatches a single-use password reset link expiring in 60 minutes.
2. The submission endpoint returns a generic confirmation message regardless of whether the email exists to prevent user enumeration.
3. Clicking a valid token presents a password update form enforcing system complexity rules.
4. Successful password update invalidates all active refresh tokens and sessions across all devices.

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-001, US-003, US-004

---

#### US-006: Participant Profile Management

**User/Role:** PART

**Story Statement:** As a Participant, I want to maintain my technical profile with my role, skill tags, academic institution, and portfolio links, so that prospective teammates can assess my capabilities.

**Description:** Stores primary technical attributes, skill pills, and external developer portfolio links. Provides public privacy boundaries separating public profile cards from private account settings.

**Acceptance Criteria:**
1. A Participant can manage structured profile fields: Primary Role (`Frontend`, `Backend`, `Mobile`, `AI/ML`, `UI/UX`, `Pitch`), Academic Institution, and standardized technical skill pills.
2. A Participant can add verified links to their GitHub repository portfolio, Devpost profile, and LinkedIn URL.
3. Public profile views redact sensitive private data (email, phone, system IDs), displaying only public handles and verified skill pills.
4. Profile edits persist immediately and update existing candidate listings.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-001, US-002, US-007, US-011, US-015

---

#### US-007: Participant Hackathon History and Portfolio Verification

**User/Role:** PART

**Story Statement:** As a Participant, I want to record past hackathons attended and project achievements, so that Team Leads can verify my delivery track record and experience tier.

**Description:** Dedicated participation history module allowing hackers to document past event participation, team roles, and external project repository URLs. The system calculates an objective experience tier based on verified records.

**Acceptance Criteria:**
1. A Participant can add historical hackathon entries specifying: Event Name, Year/Date, Team Role, Project Title, and external Devpost/GitHub repository URL.
2. The system automatically computes and displays an Experience Tier badge: `Beginner` (0 hackathons), `Competitor` (1–3 hackathons), or `Veteran` (4+ hackathons).
3. Other users viewing the profile can inspect historical entries and click verified project repository links.
4. A Participant can edit or remove historical entries at any time.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-006, US-014, US-015

---

#### US-029: Time-Based Authenticator App (TOTP) Multi-Factor Authentication (Post-MVP v1.1)

**User/Role:** PART / ADMIN

**Story Statement:** As a Participant or Platform Administrator, I want to link a standard authenticator app (such as Google Authenticator or Microsoft Authenticator) to my account, so that I can generate instant 6-digit verification codes on my mobile device without waiting for email delivery.

**Description:** Implements RFC 6238 Time-Based One-Time Password (TOTP) verification as a high-security, zero-latency alternative to email-based OTP. During profile security setup, users scan a generated QR code containing an encrypted shared secret. Subsequent logins challenge for the current 6-digit TOTP code.

**Acceptance Criteria:**
1. A user can initiate authenticator app setup from their account security settings, generating a unique base32 shared secret and an inline QR code (`otpauth://` URI).
2. The user must confirm setup by entering a valid 6-digit code generated by their authenticator app before TOTP is activated on the account.
3. Upon activation, the system provides 8 single-use alphanumeric backup recovery codes for emergency account access.
4. During subsequent logins, users with active TOTP are prompted for their 6-digit authenticator code instead of receiving an email OTP, with a fallback link to receive an email code.
5. Entering an invalid code 3 consecutive times temporarily locks the MFA challenge sequence.

**Priority:** Low

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-003, US-004

---

### Feature Area 2: Hackathon Directory and Event Management

These stories define crowdsourced event discovery, unlisted event creation requests by Team Leads, and administrative verification workflows that maintain a single source of truth without requiring a separate Organizer account role.

#### US-008: Public Hackathon Discovery and Multi-Filter Search

**User/Role:** VISITOR / PART

**Story Statement:** As a visitor or Participant, I want to browse and filter upcoming hackathons, so that I can identify events I want to attend and inspect available teams.

**Description:** A centralized directory presenting verified and pending hackathon listings. Visitors can explore listings without logging in; joining or creating teams requires an authenticated `PART` account.

**Acceptance Criteria:**
1. Users can browse a directory of hackathons displaying Event Title, Dates, Format (`In-Person`, `Hybrid`, `Virtual`), Location/City, Max Team Size, and verified status badge (`Verified` vs. `Pending Verification`).
2. Search and filter engine allows filtering by keyword, format, and status (`Upcoming`, `Ongoing`, `Concluded`).
3. Each event card provides a direct link to the canonical official external hackathon website.
4. Selecting an event opens its team formation board, showing active team recruitment listings for that hackathon.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-009, US-010, US-011, US-013

---

#### US-009: Team Lead Crowdsourced Event Registration Request

**User/Role:** PART acting as Team Lead (LEAD)

**Story Statement:** As a Team Lead, I want to submit an unlisted hackathon with its official website URL, dates, and team size limit, so that I can immediately form a team under it while awaiting administrative verification.

**Description:** When a Team Lead searches for an event that does not exist in the directory, they can crowdsource its creation. The event is optimistically instantiated in a `Pending Verification` state, allowing the Lead to immediately create their team and begin recruiting without waiting for asynchronous admin approval.

**Acceptance Criteria:**
1. When directory search returns no match, a Team Lead can open an event creation modal.
2. The modal enforces strict schema validation: Event Title, Canonical Event Website URL (must be a valid RFC 3986 HTTPS URI), Start Date, End Date ($\text{End} \ge \text{Start}$), Format, and Max Team Size ($2 \le \text{size} \le 6$).
3. Submitting the form instantiates a canonical `Hackathon` record with status `Pending Verification` and automatically submits a review ticket to the Administrative Event Verification Queue.
4. The Team Lead is immediately redirected to team initialization under this new event; the resulting team card displays an `Unverified Event` badge to viewers.
5. The search engine indexes pending events to prevent duplicate creation requests if other students search for the same hackathon.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-008, US-010, US-012

---

#### US-010: Administrative Event Verification, Correction, and Lifecycle Management

**User/Role:** ADMIN

**Story Statement:** As a Platform Administrator, I want to review, correct, and verify crowdsourced hackathon submissions and manage published listings, so that the platform maintains an accurate single source of truth.

**Description:** Administrators access an Event Verification Queue to inspect unverified hackathons submitted by Team Leads. Administrators validate external links, correct factual metadata mismatches (e.g., aligning team size caps with official website rules), merge duplicate submissions, or reject malicious requests.

**Acceptance Criteria:**
1. An Administrator can access the Event Verification Queue to inspect pending event submissions, view the requester's profile, and click through to the submitted external event URL.
2. The Administrator has full edit privileges to factually correct mismatched metadata (e.g., updating team size limits from 6 to 4 if official rules mandate 4, adjusting dates, or correcting broken URLs) prior to approval.
3. The Administrator can click `Approve & Publish`, which transitions the event status to `Verified`, upgrades all associated team listings to verified status, and makes the event visible in the default public directory.
4. The Administrator can `Merge` a submission into an existing verified event if a duplicate is detected, automatically rebinding all attached teams to the canonical record.
5. The Administrator can `Reject` a submission with mandatory feedback notes (e.g., "Phishing link detected" or "Event canceled"); rejecting an event soft-deletes attached unverified team listings and alerts the creator.
6. The Administrator can toggle published events to `Archived / Concluded` once event end dates pass, locking membership mutations.

**Priority:** High

**Complexity/Effort Estimate:** Large

**Related Stories:** US-008, US-009, US-026

---

### Feature Area 3: Team Recruitment and Looking-for-Team Boards

These stories govern event-specific participant availability declarations, structured vacancy-based recruitment listings, self-service editing by Team Leads, open vacancy discovery, and multi-filter candidate search.

#### US-011: Declare Event Availability and Looking-for-Team Status

**User/Role:** PART

**Story Statement:** As a Participant, I want to declare my availability for a specific hackathon and state my desired role and commitment level, so that Team Leads can discover me as an available candidate.

**Description:** Participant availability is strictly scoped to an event. Participants specify event-specific preferences without altering their global profile. Availability flags automatically deactivate upon confirmed team placement.

**Acceptance Criteria:**
1. An authenticated Participant can toggle "Looking for Team" for any verified or pending hackathon.
2. The availability declaration captures: Desired Event Role, Commitment Hours (e.g., "15–20 hours / Part-Time" vs. "Full Weekend / 36 hours"), and Competitive Goal (`Casual / Learning`, `Pragmatic Completion`, `Competitive / Prize-Hunting`).
3. Declared availability appears in the event candidate directory and feeds into the candidate recommendation engine (US-015).
4. Once the Participant confirms membership on a team for that hackathon (US-019 or US-020), the system automatically deactivates their "Looking for Team" flag for that event.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-006, US-007, US-012, US-014, US-015, US-019, US-022

---

#### US-012: Create and Manage a Team Recruitment Listing

**User/Role:** PART acting as Team Lead (LEAD)

**Story Statement:** As a Team Lead, I want to create a structured recruitment listing with discrete skill vacancy slots and edit it as our needs evolve, so that I can attract targeted teammates.

**Description:** A Team Lead binds a team listing to a target hackathon. Instead of generic open text, the listing defines explicit vacancy slots. The Team Lead maintains full self-service edit control over project concepts and open slot requirements prior to roster lock.

**Acceptance Criteria:**
1. A Participant can initialize a team listing bound to a hackathon, specifying Team Name, Project Concept Pitch (max 500 characters), Team Objective, and external communication link (e.g., Discord/Slack URL).
2. The Team Lead can create up to $(\text{MaxTeamSize} - 1)$ discrete vacancy slots, each specifying a Target Role (`Frontend`, `Backend`, `Mobile`, `AI/ML`, `UI/UX`, `Pitch`) and required skill tags.
3. The Team Lead can self-service edit the project pitch, add/remove open vacancy slots, and update required skill tags at any time prior to roster locking without administrative intervention.
4. Total roster count plus unfilled vacancy slots cannot exceed the event's configured `max_team_size`.
5. The Team Lead can remove an unconfirmed member or disband the team prior to roster lock, reopening available slots and updating availability states.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-009, US-011, US-013, US-015, US-017, US-022

---

#### US-013: Browse and Filter Open Team Vacancies

**User/Role:** PART

**Story Statement:** As a Participant, I want to browse and filter open team vacancy slots for a hackathon, so that I can identify teams matching my technical stack and project goals.

**Description:** Participants inspect active recruitment boards for a specific event. Listings display remaining open slots, required skill pills, and team objectives.

**Acceptance Criteria:**
1. The event recruitment board displays active teams with at least one unfilled vacancy slot.
2. Participants can filter team cards by required skill tags, open role categories, team goal, and available slot count.
3. Team detail cards display the project pitch, current roster member handles with role badges, and explicit vacancy requirements.
4. Each unfilled vacancy slot exposes an "Apply to Slot" button linking directly to US-018.

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-008, US-012, US-016, US-018

---

#### US-014: Advanced Candidate Directory Search and Filter for Team Leads

**User/Role:** PART acting as Team Lead (LEAD)

**Story Statement:** As a Team Lead, I want to search and filter the event candidate pool using specific skill combinations and experience tiers, so that I can manually discover candidates who fit our vacancy needs.

**Description:** Dedicated candidate discovery directory for Team Leads. Complements algorithmic recommendations with multi-parameter filter controls across declared participant skills, experience tiers, and availability.

**Acceptance Criteria:**
1. A Team Lead can search the looking-for-team candidate pool for their active hackathon.
2. The filter interface supports multi-tag skill filtering (AND/OR logic), minimum experience tier (`Beginner`, `Competitor`, `Veteran`), and target role.
3. Search results render candidate summary cards showing handle, primary role, experience badge, matching skill pills, and past hackathon counts.
4. The Team Lead can open the candidate's verified profile card or trigger a direct team invitation (US-017).

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-006, US-007, US-011, US-012, US-015, US-017

---

### Feature Area 4: Rule-Based Matching

These stories compute deterministic compatibility scores between solo participant availability profiles and open team vacancy requirements.

#### US-015: Candidate Recommendations for Team Leads

**User/Role:** PART acting as Team Lead (LEAD)

**Story Statement:** As a Team Lead, I want to view a ranked list of compatible candidates for my team's open vacancy slots, so that I can invite teammates with complementary skills and matching commitments.

**Description:** Computes an explainable, deterministic compatibility score ($0\text{--}100\%$) between open vacancy slot requirements and available event candidates. Excludes candidates already confirmed on another team for that hackathon.

**Acceptance Criteria:**
1. A Team Lead can trigger candidate recommendations for any unfilled vacancy slot on their team.
2. The system computes a composite compatibility score based on: Skill Overlap (matching declared candidate skills against slot requirements), Goal Alignment (matching stated hackathon objectives), and Schedule Compatibility (matching commitment hours).
3. The recommendation interface displays candidates in descending order of compatibility score, highlighting overlapping skill badges and common goals.
4. Candidates already confirmed on a locked or full roster for that hackathon are excluded from recommendation rankings.
5. The Team Lead can issue a direct team invitation (US-017) directly from any recommendation card.

**Priority:** High

**Complexity/Effort Estimate:** Large

**Related Stories:** US-006, US-007, US-011, US-012, US-014, US-017, US-022

---

#### US-016: Recommended Teams for Participants (Future Scope)

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

#### US-017: Issue a Team Invitation

**User/Role:** PART acting as Team Lead (LEAD)

**Story Statement:** As a Team Lead, I want to issue a direct invitation to an available candidate, so that they can review my team and decide whether to join.

**Description:** Dispatches an invitation bound to a specific team and hackathon. Implements time-to-live expiration and prevents capacity over-subscription.

**Acceptance Criteria:**
1. A Team Lead can issue an invitation to any candidate marked "Looking for Team" for that hackathon, provided the team has at least one unfilled vacancy slot.
2. The invitation enters a `Pending` state, generates an in-app notification for the candidate (US-021), and records an expiration timestamp (48-hour TTL).
3. The system enforces an invitation cap: a Team Lead cannot have more active pending invitations than total remaining unfilled vacancy slots.
4. The Team Lead can cancel a pending invitation prior to candidate response, restoring the invite quota.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-012, US-014, US-015, US-019, US-021, US-022

---

#### US-018: Apply to Join a Team Vacancy

**User/Role:** PART

**Story Statement:** As a Participant, I want to submit an application to an open team vacancy slot, so that the Team Lead can review my profile and consider me for membership.

**Description:** Allows solo participants to express interest in specific vacancy slots. Rate-limited to prevent platform-wide spam applications.

**Acceptance Criteria:**
1. A Participant can apply to any open vacancy slot on an active team for an event where they are not yet confirmed.
2. The application captures an optional brief introductory message (max 250 characters) and references the applicant's verified profile.
3. The system restricts each Participant to a maximum of 3 concurrent active (`Pending`) applications per hackathon.
4. The applicant can view the status of their submitted applications and withdraw a pending application at any time prior to Team Lead review.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-012, US-013, US-020, US-021

---

#### US-019: Respond to a Team Invitation

**User/Role:** PART

**Story Statement:** As an invited Participant, I want to accept or decline a team invitation, so that I can confirm my team placement or keep looking.

**Description:** Allows an invited candidate to inspect team details and make a binding decision. Acceptance confirms roster placement and resolves cross-event constraints.

**Acceptance Criteria:**
1. An invited Participant can view details of pending invitations (team pitch, roster members, goal, and assigned role).
2. Clicking `Accept` updates the invitation to `Accepted`, assigns the user to the team roster, deactivates their "Looking for Team" flag for that hackathon, automatically cancels all other pending incoming invitations and automatically withdraws all active applications submitted by the user for that hackathon, and dispatches a notification to the Team Lead.
3. Acceptance is wrapped in an atomic transaction: if the team reached full capacity via concurrent application approval before the invitee clicks accept, the system aborts with a `"Team Capacity Reached"` notice.
4. Clicking `Decline` marks the invitation `Declined`, alerts the Team Lead, and leaves the user's availability flag unchanged.
5. An accepted member can leave the team prior to roster lock, which reopens the vacancy slot and restores their "Looking for Team" availability status.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-011, US-017, US-020, US-021, US-022

---

#### US-020: Team Lead Approves or Declines an Application

**User/Role:** PART acting as Team Lead (LEAD)

**Story Statement:** As a Team Lead, I want to review incoming applications and approve or decline candidates, so that I can select the best teammates for our vacancies.

**Description:** Enables Team Leads to triage incoming applications. Handles slot assignment and automatic cancellation of excess pending requests upon capacity saturation.

**Acceptance Criteria:**
1. A Team Lead can inspect pending applications for each vacancy slot, reviewing candidate profiles, verified skill badges, and introductory notes.
2. Clicking `Approve` assigns the applicant to the roster, fills the corresponding vacancy slot, deactivates the applicant's availability flag for that event, and notifies the candidate.
3. If approving an application fills the team's final open vacancy slot, all remaining pending invitations and incoming applications are automatically set to `Canceled - Team Full`.
4. Clicking `Decline` marks the application `Declined` and alerts the applicant without altering roster state.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-012, US-018, US-019, US-021, US-022

---

#### US-021: In-App Notification Center and Real-Time Recruitment Alerts

**User/Role:** PART / LEAD

**Story Statement:** As an active user, I want an in-app notification center that alerts me to invitations, applications, and event verification updates, so that I can take timely action.

**Description:** Dedicated notification center tracking state-change alerts across recruitment lifecycles. Surfaces unread counts in navigation bars and supports marking notifications as read.

**Acceptance Criteria:**
1. The global navigation bar displays an interactive notification bell icon with an unread badge counter.
2. The notification dropdown renders distinct alert types: Inbound Invitations, Join Applications Received, Application Approval/Decline Decisions, Roster Confirmation, and Event Verification Approvals.
3. Clicking a notification redirects the user directly to the relevant action view (e.g., Invitation response modal or Team review view).
4. Users can mark individual notifications as read or click "Mark all as read".

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-009, US-010, US-017, US-018, US-019, US-020

---

#### US-022: Confirm and Lock a Team Roster

**User/Role:** PART acting as Team Lead (LEAD)

**Story Statement:** As a Team Lead, I want to confirm and lock my team's roster, so that our membership is finalized and membership mutations are frozen.

**Description:** Freezes roster composition prior to the hackathon. Prevents further membership changes and unlocks access to the team coordination workspace and check-in manifest.

**Acceptance Criteria:**
1. The Team Lead can initiate roster locking once the team contains at least 2 confirmed members and does not exceed the event's `max_team_size`.
2. Locking transitions the team state to `Confirmed / Locked`.
3. Once locked, all invitation, application, and member removal actions are permanently disabled.
4. Locking the roster unlocks the Private Team Coordination Workspace (US-023) and activates the Check-In Manifest Export (US-024).

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-011, US-012, US-015, US-017, US-019, US-020, US-023, US-024

---

#### US-023: Team Private Coordination Workspace

**User/Role:** PART / LEAD

**Story Statement:** As a confirmed team member, I want to access a private team workspace with shared communication links, project concept notes, and teammate contacts, so that we can coordinate before the hackathon begins.

**Description:** A secure, authenticated workspace accessible exclusively to confirmed members of a locked or active team. Centralizes external tool links, team notes, and contact channels.

**Acceptance Criteria:**
1. Only authenticated members of a specific team can access its private workspace view; unauthorized users are blocked with an HTTP 403 response.
2. The workspace displays teammate contact handles, verified GitHub links, and assigned role badges.
3. The Team Lead can post and update external workspace links (e.g., Discord/Slack channel, shared Google Doc, Figma board, GitHub repository URL).
4. Members can view a shared markdown project concept note to align on technical stack and architecture before the event.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-012, US-019, US-022, US-024

---

#### US-024: Export Team Manifest and Check-In Verification Card

**User/Role:** PART acting as Team Lead (LEAD)

**Story Statement:** As a Team Lead of a locked roster, I want to export a verified team manifest and digital check-in card, so that our team can verify our roster at official hackathon registration.

**Description:** Generates a standardized, exportable summary card of the confirmed roster for event check-in and sponsor presentation.

**Acceptance Criteria:**
1. A Team Lead of a locked team can click "Export Team Manifest".
2. The system generates a clean, printable HTML/PDF view and a downloadable JSON file containing: Team Name, Event Name, Lock Timestamp, and a member list (Full Names, Academic Institution, GitHub Handles, and Assigned Roles).
3. The manifest includes a verifiable verification hash confirming that the roster was locked prior to the hackathon start date.
4. Confirmed members can download or print the manifest for check-in.

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-010, US-022, US-023

---

### Feature Area 6: Platform Administration and Trust

These stories govern user abuse reporting, administrative moderation, account enforcement, and immutable audit logging to protect students from spam, harassment, and phishing threats.

#### US-025: User Reporting Modal for Abusive Content and Malicious Links

**User/Role:** PART

**Story Statement:** As a Participant, I want to report an abusive profile, offensive team listing, or suspicious external URL, so that Administrators can investigate misconduct.

**Description:** Self-service reporting modal available across candidate profiles, team cards, and event listings. Submissions feed directly into the administrative moderation queue.

**Acceptance Criteria:**
1. Authenticated Participants can click "Report" on any public team card, user profile, or unverified event listing.
2. The report modal captures: Target Entity ID, Category (`Harassment / Code of Conduct`, `Spam / Advertising`, `Phishing / Malicious Link`, `Fake Account`), and optional explanatory text.
3. The system enforces an abuse throttle: maximum 5 reports per user per hour to prevent griefing.
4. Submitting a report queues an actionable ticket in the Administrative Moderation Queue (US-026) and returns a submission confirmation.

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-006, US-012, US-026

---

#### US-026: Administrative Content Moderation and Safety Queue

**User/Role:** ADMIN

**Story Statement:** As a Platform Administrator, I want to review flagged team content and malicious links in a moderation queue, so that the platform remains safe, compliant, and free of phishing threats.

**Description:** Centralized moderation dashboard allowing administrators to triage user reports, redact offensive text, hide non-compliant team listings, and sanitize malicious URLs.

**Acceptance Criteria:**
1. An Administrator can access the Moderation Queue displaying reported team listings and user profiles sorted by report frequency and timestamp.
2. The Administrator can inspect the reported entity, view the reporter's rationale, and take action: `Dismiss Report`, `Redact Listing Text`, `Issue Warning`, or `Hide from Directory`.
3. If an event or team listing contains a verified phishing or malicious link, the Administrator can purge the URL immediately and flag the owner's account for suspension.
4. Every moderation decision records an immutable audit entry (US-028).

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-010, US-012, US-025, US-027, US-028

---

#### US-027: Administrative Account Management and Enforcement

**User/Role:** ADMIN

**Story Statement:** As a Platform Administrator, I want to suspend or deactivate non-compliant accounts, so that bad actors cannot harass students or disrupt team formation.

**Description:** Administrative account lifecycle controls to enforce codes of conduct and process student right-to-be-forgotten deletion requests under PIPEDA/GDPR compliance.

**Acceptance Criteria:**
1. An Administrator can inspect an account record, viewing authentication status, report history, and attached team listings.
2. The Administrator can deactivate or suspend an account; suspension immediately revokes all active auth tokens, cancels active applications/invites, and hides the user profile from search.
3. An Administrator can execute an authorized account deletion request, permanently purging personally identifiable information (PII) within 30 days in compliance with privacy regulations.
4. Regular Participants and Visitors cannot access administrative account controls.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-003, US-004, US-010, US-026, US-028

---

#### US-028: Immutable Administrative Audit Logging

**User/Role:** ADMIN

**Story Statement:** As a Platform Administrator, I want the system to maintain an immutable log of all moderation actions and event verification decisions, so that platform governance remains transparent and auditable.

**Description:** Comprehensive system audit log capturing administrative actions, state mutations, and timestamps. Essential for platform compliance and governance oversight.

**Acceptance Criteria:**
1. The system automatically records an append-only audit entry whenever an Administrator: approves/rejects/merges a hackathon event, redacts a listing, issues a warning, or suspends an account.
2. Audit records capture: Log ID, Admin User ID, Action Type (`EVENT_APPROVE`, `EVENT_MERGE`, `CONTENT_REDACT`, `USER_SUSPEND`), Target Entity ID, Prior State, New State, and UTC Timestamp.
3. Audit log records are read-only and cannot be altered, updated, or deleted through the web application interface.
4. Administrators can filter audit logs by Admin ID, Action Type, and date range.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-010, US-026, US-027
