# HackMatch Sprint 1 Independent Task Backlog

**Sprint deadline:** October 25, 2026  
**Team size:** 6 developers  
**Product:** HackMatch responsive web application  
**Backlog scope:** The 20 canonical Must-Have MVP user stories  
**Source documents:** [User Stories](../02_user_stories/user_stories.md), [MVP Definition](../03_mvp/mvp_definition.md), and [Functional/Non-Functional Requirements](../04_requirements/functional_nonfunctional_requirements.md)

## How to use this backlog

This document breaks each MVP user story into small, volunteer-friendly tasks. Each task has one column for each team member. Volunteer for a task by marking your name column with `X`. Enter the actual time after completing the task. Estimated hours are planning estimates, not promises.

### Independence rule

Every task in this table is intentionally marked **No blocking dependency**. Developers may use mocks, fixtures, local stubs, temporary adapters, or test doubles when another part of the system is not ready. A task must not wait for another task to be completed before its own code, tests, and evidence can be produced.

If two tasks would edit the same file, the owners must coordinate before editing, split the file by responsibility, or create a short-lived integration branch. Coordination is allowed; blocking dependencies are not.

### Required workflow for every task

1. Claim the task by adding your name, branch, and expected completion date.
2. Create a Gitflow feature branch from the current integration branch, for example `feature/US-001-registration-form`.
3. Implement only the authorized scope of the task.
4. Add or update positive and negative tests where applicable.
5. Record evidence: test output, screenshot, log, API response, diagram, or review link.
6. Open a pull request with the user story and task IDs in the title.
7. A reviewer verifies the acceptance criteria before the task is marked Done.

## Volunteer instructions

- Mark `X` under your name to volunteer for a task. Only one person should normally mark a task.
- Enter actual hours after completing the task.
- If two people need the same task, discuss ownership before changing the table.
- Every task remains independently assignable; use mocks, fixtures, local stubs, or test doubles instead of waiting for another task.

## Sprint 1 rubric evidence plan

| Rubric area | Backlog evidence |
|---|---|
| Sprint goal and backlog | This document, task owners, estimates, priorities, status, dates, and pull requests |
| User stories and diagrams | Canonical stories plus use-case, architecture, class, ER/database, and flow diagrams linked from task evidence |
| Git repository and history | One focused branch/PR per task where practical, meaningful commits, and identifiable authorship |
| Initial working prototype | Working registration/login, profile, event, recruitment, team, and administration slices demonstrated through the prototype |
| Debugging and testing | Positive/negative test cases, validation tests, error handling, retests, screenshots, logs, and automated test output |
| Sprint demonstration | Demo script linked to completed task IDs, user stories, acceptance criteria, known limitations, and contributor ownership |

## Definition of Done for an implementation task

A task is **Done** only when:

- the implementation or artifact matches the linked user story and requirement IDs;
- valid, invalid, empty, unauthorized, and boundary cases relevant to the task are covered;
- the change does not grant access to the wrong role or expose private data;
- automated tests pass, or manual test evidence is attached when automation is not practical;
- the task has a focused commit and pull request;
- a second team member has reviewed the result;
- the evidence link or file path is recorded in this backlog.

## Disaggregated user-story task tables

Each user story below uses a separate table, matching the planning format requested by the team. **Who** is the person responsible for the task, **Estimate** is the planned number of hours, and **Actual** is the number of hours recorded after completion. Tasks have no blocking dependencies.

### US-001: Participant Registration and Email Verification

**User story:** As an unauthenticated visitor, I want to create an account with my email and password and verify my email address, so that I can establish a verified Participant profile.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build participant registration page with full name, email, password, and confirmation fields |  | 4 |  |
| Implement client-side password policy validation |  | 3 |  |
| Implement server/API registration validation |  | 5 |  |
| Implement Firebase email/password account creation adapter |  | 5 |  |
| Implement email verification request and callback handling |  | 5 |  |

### US-002: Federated OAuth Registration and Authentication

