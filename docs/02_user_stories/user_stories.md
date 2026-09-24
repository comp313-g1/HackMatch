# User Stories

## Overview

This document defines HackMatch user stories using the roles in [Roles and Personas](../01_roles_and_personas/roles_and_personas.md). The MVP account roles are Participant (PART) and Platform Administrator (ADMIN). Public registration creates PART accounts only; ADMIN account provisioning is outside the public registration flow. An unauthenticated Visitor can browse public hackathon information but has no stored account role. A Team Lead is a PART with permissions for a team they own, not a separate account role.

The canonical story IDs include eighteen stories in MVP scope and two future-scope stories (US-011 and US-016). The MVP stories cover the agreed features in Word Sections 5, 8, and 9. Future stories do not add requirements to the MVP.

### Structure of a User Story

Every story below follows the professor-provided [user-story template](user_stories_template.md): a unique identifier and title, User/Role, Story Statement, Description, numbered Acceptance Criteria, Priority, Complexity/Effort Estimate, and Related Stories. Priority uses High, Medium, or Low; effort uses Small, Medium, or Large.

---

## User Stories by Feature Area

| Feature area | MVP stories | Future stories |
| --- | --- | --- |
| Authentication and Participant Profiles | US-001, US-002, US-003, US-018, US-020 | — |
| Hackathon Directory and Event Management | US-004, US-019 | — |
| Team Recruitment and Looking-for-Team Boards | US-007, US-008, US-009 | — |
| Rule-Based Matching | US-010 | US-011 |
| Invitations, Applications, and Rosters | US-012, US-013, US-014, US-015, US-021 | — |
| Platform Administration and Trust | US-017, US-022 | US-016 |

---

### Feature Area 1: Authentication and Participant Profiles

These stories establish verified Participant accounts, secure access for Participants and Administrators, and the profile information used in team formation. Email verification at registration and email-based login 2FA are distinct steps.

#### US-001: Participant Registration and Email Verification

**User/Role:** Unauthenticated Visitor

**Story Statement:** As an unauthenticated visitor, I want to create and verify a Participant account, so that I can use HackMatch's team-formation features.

**Description:** Public registration creates a PART account only. Administrator accounts are provisioned outside this public flow. Email verification must be completed before the new Participant can use authenticated team actions.

**Acceptance Criteria:**
1. A visitor can submit their name, email address, and password to register a PART account.
2. The system validates the email address, rejects duplicate accounts, and enforces its configured password policy.
3. The system sends a verification link to the submitted email address; a valid link verifies the account.
4. An unverified account cannot use authenticated team-formation actions, and public registration never grants ADMIN privileges.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-002, US-003, US-018, US-020

---

#### US-002: User Login and Session Management

**User/Role:** PART / ADMIN

**Story Statement:** As a Participant or Platform Administrator, I want to log in and end my session securely, so that I can access only my authorized functions.

**Description:** This story handles credential verification, login sessions, and logout for existing PART and ADMIN accounts. A valid password begins login but does not grant full access until the email-based 2FA step in US-018 succeeds. Password recovery is covered by US-020.

**Acceptance Criteria:**
1. The system validates submitted credentials and rejects invalid credentials without revealing sensitive account information.
2. After valid credentials, the user must complete US-018 before receiving a fully authenticated session.
3. A fully authenticated session grants only the functions authorized for that account's role and remains active until logout or session expiry.
4. Logout ends the authenticated session, and the ended session cannot be used to access authenticated functions.

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-001, US-018, US-020

---

#### US-020: Password Recovery for PART/ADMIN

**User/Role:** PART / ADMIN

**Story Statement:** As a Participant or Platform Administrator, I want to reset a forgotten password, so that I can regain access to my account.

**Description:** Recovery applies to existing PART and ADMIN accounts and is separate from normal login. Resetting a password does not bypass email-based login 2FA.

**Acceptance Criteria:**
1. Submitting the email address of an existing PART or ADMIN account sends a password-recovery link to that address.
2. A valid, single-use recovery link lets the account holder set a new password that meets the configured password policy.
3. An invalid or previously used recovery link cannot change the account password.
4. After a reset, the account holder must still complete US-018 during login.

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-001, US-002, US-018

---

#### US-018: Email-Based Login Two-Factor Authentication

**User/Role:** PART / ADMIN

