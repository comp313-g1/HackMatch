# User Stories

## Overview

This document specifies the complete functional user story backlog for **HackMatch**. Each user story captures a discrete, testable capability from the perspective of an authenticated or unauthenticated actor, defined in [`docs/01_roles_and_personas/roles_and_personas.md`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/01_roles_and_personas/roles_and_personas.md).

All stories follow the standardized agile format, establishing traceability between high-level business goals from the Project Proposal and downstream MVP definitions, system architecture, and verification test suites.

### Structure of a User Story
Each story contains:
- **Identifier:** Canonical identifier (`US-001` through `US-017`).
- **User/Role:** Mapped to defined role codes (`GUEST`, `DEV`, `CAPT`, `ORG`, `ADMIN`).
- **Story Statement:** Focused user value proposition (`As a... I want to... So that...`).
- **Description:** Operational context, boundary rules, and constraints.
- **Acceptance Criteria:** Concrete, testable, numbered pass/fail criteria.
- **Priority:** High / Medium / Low.
- **Complexity/Effort Estimate:** Small / Medium / Large.
- **Related Stories:** Cross-referenced story dependencies.

---

## User Stories by Feature Area

```
Feature Area 1: Authentication & User Profiles (US-001 to US-003)
Feature Area 2: Hackathon Directory & Event Management (US-004 to US-006)
Feature Area 3: Team Recruitment & Looking-for-Team Boards (US-007 to US-009)
Feature Area 4: Rule-Based Matching & Teammate Recommendations (US-010 to US-011)
Feature Area 5: Invitations, Applications & Roster Management (US-012 to US-015)
Feature Area 6: Moderation, Platform Governance & Trust (US-016 to US-017)
```

---

### Feature Area 1: Authentication & User Profiles

Capabilities enabling participants to securely authenticate, prove academic/student affiliation, and maintain rich profiles detailing skills, technical stack, portfolio links, and hackathon experience.

#### US-001: User Registration & Email Verification

**User/Role:** `GUEST`

**Story Statement:** As an unauthenticated visitor, I want to create a HackMatch account using my email and password, so that I can participate in hackathon team formation.

**Description:** New users must establish an authenticated identity before accessing interactive team-formation features. The system must support registration with email validation and password complexity enforcement, and send an email verification token before account activation to minimize bot creation and spam.

**Acceptance Criteria:**
1. Registration form captures email address, full name, password, and confirmation password.
2. System enforces password strength: minimum 8 characters, at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.
3. System rejects already-registered email addresses with an inline warning without exposing sensitive user state.
4. Upon successful form submission, the system creates an unverified account record and dispatches a cryptographic verification link valid for 24 hours.
5. Clicking the verification link activates the account and redirects the user to the initial Profile Onboarding wizard.
6. Unverified accounts attempting to log in are prompted with a resend verification option and blocked from interactive features.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-002, US-003

---

#### US-002: User Authentication & Session Management

**User/Role:** `DEV`

**Story Statement:** As a registered student participant, I want to securely log in and maintain an authenticated session, so that I can access my dashboard and team workflows across devices.

**Description:** Handles secure login, credential verification, session token issuance, password recovery, and secure logout.

**Acceptance Criteria:**
1. Login form authenticates valid email and password credentials, issuing a secure HTTP-only session cookie or JWT token.
2. System rejects invalid credentials with a generic error message: *"Invalid email or password."*
3. System locks account login attempts for 15 minutes after 5 consecutive failed attempts from the same IP address.
4. Users can request a password reset link by submitting their registered email address.
5. Users can explicitly log out, immediately invalidating the session token on both client and server.

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-001, US-003

---

#### US-003: Participant Profile Management

**User/Role:** `DEV`

**Story Statement:** As a student participant, I want to curate a comprehensive developer and designer profile, so that prospective teammates and matching algorithms can evaluate my capabilities.

**Description:** The profile is the core data asset powering HackMatch. It captures technical competencies (programming languages, frameworks, cloud/tools), primary disciplines (Frontend, Backend, Full-Stack, Mobile, AI/ML, UI/UX Design, Product Pitch), academic institution, experience level, time zone, and external links (GitHub, LinkedIn, Portfolio).

**Acceptance Criteria:**
1. Profile edit view allows users to select primary disciplines (e.g., Frontend, Backend, UI/UX) and tag technical skills from a standardized autocomplete taxonomy.
2. Users can declare their hackathon experience tier: *"Beginner (0 events)"*, *"Intermediate (1–3 events)"*, or *"Veteran (4+ events)"*.
3. Users can add external links (GitHub username, LinkedIn URL, Portfolio URL) with URL format validation.
4. Users can specify their academic institution, degree program, and anticipated graduation year.
5. Profile changes persist immediately upon clicking "Save Changes" and display a success toast notification.
6. Public-facing profile view renders all non-sensitive profile information while concealing private account details (email, password hashes, audit logs).

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-001, US-007, US-010