**User story:** As a visitor or Participant, I want to register and sign in using my Google or GitHub account, so that I can access the platform quickly without creating separate credentials.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build Google OAuth sign-in control and callback handling |  | 4 |  |
| Build GitHub OAuth sign-in control and callback handling |  | 4 |  |
| Implement provider profile mapping |  | 3 |  |
| Implement provider email and account-role checks |  | 4 |  |
| Add account-linking guard tests |  | 4 |  |

### US-003: User Login and Session Management

**User story:** As a Participant or Administrator, I want to sign in, maintain an authorized session, and sign out, so that I can safely use my authorized functions.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build login page and generic failure states |  | 4 |  |
| Implement primary credential authentication adapter |  | 5 |  |
| Implement pre-authentication session state |  | 4 |  |
| Implement protected-request token verification middleware |  | 5 |  |
| Implement logout, throttling, expiry, and revocation tests |  | 5 |  |

### US-004: Email-Based Login Two-Factor Authentication (2FA)

**User story:** As a Participant or Platform Administrator, I want to verify my identity via a one-time code sent to my email during login, so that a compromised password alone does not grant account access.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build email OTP challenge screen |  | 4 |  |
| Implement secure OTP generation and delivery adapter |  | 5 |  |
| Implement OTP verification and atomic consumption |  | 5 |  |
| Implement OTP expiry, resend invalidation, and account lock |  | 6 |  |
| Test OTP success, failure, lockout, expiry, and OAuth coverage |  | 5 |  |

### US-005: Password Recovery for PART/ADMIN

**User story:** As a user, I want to request a secure password reset link via my registered email, so that I can regain access if I forget my password.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build password recovery request page |  | 3 |  |
| Implement recovery email and protected token adapter |  | 5 |  |
| Build password reset form and policy validation |  | 4 |  |
| Implement reset session invalidation |  | 4 |  |
| Test reset expiry, replay, enumeration, and recovery errors |  | 4 |  |

### US-006: Participant Profile Management

**User story:** As a Participant, I want to maintain my technical profile with my role, skill tags, academic institution, and portfolio links, so that prospective teammates can assess my capabilities.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build participant profile view and edit form |  | 4 |  |
| Implement profile field validation |  | 4 |  |
| Implement HTTPS portfolio URL validation and self-declared labels |  | 3 |  |
| Implement profile authorization and visibility rules |  | 5 |  |
| Test profile edits, invalid input, ownership, and direct endpoint access |  | 4 |  |

### US-008: Public Hackathon Discovery and Multi-Filter Search

**User story:** As a visitor or Participant, I want to browse and filter upcoming hackathons, so that I can identify events I want to attend and inspect available teams.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build public hackathon directory page |  | 5 |  |
| Implement keyword, format, and lifecycle filters |  | 4 |  |
| Implement event details and team-board entry states |  | 4 |  |
| Implement safe external-link behavior |  | 3 |  |
| Test public visibility, empty results, filters, and archived events |  | 4 |  |

### US-009: Participant Hackathon Event Submission

**User story:** As a Participant, I want to submit an unlisted hackathon for verification, so that users can form teams around one trusted event record.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build participant event-submission form |  | 4 |  |
| Implement submission date, URL, and team-limit validation |  | 4 |  |
| Implement normalized duplicate detection |  | 5 |  |
| Implement private pending-submission status view |  | 4 |  |
| Test submission authorization, duplicates, invalid links, and privacy |  | 4 |  |

### US-010: Administrative Event Verification, Correction, and Lifecycle Management

**User story:** As a Platform Administrator, I want to review, correct, and verify crowdsourced hackathon submissions and manage published listings, so that the platform maintains an accurate single source of truth.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build ADMIN event verification queue |  | 4 |  |
| Build ADMIN event create/edit form |  | 4 |  |
| Implement event approval, publication, and rejection feedback |  | 5 |  |
| Implement duplicate merge and conflict-safe lifecycle handling |  | 6 |  |
| Implement disable/archive/concluded-event controls and tests |  | 6 |  |

### US-011: Declare Event Availability and Looking-for-Team Status