**Story Statement:** As a Participant or Platform Administrator, I want to confirm login with a code sent to my email, so that my password alone does not grant account access.

**Description:** Email-based login 2FA is required for both MVP account roles. The code is sent after valid password verification and must be accepted before the account's authorized functions become available. SMS and authenticator-app methods are future options.

**Acceptance Criteria:**
1. After a valid password is submitted, the system sends a single-use, time-limited login code to the account's verified email address.
2. Full authenticated access is granted only after the correct current code is submitted.
3. Incorrect, expired, or previously used codes do not complete login.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-001, US-002, US-020

---

#### US-003: Participant Profile Management

**User/Role:** PART

**Story Statement:** As a Participant, I want to maintain a profile of my skills, experience, goals, and relevant links, so that potential teammates can assess my fit.

**Description:** Participant profiles provide the information used for team discovery and rule-based candidate recommendations. Event-specific availability is managed through US-007 rather than treated as a global account role or status.

**Acceptance Criteria:**
1. A Participant can create and edit profile information including skills, technology stack, experience, school, goals, and relevant portfolio links.
2. Saved profile changes remain available when the Participant returns.
3. Other authenticated Participants can view team-relevant profile information, while private account and authentication data remain hidden.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-001, US-007, US-010

---

### Feature Area 2: Hackathon Directory and Event Management

The MVP has public hackathon discovery and ADMIN-managed listings. Direct Organizer accounts, event submissions, and submission verification remain future scope.

#### US-004: Public Hackathon Discovery and Filtering

**User/Role:** Unauthenticated Visitor / PART

**Story Statement:** As a visitor or Participant, I want to browse and filter hackathon listings, so that I can find an event relevant to me.

**Description:** The public directory presents hackathon information without requiring an account. Interactive team-formation actions require a PART account.

**Acceptance Criteria:**
1. Visitors and Participants can view published hackathons and essential event details such as dates, format, location, and official event link.
2. Available search or filters help narrow the displayed listings.
3. A visitor can open an event detail page without logging in but cannot apply, send invitations, or manage a team without a PART account.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-007, US-009, US-019

---

#### US-019: Administrator Hackathon Listing Management

**User/Role:** ADMIN

**Story Statement:** As a Platform Administrator, I want to create, update, and archive hackathon listings, so that people can discover accurate event information.

**Description:** Administrators manage official event listings in the MVP. Organizers may provide information externally, but they do not submit listings through an MVP application account.

**Acceptance Criteria:**
1. An authenticated Administrator can create and edit a listing with the event information needed for public discovery and team formation.
2. Published listings appear in US-004; archived or unpublished listings do not appear in the default public directory.
3. Non-Administrators cannot use listing-management controls.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-002, US-004, US-018

---

### Feature Area 3: Team Recruitment and Looking-for-Team Boards

Participants can declare event-specific availability, create listings for teams they own, and browse open teams. Team ownership grants permissions for that team only.

#### US-007: Declare Event Availability and Looking-for-Team Status

**User/Role:** PART

**Story Statement:** As a Participant, I want to mark myself as looking for a team for a particular hackathon, so that Team Leads for that event know I am available.

**Description:** Looking-for-Team status is specific to an event and can include a preferred role, goals, and availability. A Participant may lead a team for one event while acting as an ordinary Participant elsewhere.

**Acceptance Criteria:**
1. A Participant can set, update, or remove Looking-for-Team status for a selected hackathon.
2. The event-specific status and relevant preferences are available to Team Leads considering candidates for that event.
3. Once the Participant is confirmed on a team for that hackathon, the system no longer presents them as an available candidate for that event.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-003, US-008, US-010, US-015

---

#### US-008: Create and Manage a Team Recruitment Listing

**User/Role:** PART acting as Team Lead for a team they own

**Story Statement:** As a Participant leading a team, I want to publish and manage its recruitment listing, so that suitable Participants can find its open places.

**Description:** A listing belongs to a specific hackathon and identifies the team's purpose, goals, open places, and desired skills. Its creator receives management permissions for that team, not a global account role.

**Acceptance Criteria:**
1. A Participant can create a team listing linked to one hackathon and describe its open places and desired skills.
2. The listing appears among open teams for that hackathon while it has available places.
3. Only the team owner can manage the listing, and the team cannot exceed the applicable event or team capacity.
4. The team owner can remove an accepted member or delete the team listing before the roster is locked, reopening open places or canceling pending requests.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-007, US-009, US-010, US-012, US-015