---

### Feature Area 2: Hackathon Directory & Event Management

Capabilities providing a centralized repository of hackathons, allowing organizers to publish verified event listings and participants to discover hackathons by date, format, and themes.

#### US-004: Public Hackathon Discovery & Filtering

**User/Role:** `GUEST` / `DEV`

**Story Statement:** As a site visitor or participant, I want to browse and search upcoming hackathons with structured filters, so that I can discover events relevant to my schedule and interests.

**Description:** Provides the public event directory. Users can inspect event dates, formats (In-Person, Hybrid, Virtual), location, prize tracks, and registration deadlines without requiring an account.

**Acceptance Criteria:**
1. Directory displays upcoming hackathons in chronological order by event start date.
2. Search bar filters hackathons by title, host organization, or city/campus keyword.
3. Filter panel allows filtering by format (Virtual, In-Person, Hybrid) and status (Upcoming, Registration Open, Concluded).
4. Each hackathon card displays event title, banner image, dates, format, location/virtual badge, and an indicator of active teams looking for members.
5. Clicking an event card opens the Hackathon Detail page with full description, rules, official registration link, and the event's "Looking for Team" board.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-005, US-007, US-009

---

#### US-005: Hackathon Listing Creation & Management

**User/Role:** `ORG`

**Story Statement:** As a hackathon organizer, I want to submit and maintain an official event listing, so that participants can coordinate team formation for our event.

**Description:** Organizers input event metadata, official rules, team size limits (minimum and maximum roster size), and external links. Submissions are placed into a pending state until verified by platform administrators.

**Acceptance Criteria:**
1. Event creation form requires: Event Name, Host Organization, Start Date, End Date, Format (In-Person/Hybrid/Virtual), Location/Venue, Maximum Team Size (default: 4), Description, and Official Event URL.
2. System validates that Start Date is in the future and End Date is equal to or after Start Date.
3. Form allows uploading an event banner image with maximum file size 2MB and MIME-type restrictions (JPEG/PNG/WebP).
4. Upon submission, event status is set to `Pending Verification` and queued for administrative review.
5. Organizers can edit event details for draft, pending, or published events they created; critical date edits generate change log entries.

**Priority:** Medium

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-004, US-006

---

#### US-006: Event Moderation & Verification

**User/Role:** `ADMIN`

**Story Statement:** As a platform administrator, I want to review and verify submitted hackathons, so that fraudulent or low-quality listings do not mislead participants.

**Description:** Administrative oversight workflow to verify the authenticity of organizer accounts and event legitimacy before making listings visible in the public directory.

**Acceptance Criteria:**
1. Admin portal displays a dedicated queue of events with `Pending Verification` status.
2. Admin can inspect submission details, host organization credentials, and external event URLs.
3. Admin can approve an event with one click, transitioning its status to `Published` and making it immediately visible in the public directory.
4. Admin can reject an event with a mandatory text rationale sent via email to the submitting organizer.
5. Admin can unpublish or archive any existing event at any time to handle cancellations or reported fraud.

**Priority:** Medium

**Complexity/Effort Estimate:** Small

**Related Stories:** US-004, US-005, US-017

---

### Feature Area 3: Team Recruitment & Looking-for-Team Boards

Workflows allowing participants to declare team-seeking status for specific events and team captains to publish structured recruitment posts detailing required skill sets.

#### US-007: Declare Event Availability & "Looking for Team" Status

**User/Role:** `DEV`

**Story Statement:** As a participant, I want to mark myself as "Looking for Team" for a specific hackathon, so that team captains and matching algorithms know I am available.

**Description:** Availability is event-scoped: a user might look for a team in Hackathon A while skipping Hackathon B. Participants declare their specific goals (Casual/Learning vs. Competitive/Winning), hours available during the weekend, and preferred role for this specific hackathon.

**Acceptance Criteria:**
1. On the Hackathon Detail page, an authenticated user can toggle their status to *"Looking for Team"*.
2. System prompts the user to specify: (a) Event Role (e.g., Frontend, Backend, UI/UX, Mobile), (b) Goal (Casual/Fun, Learning, Competitive), and (c) Weekly/Weekend Availability commitment.
3. User profile appears in the event's "Available Participants" directory.
4. User can update or revoke their "Looking for Team" status at any time.
5. System automatically clears the "Looking for Team" flag once the user joins a confirmed team for that event.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-003, US-008, US-011, US-014

---

#### US-008: Create Team Recruitment Listing

**User/Role:** `CAPT`

**Story Statement:** As a team captain, I want to create a team recruitment post for a specific hackathon with defined skill requirements, so that I can attract suitable teammates to execute our project concept.