**User story:** As a Participant, I want to declare my availability for a specific hackathon and state my desired role and commitment level, so that Team Leads can discover me as an available candidate.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build event availability form |  | 4 |  |
| Implement availability validation and one-per-event rule |  | 4 |  |
| Implement availability visibility and status display |  | 4 |  |
| Implement availability and membership state transitions |  | 5 |  |
| Test availability lifecycle and confirmed-membership restriction |  | 4 |  |

### US-012: Create and Manage a Team Recruitment Listing

**User story:** As a Team Lead, I want to create a structured recruitment listing with discrete skill vacancy slots and edit it as our needs evolve, so that I can attract targeted teammates.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build create-team and recruitment-listing form |  | 5 |  |
| Implement official capacity and vacancy validation |  | 5 |  |
| Implement Team Lead ownership authorization |  | 4 |  |
| Implement pre-lock edit, removal, leave, and disband behavior |  | 5 |  |
| Test team creation, capacity, ownership, closure, and privacy |  | 5 |  |

### US-013: Browse and Filter Open Team Vacancies

**User story:** As a Participant, I want to browse and filter open team vacancy slots for a hackathon, so that I can identify teams matching my technical stack and project goals.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build open-team vacancy browsing page |  | 4 |  |
| Implement vacancy filters and clear/empty states |  | 4 |  |
| Implement anonymized visitor preview |  | 3 |  |
| Implement vacancy authorization and event-closure behavior |  | 4 |  |
| Test vacancy visibility, authorization, and direct endpoint access |  | 4 |  |

### US-015: Candidate Recommendations for Team Leads

**User story:** As a Team Lead, I want to view a ranked list of compatible candidates for my team's open vacancy slots, so that I can invite teammates with complementary skills and matching commitments.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Implement explainable candidate scoring model |  | 6 |  |
| Build Team Lead candidate recommendation view |  | 5 |  |
| Implement recommendation eligibility filtering |  | 5 |  |
| Implement recommendation fallback behavior |  | 4 |  |
| Test scoring explanations, missing data, equal scores, and authorization |  | 5 |  |

### US-017: Issue a Team Invitation

**User story:** As a Team Lead, I want to issue a direct invitation to an available candidate, so that they can review my team and decide whether to join.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build Team Lead invitation form and action |  | 4 |  |
| Implement invitation capacity and eligibility validation |  | 5 |  |
| Implement invitation status alert |  | 3 |  |
| Implement invitation cancellation and expiry states |  | 4 |  |
| Test unauthorized invitations and stale-capacity behavior |  | 4 |  |

### US-018: Apply to Join a Team Vacancy

**User story:** As a Participant, I want to submit an application to an open team vacancy slot, so that the Team Lead can review my profile and consider me for membership.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build apply-to-team form and action |  | 4 |  |
| Implement application validation and quota rules |  | 5 |  |
| Implement application status alert for Team Lead |  | 3 |  |
| Implement duplicate application and availability safeguards |  | 4 |  |
| Test applications, full teams, invalid notes, and authorization |  | 4 |  |

### US-019: Respond to a Team Invitation

**User story:** As an invited Participant, I want to accept or decline a team invitation, so that I can confirm my team placement or keep looking.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build invitation response page |  | 4 |  |
| Implement atomic invitation acceptance |  | 6 |  |
| Implement invitation decline, expiry, and cancellation states |  | 4 |  |
| Implement competing-request cancellation and availability update |  | 5 |  |
| Test concurrent acceptance and one-team-per-event invariant |  | 6 |  |

### US-020: Team Lead Approves or Declines an Application

**User story:** As a Team Lead, I want to review incoming applications and approve or decline candidates, so that I can select the best teammates for our vacancies.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build Team Lead application-review page |  | 4 |  |
| Implement atomic application approval |  | 6 |  |
| Implement application decline and status alert |  | 3 |  |
| Implement stale-application and competing-request handling |  | 5 |  |
| Test concurrent approval and ownership authorization |  | 6 |  |