---

#### US-009: Browse and Filter Open Team Listings

**User/Role:** PART

**Story Statement:** As a Participant, I want to browse and filter open team listings, so that I can choose a team to apply to.

**Description:** Participants direct their own team search in the MVP. Algorithmic recommendations of teams to Participants are deferred to US-011.

**Acceptance Criteria:**
1. The event team board shows active teams with open places.
2. A Participant can filter teams by relevant skill needs and team goals.
3. A team detail view provides enough information to assess fit and access the application action in US-013.

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-004, US-008, US-011, US-013

---

### Feature Area 4: Rule-Based Matching

The MVP recommends available Participant candidates to the owner of an open team using explainable rules. The inverse recommendation of teams to Participants remains future scope.

#### US-010: Candidate Recommendations for Team Leads

**User/Role:** PART acting as Team Lead for a team they own

**Story Statement:** As a Team Lead, I want to view recommended candidates for my team's open places, so that I can invite Participants whose skills, goals, and availability fit the team.

**Description:** The MVP uses rule-based candidate recommendations for team owners. It does not require fixed scoring weights, a percentage score, or advanced AI, vector, or embedding matching.

**Acceptance Criteria:**
1. A Team Lead can view recommended available Participants for an open place on a team they own.
2. Recommendations consider relevant skills, goals, and event availability and show the main reasons for a match.
3. Participants already confirmed on another team for the same hackathon are excluded.
4. A Team Lead can proceed from a candidate to the invitation workflow in US-012.

**Priority:** High

**Complexity/Effort Estimate:** Large

**Related Stories:** US-003, US-007, US-008, US-012, US-015

---

#### US-011: Recommended Teams for Participants (Future Scope)

**User/Role:** PART

**Story Statement:** As a Participant, I want to receive recommendations of teams with open places, so that I can identify groups that may fit my profile.

**Description:** Participant-facing algorithmic team recommendations are deferred. During the MVP, Participants browse and filter teams themselves under US-009.

**Acceptance Criteria:**
1. In a future release, the system can suggest open teams using a Participant's relevant skills and event preferences.
2. Each suggestion explains the main reason for the proposed fit.
3. A Participant can open a suggested team's details and apply through US-013.

**Priority:** Medium

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-003, US-007, US-009, US-013

---

### Feature Area 5: Invitations, Applications, and Rosters

Both Team Lead invitations and Participant applications use a simple decision workflow. Basic alerts and request statuses are part of that workflow; a full notification centre is deferred.

#### US-012: Issue a Team Invitation

**User/Role:** PART acting as Team Lead for a team they own

**Story Statement:** As a Team Lead, I want to invite a Participant to my team, so that they can decide whether to join it.

**Description:** Invitations are tied to the Team Lead's team and hackathon. Sending an invitation creates a pending request and a basic alert for its recipient.

**Acceptance Criteria:**
1. A Team Lead can invite a candidate to a team they own while it has an open place.
2. The system creates a pending invitation and alerts the invitee.
3. A Team Lead cannot send invitations for another owner's team or a team with no open place.
4. A Team Lead can cancel a pending invitation they previously issued before the recipient responds.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-008, US-010, US-014, US-015

---

#### US-013: Apply to Join a Team

**User/Role:** PART

**Story Statement:** As a Participant, I want to apply to an open team, so that its Team Lead can consider me.

**Description:** Applications let Participants initiate a request to join a team they found by browsing. The Team Lead receives a basic alert and can review the applicant's profile.

**Acceptance Criteria:**
1. A Participant can apply from a team listing that has an open place.
2. The application enters a pending state and alerts the Team Lead for that team.
3. The Participant can view the application's status and withdraw it before a decision.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-008, US-009, US-021

---

#### US-014: Respond to a Team Invitation

**User/Role:** PART

**Story Statement:** As an invited Participant, I want to accept or decline a team invitation, so that I can decide whether to join that team.

**Description:** A Participant responds to an invitation addressed to them. The response updates the invitation status and provides a basic alert to the Team Lead. Team Lead decisions on applications are covered by US-021.