**Description:** Creates a team entity attached to a hackathon. The captain defines the project concept, target category, and specific unfilled skill slots (e.g., 1 UI/UX Designer, 1 Node.js Backend Dev).

**Acceptance Criteria:**
1. Captain selects a target hackathon and inputs: Team Name, Project Idea / Pitch Summary (up to 500 characters), Target Prize Track (optional), and Team Goal (Casual, Balanced, Competitive).
2. Captain defines open roster slots with required skill tags (e.g., Slot 2: `[Figma, CSS]`, Slot 3: `[Python, PyTorch]`).
3. Total team slots cannot exceed the maximum team size configured for the hackathon (e.g., 4 members).
4. Upon publication, the team listing appears on the hackathon's "Looking for Members" board.
5. Creating the team automatically assigns the creator as the Team Captain in Slot 1.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-007, US-009, US-012, US-015

---

#### US-009: Browse & Search Recruitment Listings

**User/Role:** `DEV`

**Story Statement:** As a solo participant, I want to browse and filter open team recruitment listings for an event, so that I can find teams seeking my specific skill set.

**Description:** Allows participants to discover teams needing their abilities, filtering by required skills, project themes, and competitive goals.

**Acceptance Criteria:**
1. The event team board lists all active teams with unfilled slots.
2. Filters allow filtering teams by: Open Skill Required (e.g., UI/UX, Python), Team Goal (Learning vs. Competitive), and Current Team Size.
3. Team card displays: Team Name, Captain Name, Pitch Summary, Current Roster Avatars, and Badges for Open Slots.
4. Clicking a team card opens the Team Detail view showing current members' profiles, project description, and an "Apply to Join" action.

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-007, US-008, US-013

---

### Feature Area 4: Rule-Based Matching & Teammate Recommendations

Deterministic matching engine matching candidates and teams based on complementary skill overlap, mutual goals, and schedule alignment, fulfilling the project's core differentiator.

#### US-010: Candidate Teammate Recommendations for Captains

**User/Role:** `CAPT`

**Story Statement:** As a team captain, I want to view a ranked list of recommended candidates for my team's open slots, so that I can invite the strongest complementary fits without manual scrolling.

**Description:** Implements the deterministic rule-based matching engine from the project proposal. Ranks available solo participants based on: (1) overlap between candidate skills and team open slots, (2) goal alignment (e.g., both Competitive), (3) complementary experience tiers, and (4) time availability.

**Acceptance Criteria:**
1. Team Management view displays a "Recommended Teammates" tab.
2. System computes a match score (0% to 100%) for each available candidate registered for the event.
3. Candidates matching required open slot skills receive highest weight (+40%), goal alignment (+30%), and availability compatibility (+30%).
4. Each recommendation card displays candidate name, matched skills highlighted in green, match percentage, and a direct "Invite to Team" button.
5. Candidates who are already on a confirmed team for that hackathon are excluded from recommendations.

**Priority:** High

**Complexity/Effort Estimate:** Large

**Related Stories:** US-003, US-007, US-008, US-012

---

#### US-011: Recommended Teams for Solo Participants

**User/Role:** `DEV`

**Story Statement:** As a solo participant, I want to receive recommended teams that need my exact skills, so that I can quickly apply to the most compatible groups.

**Description:** Inverse of US-010: compares a solo participant's declared profile skills and event preferences against active teams with open slots, surfacing the highest-affinity teams.

**Acceptance Criteria:**
1. Participant dashboard displays a "Top Team Matches" carousel or list for registered hackathons.
2. Recommendations rank teams where the user's primary skills satisfy an unfilled team slot.
3. Displays the match justification: *"Matches your React & TypeScript skills for Slot 2"* and *"Aligned goal: Competitive"*.
4. Users can click "Quick Apply" directly from the recommendation card.

**Priority:** Medium

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-003, US-007, US-009, US-013

---

### Feature Area 5: Invitations, Applications & Roster Management

Workflow engine managing team membership lifecycle: issuing invites, submitting applications, handling acceptances/rejections, and locking final rosters.

#### US-012: Issue Direct Team Invitation

**User/Role:** `CAPT`

**Story Statement:** As a team captain, I want to send a direct team invitation to a specific candidate, so that they can join our roster.

**Description:** Allows captains to invite candidates discovered via recommendations or search. Manages invitation state and prevents over-inviting beyond team capacity.

**Acceptance Criteria:**
1. Captain can click "Invite" from a candidate's profile or recommendation card, optionally attaching a custom invite message (max 200 characters).
2. System validates that the team has at least one unfilled slot; if full, invitation button is disabled.
3. System creates a pending invitation record and displays an in-app notification to the invitee.
4. An invitation remains in `Pending` state for 48 hours; if unaccepted, it transitions to `Expired`.
5. Captain can cancel a pending invitation at any time before acceptance.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-008, US-010, US-014, US-015