### US-022: Confirm and Lock a Team Roster

**User story:** As a Team Lead, I want to confirm and lock my team's roster, so that our membership is finalized and membership mutations are frozen.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build roster view and lock confirmation UI |  | 4 |  |
| Implement roster eligibility validation |  | 5 |  |
| Implement atomic roster lock transition |  | 5 |  |
| Implement locked-team read-only behavior |  | 4 |  |
| Test roster limits, lock race, event closure, and audit evidence |  | 5 |  |

### US-026: Administrative Content Moderation and Safety Queue

**User story:** As a Platform Administrator, I want to review flagged team content and malicious links in a moderation queue, so that the platform remains safe, compliant, and free of phishing threats.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build ADMIN moderation case list and detail view |  | 4 |  |
| Implement moderation decision actions |  | 5 |  |
| Implement event/team/content safety disable action |  | 5 |  |
| Implement affected-user status alert for moderation actions |  | 3 |  |
| Test ADMIN-only moderation and historical preservation |  | 4 |  |

### US-027: Administrative Account Management and Enforcement

**User story:** As a Platform Administrator, I want to suspend or deactivate non-compliant accounts, so that bad actors cannot harass students or disrupt team formation.
| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Build ADMIN account-management list and detail view |  | 4 |  |
| Implement suspend and restore account controls |  | 5 |  |
| Implement authorized deletion-request workflow |  | 5 |  |
| Implement deletion and privacy boundary checks |  | 5 |  |
| Test ADMIN authorization, suspension, deletion requests, and action records |  | 5 |  |

## Cross-cutting independent tasks

These tasks support the assessment rubric and can be assigned in the same format. They do not block any user-story task.

| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Diagram matches the implemented browser, frontend, backend, authentication, and persistence boundaries |  |  |  |
| Visitor, PART, Team Lead, and ADMIN interactions match canonical stories |  |  |  |
| Account, profile, event, team, membership, request, and moderation concepts are consistent |  |  |  |
| Keys, roles, status values, and integrity rules are documented |  |  |  |
| Each MVP story has positive, negative, validation, authorization, and boundary scenarios |  |  |  |
| Each discovered defect has reproduction, cause, fix, and retest evidence |  |  |  |
| Core journeys are checked on desktop, tablet/iPad, and phone portrait/landscape layouts |  |  |  |
| Keyboard access, labels, focus, contrast, and error messaging are checked against the documented target |  |  |  |
| Valid users, roles, events, teams, requests, and moderation cases support isolated development and demos |  |  |  |
| Script covers verified event discovery through team creation, both joining routes, and locked roster |  |  |  |
| Branch naming, PR review, commit style, and merge workflow are documented |  |  |  |
| Screenshots/logs/test output map each completed story to the rubric |  |  |  |

## Gitflow and commit expectations

Use the professor-recommended [Gitflow workflow](https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow) unless the team agrees to a documented variation:

- `main` contains reviewed, demonstrable releases.
- `develop` contains the shared integration state.
- Each task starts from `develop` in a focused `feature/<task-id>-<short-name>` branch.
- Use `release/sprint-1` for final Sprint 1 stabilization and demo preparation.
- Use `hotfix/<short-name>` only for urgent defects in `main`.
- Pull requests should identify the task ID, story ID, acceptance criteria, tests, and evidence.
- Keep commits small and meaningful, such as `feat(US-001): add registration validation` or `test(US-004): cover OTP lockout`.
- Do not use one final bulk upload to hide individual contributions.

## Sprint completion gate

Before the October 25 demonstration, the team should review:

- all claimed tasks and their actual status;
- completed acceptance criteria for every demonstrated story;
- positive, negative, validation, authorization, and boundary test evidence;
- architecture and database diagrams against the implementation;
- the working prototype on the agreed browsers and device layouts;
- defect fixes and retest results;
- meaningful Git history and identifiable contributions;
- incomplete tasks and known limitations for the presentation.

The backlog is a planning and evidence artifact. The canonical user stories and requirements remain the source of truth for product behavior.
