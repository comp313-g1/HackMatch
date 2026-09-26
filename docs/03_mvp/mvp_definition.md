# MVP Definition

## Overview

This document categorizes the current [canonical backlog](../02_user_stories/user_stories.md) using the professor's five categories. The expanded product contains **29 stories: 20 Must-Haves, 7 Should-Haves, and 2 May-Haves**. **Only the 20 Must-Haves constitute the MVP.** Current story numbering is preserved.

The team confirmed this split and approval-before-publication for hackathon submissions. Richer post-MVP capabilities remain in the product roadmap; they do not drive the semester implementation schedule. [Roles](../01_roles_and_personas/roles_and_personas.md) and [requirements](../04_requirements/functional_nonfunctional_requirements.md) define the detailed behaviour. Proposed parameter decisions remain in the [policy register](../04_requirements/functional_nonfunctional_requirements.md#policy-register); investment/readiness claims must not imply those targets have already been demonstrated.

---

## User Story Categorization

### Must-Haves

These stories are essential to the agreed expanded MVP. The template's typical 5–15 stories is guidance, not a mandatory ceiling; the team has explicitly retained this 20-story baseline. All must pass their acceptance criteria for MVP completion.

| User Story | Justification |
|---|---|
| [US-001: Participant Registration and Email Verification](../02_user_stories/user_stories.md#us-001) | Establish verified PART accounts without public ADMIN provisioning. |
| [US-002: Federated OAuth Registration and Authentication](../02_user_stories/user_stories.md#us-002) | Preserve the expanded Google/GitHub primary login paths; both still require email OTP. |
| [US-003: User Login and Session Management](../02_user_stories/user_stories.md#us-003) | Authenticate authorized accounts and maintain/revoke protected sessions. |
| [US-004: Email-Based Login Two-Factor Authentication (2FA)](../02_user_stories/user_stories.md#us-004) | Required email OTP for every primary login, with the confirmed expiry/lock policy. |
| [US-005: Password Recovery for PART/ADMIN](../02_user_stories/user_stories.md#us-005) | Recover credential access without bypassing 2FA. |
| [US-006: Participant Profile Management](../02_user_stories/user_stories.md#us-006) | Provide skills, goals and permitted profile information for recruitment. |
| [US-008: Public Hackathon Discovery and Multi-Filter Search](../02_user_stories/user_stories.md#us-008) | Discover public verified event records and their team boards. |
| [US-009: Participant Hackathon Event Submission](../02_user_stories/user_stories.md#us-009) | Let any verified PART propose a missing event for ADMIN review. |
| [US-010: Administrative Event Verification, Correction, and Lifecycle Management](../02_user_stories/user_stories.md#us-010) | Create and verify trusted canonical event records, resolve duplicates, and manage their lifecycle. |
| [US-011: Declare Event Availability and Looking-for-Team Status](../02_user_stories/user_stories.md#us-011) | Identify available candidates for one specific event. |
| [US-012: Create and Manage a Team Recruitment Listing](../02_user_stories/user_stories.md#us-012) | Create an owned team and manage its slots/pre-lock lifecycle. |
| [US-013: Browse and Filter Open Team Vacancies](../02_user_stories/user_stories.md#us-013) | Let Participants browse/filter teams without algorithmic team recommendations. |
| [US-015: Candidate Recommendations for Team Leads](../02_user_stories/user_stories.md#us-015) | Recommend eligible candidates to owners using explainable rules. |
| [US-017: Issue a Team Invitation](../02_user_stories/user_stories.md#us-017) | Invite a candidate to a specific open slot with basic status alerts. |
| [US-018: Apply to Join a Team Vacancy](../02_user_stories/user_stories.md#us-018) | Apply to an open slot with basic status alerts. |
| [US-019: Respond to a Team Invitation](../02_user_stories/user_stories.md#us-019) | Accept/decline invitations and manage pre-lock placement without duplicate memberships. |
| [US-020: Team Lead Approves or Declines an Application](../02_user_stories/user_stories.md#us-020) | Approve/decline applications using the same atomic membership rules. |
| [US-022: Confirm and Lock a Team Roster](../02_user_stories/user_stories.md#us-022) | Confirm and lock an event-compliant roster. |
| [US-026: Administrative Content Moderation and Safety Queue](../02_user_stories/user_stories.md#us-026) | Allow ADMIN inspection and basic moderation without requiring participant reporting. |
| [US-027: Administrative Account Management and Enforcement](../02_user_stories/user_stories.md#us-027) | Control accounts and process authorized deletion requests under the documented privacy policy. |

---

### Should-Haves

These seven capabilities are planned for the first or second post-MVP update (roadmap v1.1/v1.2), after core acceptance and capacity review. They are not required for the November 29 MVP or December 18 course delivery. There is no calendar commitment for those later updates; they are planned enhancements, distinct from speculative May-Haves.

| User Story | Value & Timeline |
|---|---|
| [US-007: Participant Hackathon History and Portfolio Records](../02_user_stories/user_stories.md#us-007) | Self-declared history and experience badges. Planned early post-MVP update; no semester implementation dependency. |
| [US-014: Advanced Candidate Directory Search and Filter for Team Leads](../02_user_stories/user_stories.md#us-014) | Advanced manual candidate discovery beyond MVP recommendations. Planned early post-MVP update; no semester implementation dependency. |
| [US-021: In-App Notification Center and Real-Time Recruitment Alerts](../02_user_stories/user_stories.md#us-021) | Unread feed and read management beyond basic status alerts. Planned early post-MVP update; no semester implementation dependency. |
| [US-023: Team Private Coordination Workspace](../02_user_stories/user_stories.md#us-023) | Locked-team external links and versioned notes. Planned early post-MVP update; no semester implementation dependency. |
| [US-024: Export Team Manifest and Check-In Verification Card](../02_user_stories/user_stories.md#us-024) | Printable/JSON roster export with an integrity checksum; organizer acceptance is not assumed. Planned early post-MVP update; no semester implementation dependency. |
| [US-025: User Reporting Modal for Abusive Content and Malicious Links](../02_user_stories/user_stories.md#us-025) | Participant reporting feeding the existing ADMIN case workflow. Planned early post-MVP update; no semester implementation dependency. |
| [US-028: Administrative Audit Review and Filtering](../02_user_stories/user_stories.md#us-028) | Search/filter interface over administrative records already collected in MVP. Planned early post-MVP update; no semester implementation dependency. |

---

### Nice-To-Haves

No canonical story is assigned here. Desirable additions will be categorized here only after their user value and feasibility are understood.

| User Story |
|---|
| None currently classified. |

---

### May-Haves

These stories are considered but not committed to a release. Their presence does not weaken the mandatory MVP email-OTP or participant-browsing policies.

The previously mentioned Discord channel automation, GitHub repository scaffolding and schedule-overlap visualization are retained as speculative idea notes outside the numbered backlog. They require team/backlog and feasibility review before becoming stories; they have no IDs or implementation dates and do not change the 29-story count.

| User Story | Tentative Status |
|---|---|
| [US-016: Recommended Teams for Participants (Future Scope)](../02_user_stories/user_stories.md#us-016) | Participant-facing recommendations require user-value and algorithm review; no release date. |
| [US-029: Authenticator-App Two-Factor Authentication (Future Scope)](../02_user_stories/user_stories.md#us-029) | Authenticator enrollment/recovery and any change to email OTP require future security approval; no release date. |


---

### Out of Scope

| Title or User Story | Reason Out of Scope |
|---|---|
| Ticketing, payments, judging, attendee registration, and full event scheduling | Event records support trusted team formation; HackMatch does not operate the hackathon. |
| Organizer self-service accounts | Organizers remain external stakeholders and possible future system users. PART submits records; ADMIN verifies them. |
| In-app real-time chat, audio/video, public discussion feeds | Outside the agreed recruitment/coordination scope; external tool links can serve communication. |
| Native iOS/Android applications | The product is a responsive website, including tablet/iPad and phone portrait/landscape support. |
| Advanced AI/vector/embedding matching | MVP candidate recommendations use explicit rules. Future participant recommendations do not automatically authorize advanced AI. |
| Calendar integrations, project idea boards, public reputation/rating systems | Not committed; self-declared post-MVP participation history is separately defined in US-007. |
| Extensive enterprise administration or event operations | MVP retains verified listings, account controls and basic moderation; later audit/reporting interfaces follow their own story categories. |

---

## MVP Definition

**MVP User Stories:** US-001, US-002, US-003, US-004, US-005, US-006, US-008, US-009, US-010, US-011, US-012, US-013, US-015, US-017, US-018, US-019, US-020, US-022, US-026, US-027.

**MVP Scope:** A visitor discovers a verified hackathon; a PART registers or uses Google/GitHub, completes mandatory email OTP, maintains a profile and event availability, and browses/applies to teams or responds to invitations. A PART owns and recruits for a team through rule-based candidate recommendations, resolves both joining routes without duplicate event memberships, and locks a valid roster. ADMIN creates/verifies canonical event records and manages accounts/basic moderation; only approved events enable recruitment.

**MVP Success Condition:** All 20 Must-Have stories pass end-to-end acceptance, including event approval, both joining routes, duplicate-event safeguards, owner authorization, responsive tablet/phone tasks, and a locked roster. Confirmed membership starts at team creation/acceptance/approval, not at lock. Basic invitation/application/event/roster status alerts and basic administrative action records are included within those stories; the full notification centre, history, advanced search, workspace, export, participant reports and audit-query interface are not prerequisites.

**MVP Target Release Date:** November 29, 2026 — planned implementation target at Sprint / Iteration 2 completion.

**Final Course Delivery and Presentation:** December 18, 2026. The intervening period covers validation, fixes, report completion and presentation preparation, not uncommitted feature expansion.

### MVP Implementation Plan

Depends On lists prerequisite capabilities needed to implement the story against real account/event/team data. Relates To lists integrations or shared workflows that can be developed in parallel. Authentication stories are tested as one secure flow before release: primary-login work can precede the OTP screen, but no full session is enabled until both are complete. Membership integrity (FR-083), basic alerts (FR-064) and action records (FR-079) are shared implementation work under these stories, not additional user stories or post-MVP blockers. Test fixtures may support parallel work before integration.

| Priority | User Story | Depends On | Relates To |
|---|---|---|---|
| 1 | [US-001: Participant Registration and Email Verification](../02_user_stories/user_stories.md#us-001) | None | US-002, US-003, US-004, US-005 |
| 2 | [US-003: User Login and Session Management](../02_user_stories/user_stories.md#us-003) | US-001 | US-002, US-004, US-005, US-027 |
| 3 | [US-004: Email-Based Login Two-Factor Authentication (2FA)](../02_user_stories/user_stories.md#us-004) | US-003 | US-001, US-002, US-005 |
| 4 | [US-002: Federated OAuth Registration and Authentication](../02_user_stories/user_stories.md#us-002) | US-001 | US-003, US-004, US-006 |
| 5 | [US-005: Password Recovery for PART/ADMIN](../02_user_stories/user_stories.md#us-005) | US-001 | US-003, US-004 |
| 6 | [US-008: Public Hackathon Discovery and Multi-Filter Search](../02_user_stories/user_stories.md#us-008) | None | US-009, US-010, US-013 |
| 7 | [US-009: Participant Hackathon Event Submission](../02_user_stories/user_stories.md#us-009) | US-003 | US-008, US-010, US-012 |
| 8 | [US-010: Administrative Event Verification, Correction, and Lifecycle Management](../02_user_stories/user_stories.md#us-010) | US-003 | US-008, US-009, US-012, US-026, US-027, US-028 |
| 9 | [US-006: Participant Profile Management](../02_user_stories/user_stories.md#us-006) | US-003 | US-002, US-007, US-011, US-015 |
| 10 | [US-011: Declare Event Availability and Looking-for-Team Status](../02_user_stories/user_stories.md#us-011) | US-006, US-010 | US-012, US-015, US-019, US-020 |
| 11 | [US-012: Create and Manage a Team Recruitment Listing](../02_user_stories/user_stories.md#us-012) | US-003, US-010 | US-006, US-011, US-013, US-019, US-020, US-022 |
| 12 | [US-013: Browse and Filter Open Team Vacancies](../02_user_stories/user_stories.md#us-013) | US-012 | US-008, US-018 |
| 13 | [US-015: Candidate Recommendations for Team Leads](../02_user_stories/user_stories.md#us-015) | US-006, US-011, US-012 | US-014, US-017 |
| 14 | [US-017: Issue a Team Invitation](../02_user_stories/user_stories.md#us-017) | US-011, US-012 | US-015, US-019, US-020, US-021 |
| 15 | [US-018: Apply to Join a Team Vacancy](../02_user_stories/user_stories.md#us-018) | US-012, US-013 | US-017, US-020, US-021 |
| 16 | [US-019: Respond to a Team Invitation](../02_user_stories/user_stories.md#us-019) | US-017 | US-018, US-020, US-021, US-022 |
| 17 | [US-020: Team Lead Approves or Declines an Application](../02_user_stories/user_stories.md#us-020) | US-018 | US-017, US-019, US-021, US-022 |
| 18 | [US-022: Confirm and Lock a Team Roster](../02_user_stories/user_stories.md#us-022) | US-012 | US-019, US-020, US-023, US-024 |
| 19 | [US-026: Administrative Content Moderation and Safety Queue](../02_user_stories/user_stories.md#us-026) | US-003 | US-010, US-012, US-025, US-027, US-028 |
| 20 | [US-027: Administrative Account Management and Enforcement](../02_user_stories/user_stories.md#us-027) | US-003 | US-004, US-010, US-012, US-026, US-028 |


Roster locking consumes the common membership model and can be implemented/tested with valid roster fixtures before both joining screens are finished. MVP completion still requires both joining stories. Event discovery uses verified-record fixtures while verification is built. Moderation starts from ADMIN-created cases; participant reports and audit querying are later additions, not prerequisites.

### Official Course Milestones — MVP Work Only

| Milestone | Date | Planned evidence |
|---|---|---|
| Sprint / Iteration 1 | October 25, 2026 | Secure registration/primary login/email OTP, recovery, profiles, event directory/submission/verification foundation; demonstrate authorization and approval gating. |
| Progress Report | November 8, 2026 | Report MVP progress, integration results, unresolved policy/benchmark decisions, and remaining scope. |
| Sprint / Iteration 2 — MVP implementation target | November 29, 2026 | All 20 Must-Haves integrated: availability, team discovery/recommendations, both joining paths, lock, account/moderation controls, basic alerts/records, responsive and integrity acceptance. |
| Final Project Report | December 13, 2026 | Consolidated MVP test evidence, limitations, specifications and research-backed proposal/report artifacts. |
| Final Project & Presentation | December 18, 2026 | Tested MVP demonstration and final course delivery. |

The Word proposal and required repository Markdown are both deliverables. Detailed stories stay in user_stories.md unless the Word template explicitly requests them. The later Word timeline should summarize these Must-Have phases/milestones only; the product roadmap must remain separately labelled.