---

#### US-013: Apply to Join Team

**User/Role:** `DEV`

**Story Statement:** As a participant, I want to submit a join request to an open team, so that the captain can review my profile and admit me.

**Description:** Allows solo participants to express interest in open team slots with an optional brief introduction.

**Acceptance Criteria:**
1. Participant clicks "Apply to Join" on an open team listing and selects which open slot they are targeting.
2. Form allows entering a short pitch message (e.g., *"I have built 3 Flutter apps and can deliver the mobile client"*).
3. System restricts users to a maximum of 3 concurrent active applications per hackathon to prevent spamming.
4. Application transitions to `Pending Review` and notifies the Team Captain.
5. Participant can withdraw a pending application at any time prior to captain decision.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-008, US-009, US-014

---

#### US-014: Manage Invitation & Application Lifecycle

**User/Role:** `DEV` / `CAPT`

**Story Statement:** As a participant or captain, I want to accept or decline incoming invites and applications, so that team formation decisions are resolved quickly and transparently.

**Description:** Central notification and resolution inbox for all team requests. Resolves concurrency edge cases (e.g., accepting an invite while having other pending requests).

**Acceptance Criteria:**
1. User receives an in-app badge and notification when an invite or application is received.
2. Invitee can click "Accept" or "Decline" on a team invitation.
3. Upon accepting an invitation, the user is immediately added to the team roster, their "Looking for Team" status is revoked, and all their other pending applications are automatically canceled.
4. Captain can click "Accept" or "Decline" on incoming candidate applications.
5. If the team reaches maximum capacity, all remaining pending invitations and applications for that team are automatically transitioned to `Team Full / Canceled`.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-012, US-013, US-015

---

#### US-015: Roster Finalization & Export

**User/Role:** `CAPT`

**Story Statement:** As a team captain, I want to finalize and lock our team roster, so that we can export our confirmed team details for hackathon registration and check-in.

**Description:** Once a team is assembled, the captain finalizes the roster. This locks team membership, prevents mid-event roster tampering, and generates a formatted team summary (with Discord handles, GitHub usernames, and email addresses).

**Acceptance Criteria:**
1. Captain can click "Finalize Roster" when the team has at least 2 members and does not exceed maximum event capacity.
2. System displays a confirmation dialog warning that locking the roster disables further invitations and member removals.
3. Upon confirmation, team status updates to `Confirmed / Locked`.
4. System generates a downloadable summary (CSV/JSON and formatted on-screen card) containing all team members' names, emails, GitHub profiles, and declared roles.
5. All confirmed team members receive a notification confirming their locked status.

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-008, US-012, US-014

---

### Feature Area 6: Moderation, Platform Governance & Trust

Security and moderation mechanisms to protect participants from harassment, eliminate spam, enforce community guidelines, and handle platform abuse.

#### US-016: Report Abusive User or Fraudulent Listing

**User/Role:** `DEV`

**Story Statement:** As a participant, I want to report a user profile or team listing that violates community standards, so that administrators can investigate and maintain platform safety.

**Description:** Enables community-driven reporting against spam, phishing links, abusive language, or harassment in team posts and profile bios.

**Acceptance Criteria:**
1. Every profile card and team recruitment listing includes a "Report" action button.
2. Report modal requires selecting a violation category: *"Spam / Advertising"*, *"Harassment / Abusive Content"*, *"Inappropriate Content"*, or *"Fraudulent Event"*, plus an optional explanation.
3. System rate-limits reports to a maximum of 5 per user per hour to prevent denial-of-service abuse.
4. Submitting a report queues the item in the Administrative Moderation Dashboard with a timestamp and reporter ID.
5. User receives a confirmation notice: *"Thank you. Our moderation team will review this report."*

**Priority:** Medium

**Complexity/Effort Estimate:** Small

**Related Stories:** US-003, US-008, US-017

---

#### US-017: Administrative Content Moderation & Account Suspension

**User/Role:** `ADMIN`

**Story Statement:** As a platform administrator, I want to investigate flagged content and take disciplinary actions, so that the community remains safe and trustworthy.

**Description:** Administrative controls to review reported items, redact inappropriate content, issue warnings, or suspend user accounts.

**Acceptance Criteria:**
1. Admin portal provides a Moderation Dashboard listing all active user reports sorted by severity and report count.
2. Admin can view the reported content alongside its revision history and reporter notes.
3. Admin can take direct remediation actions: (a) Dismiss report, (b) Remove/edit offending content, (c) Issue warning to user, or (d) Suspend user account.
4. Suspending an account immediately terminates active sessions, revokes login rights, and hides their profiles and team listings from public search.
5. All moderation actions are recorded in an immutable audit log detailing Admin ID, Target ID, Action Taken, and Timestamp.

**Priority:** Medium

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-006, US-016