**Acceptance Criteria:**
1. An invited Participant can view and accept or decline their own pending invitation.
2. Accepting an invitation updates its status and the team roster and alerts the Team Lead; declining updates its status and alerts the Team Lead without adding the Participant to the roster.
3. Acceptance cannot exceed team capacity or confirm the Participant on more than one team for the same hackathon.
4. A Participant cannot respond to another person's invitation or respond again after a decision.
5. An accepted team member can view their team's details and teammate contact information, and can leave the team prior to roster lock, which reopens the slot and restores their looking-for-team status.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-007, US-012, US-015, US-021

---

#### US-021: Team Lead Approves or Declines an Application

**User/Role:** PART acting as Team Lead for a team they own

**Story Statement:** As a Team Lead, I want to approve or decline an application to my team, so that I can decide who joins its roster.

**Description:** The owner of a team decides on pending applications to that team. The decision updates the application status and provides a basic alert to the applicant.

**Acceptance Criteria:**
1. A Team Lead can view pending applications to a team they own and review each applicant's team-relevant profile.
2. Approving an application updates its status and the team roster and alerts the applicant; declining updates its status and alerts the applicant without adding them to the roster.
3. Approval cannot exceed team capacity or confirm the applicant on more than one team for the same hackathon.
4. A Team Lead cannot decide applications to another owner's team or decide an application again after a decision.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-008, US-013, US-014, US-015

---

#### US-015: Confirm and Lock a Team Roster

**User/Role:** PART acting as Team Lead for a team they own

**Story Statement:** As a Team Lead, I want to confirm and lock my team's roster, so that its members know the final team for the hackathon.

**Description:** Roster confirmation finalizes membership for one hackathon. Exporting a roster for event registration or check-in is outside the MVP.

**Acceptance Criteria:**
1. Only the owner of the team can confirm and lock its roster, subject to applicable capacity rules.
2. Before confirmation, the system prevents any Participant from being confirmed on more than one team for the same hackathon.
3. Once locked, the roster shows a confirmed status and ordinary invitation, application, and membership changes are closed.
4. Confirmed team members can view their locked roster.

**Priority:** High

**Complexity/Effort Estimate:** Small

**Related Stories:** US-007, US-008, US-012, US-013, US-014, US-021

---

### Feature Area 6: Platform Administration and Trust

The MVP has separate, limited ADMIN controls for team content moderation and account management. Participant reporting and a larger investigation dashboard remain future scope.

#### US-017: Basic Administrative Content Moderation

**User/Role:** ADMIN

**Story Statement:** As a Platform Administrator, I want to address inappropriate team recruitment content, so that the MVP remains usable and trustworthy.

**Description:** This MVP story covers basic moderation of team recruitment content. It does not require a report queue, extensive dashboard, warning workflow, revision history, or enterprise audit system. Account management is covered by US-022.

**Acceptance Criteria:**
1. An authenticated Administrator can view team recruitment listings and hide or remove an inappropriate listing.
2. A hidden or removed listing no longer appears in ordinary team browsing.
3. Participants and unauthenticated Visitors cannot use content-moderation controls.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-008, US-016, US-022

---

#### US-022: Basic Administrative Account Management

**User/Role:** ADMIN

**Story Statement:** As a Platform Administrator, I want to manage accounts when necessary, so that access to the MVP remains appropriate.

**Description:** This MVP story covers limited account management, including viewing the account information needed for an administrative decision and deactivating an account. It does not create a public ADMIN registration flow or a broad administration dashboard.

**Acceptance Criteria:**
1. An authenticated Administrator can view an account's identifier, role, and active or deactivated status.
2. An Administrator can deactivate an account, and the deactivated account can no longer access authenticated functions.
3. Participants and unauthenticated Visitors cannot access account-management controls.

**Priority:** High

**Complexity/Effort Estimate:** Medium

**Related Stories:** US-002, US-017, US-018, US-019

---

#### US-016: Report Abusive User or Listing (Future Scope)

**User/Role:** PART

**Story Statement:** As a Participant, I want to report an abusive profile or misleading listing, so that Administrators can review it.

**Description:** Participant-initiated reporting and its review workflow are deferred. The MVP's basic ADMIN moderation in US-017 does not depend on a reporting dashboard.

**Acceptance Criteria:**
1. In a future release, a Participant can submit a report about a profile or team listing with a reason.
2. The system records the report for authorized administrative review.
3. The reporting Participant receives confirmation that the report was submitted.

**Priority:** Medium

**Complexity/Effort Estimate:** Small

**Related Stories:** US-003, US-008, US-017

---
