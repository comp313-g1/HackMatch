# Sprint 1 Task Disaggregation

#### US-001

**As an unauthenticated visitor, I want to create an account with my email and password and verify my email address, so that I can establish a verified Participant profile.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create Firebase Auth registration form for full name, email, and password | TBD |  | |
| Connect Firebase Auth email/password registration and password-policy validation | TBD |  | |
| Create PostgreSQL participant profile record with PART role and Unverified state | TBD |  | |
| Send and process Firebase email verification links | TBD |  | |
| Block unverified team, availability, application, and invitation actions | TBD |  | |
| Protect ADMIN provisioning from public registration | TBD |  | |
| Add React verification, replacement-link, and invalid-link states | TBD |  | |
| Add Vitest unit tests and integration tests for registration and verification | TBD |  | |

Table 1: US-001 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-001-T1 | Visitor submits a valid name, email, and password | A PART account is created as Unverified and a verification email is sent |
| US-001-T2 | Visitor submits an invalid password or malformed email | Field-specific validation appears and no account is created |
| US-001-T3 | Visitor opens a valid verification link | The account becomes Verified and the user is directed to sign in |
| US-001-T4 | Visitor opens an expired, used, or changed verification link | Verification fails, no access is granted, and a replacement-link option is shown |
| US-001-T5 | Unverified user tries to create a team or accept an invitation | The action is blocked with a verification message |
| US-001-T6 | Visitor tries to register as an administrator | No ADMIN account is created |

Table 2: US-001 (user acceptance tests)

#### US-002

**As a visitor or Participant, I want to register and sign in using my Google or GitHub account, so that I can access the platform quickly without creating separate credentials.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Configure Firebase Google and GitHub OAuth providers | TBD |  | |
| Add React provider sign-in buttons and callback handling | TBD |  | |
| Create provider identity link records for PART accounts | TBD |  | |
| Require verified provider email before provisioning a PART profile | TBD |  | |
| Add reauthentication before linking a provider to an existing account | TBD |  | |
| Route every provider sign-in into the email OTP flow | TBD |  | |
| Add provider cancellation, failure, and unverified-email states | TBD |  | |
| Add Vitest and integration tests for OAuth registration and linking | TBD |  | |

Table 3: US-002 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-002-T1 | Visitor chooses Google or GitHub and approves access | A PART setup flow starts and the user is sent to email OTP |
| US-002-T2 | Visitor cancels or the provider returns an error | An actionable error appears and no session is created |
| US-002-T3 | User signs in with a provider account that has no verified email | The user is directed to email registration and no PART account is activated |
| US-002-T4 | Existing user links a provider after reauthentication and OTP | The provider is linked to the same PART account |
| US-002-T5 | User tries to link an account using only matching email text | The link is rejected until reauthentication and OTP succeed |
| US-002-T6 | User completes provider sign-in without email OTP | No full session or team action is available |

Table 4: US-002 (user acceptance tests)

#### US-003

**As a Participant or Administrator, I want to sign in, maintain an authorized session, and sign out, so that I can safely use my authorized functions.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Build Firebase email/password login form | TBD |  | |
| Add Firebase ID-token verification middleware in Express | TBD |  | |
| Enforce PART and ADMIN custom-claim authorization | TBD |  | |
| Require the US-004 MFA claim before protected access | TBD |  | |
| Add token refresh, expiry, HTTPS, and cookie security configuration | TBD |  | |
| Add logout with Firebase refresh-token revocation | TBD |  | |
| Add suspended-account checks and generic login errors | TBD |  | |
| Add Vitest middleware tests and login integration tests | TBD |  | |

Table 5: US-003 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-003-T1 | Valid PART or ADMIN enters primary credentials and completes MFA | The user receives an authorized session |
| US-003-T2 | User enters an incorrect password | A generic error and retry guidance appear without revealing account existence |
| US-003-T3 | User tries a protected action before MFA succeeds | The backend rejects the request and no protected page is available |
| US-003-T4 | Suspended user tries to sign in or renew a session | Sign-in is blocked |
| US-003-T5 | User signs out and reuses an old session | Protected requests fail because the session was revoked |

Table 6: US-003 (user acceptance tests)

#### US-004

**As a Participant or Platform Administrator, I want to verify my identity via a one-time code sent to my email during login, so that a compromised password alone does not grant account access.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create PostgreSQL MFA challenge and attempt records | TBD |  | |
| Generate and email cryptographically random six-digit OTPs | TBD |  | |
| Add React OTP entry, resend, expiry, and error states | TBD |  | |
| Validate and atomically consume the current OTP | TBD |  | |
| Implement five-attempt counter and 15-minute account lock | TBD |  | |
| Invalidate predecessor challenges on resend and lock | TBD |  | |
| Add email delivery failure and retry handling | TBD |  | |
| Add Vitest and integration tests for OTP lifecycle and locking | TBD |  | |

Table 7: US-004 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-004-T1 | User enters the current six-digit code from the email | Login completes and the protected session starts |
| US-004-T2 | User enters an incorrect, expired, or already-used code | Login fails and the code cannot be reused |
| US-004-T3 | User enters five incorrect codes | The account is locked for 15 minutes and outstanding codes stop working |
| US-004-T4 | User requests a replacement code | The previous code stops working and the new code is sent without resetting failures |
| US-004-T5 | User tries OAuth or password recovery without email OTP | The user is still required to complete email OTP |
| US-004-T6 | User tries a code after lock expiry without fresh primary authentication | Login does not continue until primary authentication and a fresh OTP are completed |

Table 8: US-004 (user acceptance tests)

#### US-005

**As a user, I want to request a secure password reset link via my registered email, so that I can regain access if I forget my password.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Add password-recovery request page with generic confirmation | TBD |  | |
| Connect Firebase password-reset email service | TBD |  | |
| Add reset-link validation and password-policy form | TBD |  | |
| Revoke Firebase refresh tokens after a successful reset | TBD |  | |
| Route the next login through MFA without auto-login | TBD |  | |
| Add expired, invalid, used-link, and OAuth recovery states | TBD |  | |
| Add Vitest and integration tests for password recovery | TBD |  | |

Table 9: US-005 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-005-T1 | User submits an email on the password-recovery page | The same generic confirmation appears for known and unknown addresses |
| US-005-T2 | User opens a valid reset link and submits a compliant password | The password changes and the link is consumed |
| US-005-T3 | User opens an expired, invalid, or used reset link | The password is unchanged and an error appears |
| US-005-T4 | User signs in after resetting the password | All old sessions are revoked and email MFA is required |
| US-005-T5 | OAuth-only user requests recovery | The user receives the provider recovery path without account-type disclosure |

Table 10: US-005 (user acceptance tests)

#### US-006

**As a Participant, I want to maintain my technical profile with my role, skill tags, academic institution, and portfolio links, so that prospective teammates can assess my capabilities.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create Supabase PostgreSQL participant profile, skill, and portfolio tables | TBD |  | |
| Create Express profile read and update endpoints | TBD |  | |
| Add validation for roles, skills, institution, and HTTPS portfolio URLs | TBD |  | |
| Build React profile edit and candidate-card components | TBD |  | |
| Apply profile privacy rules for visitors, PART users, and confirmed teammates | TBD |  | |
| Show self-declared portfolio labels and field-specific errors | TBD |  | |
| Revoke shared contact visibility after team removal | TBD |  | |
| Add Vitest and integration tests for profile permissions and validation | TBD |  | |

Table 11: US-006 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-006-T1 | Participant edits their role, skills, institution, and HTTPS portfolio link | The valid changes persist and appear in candidate views |
| US-006-T2 | Participant enters a non-HTTPS or malformed portfolio URL | A field-specific error appears and other entered values remain |
| US-006-T3 | Visitor opens a participant card | Private participant details are not shown |
| US-006-T4 | Authenticated PART views a permitted candidate card | Permitted profile fields and self-declared links are visible |
| US-006-T5 | Confirmed teammate views a shared contact handle, then leaves the team | The handle is visible while confirmed and access is revoked after removal |
| US-006-T6 | Participant tries to edit another user's profile | The update is denied |

Table 12: US-006 (user acceptance tests)

#### US-007

**As a Participant, I want to record past hackathons and project links, so that Team Leads can review my self-declared experience.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create PostgreSQL hackathon-history records for participant profiles | TBD |  | |
| Add Express history create, edit, list, and delete endpoints | TBD |  | |
| Validate event name, date, role, project title, and HTTPS URL | TBD |  | |
| Compute Beginner, Competitor, and Veteran badges | TBD |  | |
| Build React history editor and profile display | TBD |  | |
| Apply authenticated viewing and owner-only edit permissions | TBD |  | |
| Add Vitest and integration tests for history and badge recalculation | TBD |  | |

Table 13: US-007 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-007-T1 | Participant adds a valid past hackathon and project link | The record is saved and the self-reported badge is recalculated |
| US-007-T2 | Participant enters an invalid project URL or date | The record is rejected with a clear validation error |
| US-007-T3 | Participant adds a fourth history record | The badge changes to Veteran and the count is shown |
| US-007-T4 | Participant edits or removes a history record | The record changes and the badge recalculates |
| US-007-T5 | Visitor tries to view participant history | History and project links are not shown |
| US-007-T6 | Authenticated PART views another permitted profile | The permitted self-reported history and links are visible |

Table 14: US-007 (user acceptance tests)

#### US-029

**As a Participant or Platform Administrator, I want to link a standard authenticator app (such as Google Authenticator or Microsoft Authenticator) to my account, so that I can generate instant 6-digit verification codes on my mobile device without waiting for email delivery.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Define the approved future authenticator enrollment and fallback design | TBD |  | |
| Add protected TOTP secret enrollment storage | TBD |  | |
| Build QR enrollment and confirmation-code screens | TBD |  | |
| Add reauthentication and recovery-code controls | TBD |  | |
| Protect secrets from logs and other accounts | TBD |  | |
| Preserve email OTP and the five-attempt/15-minute lock policy | TBD |  | |
| Add Vitest and integration tests for setup failure and activation | TBD |  | |

Table 15: US-029 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-029-T1 | Authenticated PART or ADMIN starts enrollment and confirms a valid authenticator code | The authenticator method becomes active |
| US-029-T2 | User enters an incorrect setup code | Enrollment fails and the method is not activated |
| US-029-T3 | User tries to view another account's enrollment secret | Access is denied |
| US-029-T4 | User uses a recovery code | The code works once and cannot be reused |
| US-029-T5 | User signs in before authenticator enrollment is approved | Email OTP remains the required login method |
| US-029-T6 | User enters five incorrect authenticator codes | The account-wide 15-minute lock policy is applied |

Table 16: US-029 (user acceptance tests)

#### US-008

**As a visitor or Participant, I want to browse and filter upcoming hackathons, so that I can identify events I want to attend and inspect available teams.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create PostgreSQL verified hackathon event model and indexes | TBD |  | |
| Create public Express event list and detail endpoints | TBD |  | |
| Add keyword, format, and time-state filters | TBD |  | |
| Build React event directory, filter controls, and empty state | TBD |  | |
| Show verified event metadata and safe official links | TBD |  | |
| Hide pending/rejected events and disable unsafe links | TBD |  | |
| Connect event details to the team vacancy board | TBD |  | |
| Add Vitest and integration tests for filters and visibility | TBD |  | |

Table 17: US-008 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-008-T1 | Visitor browses the event directory | Verified events show title, dates, format, location, limits, and official URL |
| US-008-T2 | User combines keyword, format, and time-state filters | Only events matching all selected filters are shown |
| US-008-T3 | User searches with filters that match nothing | A clear empty state and filter-reset option appear |
| US-008-T4 | Visitor opens an event's team board | An anonymized team preview is shown |
| US-008-T5 | User opens an ADMIN-disabled official link | The link cannot be followed from the listing |
| US-008-T6 | User opens a concluded event | The event and board are read-only |

Table 18: US-008 (user acceptance tests)

#### US-009

**As a Participant, I want to submit an unlisted hackathon for verification, so that users can form teams around one trusted event record.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create PostgreSQL pending event-submission model and status fields | TBD |  | |
| Build React event submission form with official event fields | TBD |  | |
| Add server-side HTTPS, date, format, location, and team-limit validation | TBD |  | |
| Add normalized URL and edition/start-date duplicate checks | TBD |  | |
| Show similar candidate events without automatic merging | TBD |  | |
| Create Express submitter status and resubmission endpoints | TBD |  | |
| Block recruitment until ADMIN approval and show feedback | TBD |  | |
| Add Vitest and integration tests for duplicate and status workflows | TBD |  | |

Table 19: US-009 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-009-T1 | Verified PART submits a complete new event | The event is Pending Verification and visible to the submitter and ADMIN |
| US-009-T2 | Submitter enters an invalid URL or end date before the start date | The form shows validation errors and does not submit |
| US-009-T3 | Submitter sends an event matching an existing normalized URL and edition | Similar/canonical candidates are shown and a duplicate pending record is not created |
| US-009-T4 | Submitter opens a pending event's team board | Team formation, availability, invitations, and applications are blocked |
| US-009-T5 | ADMIN rejects a submission with feedback and the submitter resubmits a correction | The status and feedback update and the corrected submission returns for review |
| US-009-T6 | Unverified or unauthenticated visitor tries to submit an event | The submission is denied |

Table 20: US-009 (user acceptance tests)

#### US-010

**As a Platform Administrator, I want to review, correct, and verify crowdsourced hackathon submissions and manage published listings, so that the platform maintains an accurate single source of truth.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create ADMIN event-verification queue and detail endpoints | TBD |  | |
| Add RBAC middleware for ADMIN event operations | TBD |  | |
| Build organizer-source, dates, URL, and team-limit review form | TBD |  | |
| Implement approve, reject, correct, merge, and archive services | TBD |  | |
| Create append-only event action records with actor, reason, outcome, and time | TBD |  | |
| Add transactional duplicate merge and invariant-conflict checks | TBD |  | |
| Disable unsafe links and recruitment while preserving memberships | TBD |  | |
| Build React queue, feedback, status, and affected-team views | TBD |  | |
| Add Vitest and integration tests for ADMIN lifecycle operations | TBD |  | |

Table 21: US-010 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-010-T1 | ADMIN reviews a complete submission and approves it | A Verified public event is created and recruitment is enabled |
| US-010-T2 | ADMIN reviews a submission with missing or inconsistent official rules | The event remains pending with actionable feedback |
| US-010-T3 | ADMIN merges two duplicate events with compatible memberships | One canonical record remains and memberships, capacities, and vacancies are preserved |
| US-010-T4 | ADMIN attempts a merge with conflicting team invariants | The merge is rejected without partial changes and conflicts are identified |
| US-010-T5 | ADMIN disables an unsafe published event | The link and recruitment stop while historical memberships remain |
| US-010-T6 | PART tries to inspect the queue or change a private roster through ADMIN controls | Access is denied |

Table 22: US-010 (user acceptance tests)

#### US-011

**As a Participant, I want to declare my availability for a specific hackathon and state my desired role and commitment level, so that Team Leads can discover me as an available candidate.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create PostgreSQL event availability model scoped to participant and event | TBD |  | |
| Build Express availability read and toggle endpoints | TBD |  | |
| Validate desired role, non-negative commitment hours, and goal labels | TBD |  | |
| Build React availability form and status display | TBD |  | |
| Restrict availability to verified PART users on Verified recruiting events | TBD |  | |
| Clear availability atomically on confirmed team membership | TBD |  | |
| Add candidate visibility and empty-state handling | TBD |  | |
| Add Vitest and integration tests for availability lifecycle | TBD |  | |

Table 23: US-011 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-011-T1 | Verified PART selects an event, role, hours, goal, and Looking for Team | The event-specific availability is saved and visible to eligible leads |
| US-011-T2 | Participant enters negative hours or an unsupported goal | The form rejects the value with a validation message |
| US-011-T3 | Visitor or unverified PART tries to declare availability | The action is blocked |
| US-011-T4 | Participant creates or joins a team for the event | Availability is cleared and cannot be re-enabled while membership is confirmed |
| US-011-T5 | Participant joins a team for one event while available for another | Only the first event's availability is cleared |

Table 24: US-011 (user acceptance tests)

#### US-012

**As a Team Lead, I want to create a structured recruitment listing with discrete skill vacancy slots and edit it as our needs evolve, so that I can attract targeted teammates.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create PostgreSQL team, membership, vacancy, and recruitment-status models | TBD |  | |
| Build atomic team-creation service that confirms the owner | TBD |  | |
| Create Express team listing and vacancy CRUD endpoints | TBD |  | |
| Add validation for pitch length, goals, hours, links, slots, and event limits | TBD |  | |
| Protect team operations with LEAD ownership checks | TBD |  | |
| Cancel pending requests when slots are removed or teams disband | TBD |  | |
| Implement member removal, availability restore, and lifecycle lock checks | TBD |  | |
| Build React team listing editor, roster, vacancy, and error states | TBD |  | |
| Add Vitest and integration tests for team lifecycle and concurrency rules | TBD |  | |

Table 25: US-012 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-012-T1 | Verified PART creates a listing for a recruiting event | The user becomes the first confirmed member and the listing is published |
| US-012-T2 | Team Lead enters a pitch over 500 characters or an unsafe link | The invalid field is rejected |
| US-012-T3 | Team Lead adds vacancies within the official event maximum | Open slots and required skills appear on the team card |
| US-012-T4 | Team Lead removes a vacancy with pending requests | Those requests are cancelled with alerts and confirmed members remain |
| US-012-T5 | Team Lead removes a non-owner member before lock | The member is removed with a reason, capacity reopens, and availability may return |
| US-012-T6 | Non-owner or user of a locked, archived, disabled, or disbanded team tries to change it | The request is denied |

Table 26: US-012 (user acceptance tests)

#### US-013

**As a Participant, I want to browse and filter open team vacancy slots for a hackathon, so that I can identify teams matching my technical stack and project goals.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create Express vacancy-board list endpoint with active-team filters | TBD |  | |
| Add skill, role, goal, and slot-count query handling | TBD |  | |
| Build React vacancy board and filter controls | TBD |  | |
| Show full PART details and anonymized visitor previews | TBD |  | |
| Add no-results state with filter reset | TBD |  | |
| Link Apply actions to the US-018 application flow | TBD |  | |
| Add Vitest and integration tests for visibility and filters | TBD |  | |

Table 27: US-013 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-013-T1 | PART opens a Verified event's team board | Active unlocked teams with open slots are displayed |
| US-013-T2 | PART combines skill, role, goal, and slot-count filters | Only matching vacancy slots are shown |
| US-013-T3 | Visitor opens the board | Anonymized previews and sign-in prompts are shown |
| US-013-T4 | User applies filters with no matching teams | A clear empty state and reset option appear |
| US-013-T5 | User clicks Apply on a vacancy | The US-018 application form opens |
| US-013-T6 | User opens a hidden or disbanded team | The team is excluded from the board |

Table 28: US-013 (user acceptance tests)

#### US-014

**As a Team Lead, I want to search and filter the event candidate pool using specific skill combinations and experience tiers, so that I can manually discover candidates who fit our vacancy needs.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create candidate-directory query service for active team owners | TBD |  | |
| Add AND/OR skills, role, hours, badge, and availability filters | TBD |  | |
| Exclude all confirmed event participants from results | TBD |  | |
| Build React candidate directory and filter controls | TBD |  | |
| Apply US-006 privacy fields and link profile inspection | TBD |  | |
| Connect candidate cards to US-017 invitations | TBD |  | |
| Add Vitest and integration tests for LEAD access and filters | TBD |  | |

Table 29: US-014 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-014-T1 | Active Team Lead opens the candidate directory | Eligible candidates for the event are shown |
| US-014-T2 | Team Lead combines AND/OR skills, role, hours, and experience filters | Results match the selected filter logic |
| US-014-T3 | Team Lead views a candidate card | Only permitted handle, role, self-reported history/badge, and skills appear |
| US-014-T4 | Team Lead clicks Invite on an eligible candidate | The US-017 invitation flow opens |
| US-014-T5 | Confirmed participant or unrelated PART tries to use the directory | Access is denied or the participant is excluded |

Table 30: US-014 (user acceptance tests)

#### US-015

**As a Team Lead, I want to view a ranked list of compatible candidates for my team's open vacancy slots, so that I can invite teammates with complementary skills and matching commitments.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Define deterministic FR-043–045 scoring rules and missing-input handling | TBD |  | |
| Create recommendation service for an owner and open slot | TBD |  | |
| Exclude inactive, unavailable, and confirmed event participants | TBD |  | |
| Implement bounded 0–100 scores and tie-breaking | TBD |  | |
| Return explainable score contributions without internal identifiers | TBD |  | |
| Build React recommendation list, empty state, and fallback state | TBD |  | |
| Connect eligible candidates to US-017 invitation flow | TBD |  | |
| Add Vitest and integration tests for scoring, permissions, and exclusions | TBD |  | |

Table 31: US-015 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-015-T1 | Team Lead requests recommendations for an open slot | Candidates appear in deterministic ranked order with scores |
| US-015-T2 | Team Lead opens a recommendation | Skill, role, goal, and hours contributions are explained |
| US-015-T3 | A candidate is not Looking for Team or is already confirmed | The candidate is excluded |
| US-015-T4 | No eligible candidates exist | A no-results message appears |
| US-015-T5 | Scoring fails for the request | An eligible unranked candidate list is shown |
| US-015-T6 | Non-owner or user with no open slot requests recommendations | The request is denied |

Table 32: US-015 (user acceptance tests)

#### US-016

**As a Participant, I want to receive proactive recommendations of open teams matching my profile, so that I can discover compatible projects without manual filtering.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Define reverse matching inputs and team eligibility rules | TBD |  | |
| Create recommendation query for a selected event and PART profile | TBD |  | |
| Calculate match percentage and matched skill tags | TBD |  | |
| Build React recommended-teams page and empty state | TBD |  | |
| Connect suggestions to the US-018 application form | TBD |  | |
| Add permission checks for the participant's own profile | TBD |  | |
| Add Vitest and integration tests for recommendations | TBD |  | |

Table 33: US-016 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-016-T1 | PART selects a hackathon and opens recommendations | Open compatible teams are shown in ranked order |
| US-016-T2 | PART opens a recommended team | A match percentage and matched skill tags are displayed |
| US-016-T3 | PART clicks Apply on a recommendation | The US-018 application form opens for that team |
| US-016-T4 | PART has no matching teams | A clear empty state appears |
| US-016-T5 | Visitor or another user tries to access a participant's recommendations | Access is denied |

Table 34: US-016 (user acceptance tests)

#### US-017

**As a Team Lead, I want to issue a direct invitation to an available candidate, so that they can review my team and decide whether to join.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create PostgreSQL invitation model with pending, expiry, and status fields | TBD |  | |
| Build owner-only Express invitation endpoint | TBD |  | |
| Validate candidate availability, team state, event, and open slot | TBD |  | |
| Enforce one pending invitation per slot and invitee/team | TBD |  | |
| Implement 48-hour expiry and acceptance-time revalidation | TBD |  | |
| Add invitation cancel endpoint and basic status alerts | TBD |  | |
| Build React invite form and invitation view | TBD |  | |
| Add Vitest and integration tests for invitations and permissions | TBD |  | |

Table 35: US-017 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-017-T1 | Team Lead invites an available PART to an open slot | A Pending invitation is created with a 48-hour expiry |
| US-017-T2 | Team Lead invites a candidate who already has a pending invite for that slot | The duplicate invitation is rejected |
| US-017-T3 | Invited PART opens an expired invitation | Acceptance is rejected and the invitation is shown as expired |
| US-017-T4 | Team Lead cancels a pending invitation | Both users see the updated invitation status |
| US-017-T5 | Non-owner or user of a locked team tries to invite | The action is denied |
| US-017-T6 | The slot closes before the candidate accepts | The invitation becomes unusable |

Table 36: US-017 (user acceptance tests)

#### US-018

**As a Participant, I want to submit an application to an open team vacancy slot, so that the Team Lead can review my profile and consider me for membership.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create PostgreSQL application model with status and slot relation | TBD |  | |
| Build React application form with optional 250-character message | TBD |  | |
| Create Express application endpoint with atomic count validation | TBD |  | |
| Enforce verified PART, active unlocked team, open slot, and one-team rules | TBD |  | |
| Enforce three pending applications per PART per event | TBD |  | |
| Add applicant status, withdrawal, and owner alert handling | TBD |  | |
| Add duplicate pending-application and rate-limit errors | TBD |  | |
| Add Vitest and integration tests for application limits and permissions | TBD |  | |

Table 37: US-018 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-018-T1 | Verified PART submits an application with a valid message | A Pending Review application is created and the owner is alerted |
| US-018-T2 | Applicant enters a message longer than 250 characters | The application is rejected with a length error |
| US-018-T3 | Applicant submits a second application to the same team | The duplicate pending application is rejected |
| US-018-T4 | Applicant reaches three pending applications in one event | A fourth application is blocked while applications for other events remain separate |
| US-018-T5 | Applicant withdraws before a decision | The application becomes withdrawn |
| US-018-T6 | Visitor, unverified PART, or confirmed event member applies | The application is denied |

Table 38: US-018 (user acceptance tests)

#### US-019

**As an invited Participant, I want to accept or decline a team invitation, so that I can confirm my team placement or keep looking.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Build invitation detail and response endpoints for the addressed PART | TBD |  | |
| Implement atomic acceptance revalidation and membership creation | TBD |  | |
| Cancel competing invitations, applications, and filled-slot requests | TBD |  | |
| Implement decline and owner alert behavior | TBD |  | |
| Implement pre-lock member leave and availability restoration | TBD |  | |
| Handle concurrent acceptance with clear conflict responses | TBD |  | |
| Build React invitation response and roster status views | TBD |  | |
| Add Vitest and integration tests for response transactions | TBD |  | |

Table 39: US-019 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-019-T1 | Addressed PART accepts a current invitation with an open slot | Membership is confirmed, the slot fills, and availability is cleared |
| US-019-T2 | Addressed PART declines an invitation | Only that invitation changes and the owner is alerted |
| US-019-T3 | User accepts after the team fills or locks | Acceptance is rejected without partial changes |
| US-019-T4 | User accepts while another join is processed at the same time | One request succeeds and the other receives a clear conflict |
| US-019-T5 | Confirmed non-owner leaves before lock | Capacity and event availability are restored and the owner is alerted |
| US-019-T6 | Wrong user tries to respond or an owner tries to leave | Access is denied and the owner must disband instead |

Table 40: US-019 (user acceptance tests)

#### US-020

**As a Team Lead, I want to review incoming applications and approve or decline candidates, so that I can select the best teammates for our vacancies.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Build owner-only application review endpoint | TBD |  | |
| Display permitted profile fields and application notes | TBD |  | |
| Implement atomic approval with capacity and membership checks | TBD |  | |
| Cancel competing requests after approval | TBD |  | |
| Implement decline outcome and basic alerts | TBD |  | |
| Handle stale and repeated decisions idempotently | TBD |  | |
| Build React application review list and decision controls | TBD |  | |
| Add Vitest and integration tests for approval conflicts and permissions | TBD |  | |

Table 41: US-020 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-020-T1 | Team Lead approves an eligible pending application | Membership is confirmed, the slot fills, and availability is cleared |
| US-020-T2 | Team Lead declines an application | The application is declined and membership and capacity remain unchanged |
| US-020-T3 | Team Lead approves after the slot or team is no longer eligible | The approval is rejected with a clear reason |
| US-020-T4 | Applicant already joined another team in the event | Approval is blocked |
| US-020-T5 | Non-owner opens the application review controls | The review and decision actions are denied |
| US-020-T6 | Team becomes full after approval | Remaining requests to the team are cancelled |

Table 42: US-020 (user acceptance tests)

#### US-021

**As an active user, I want an in-app notification center that alerts me to invitations, applications, and event verification updates, so that I can take timely action.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create PostgreSQL notification model and unread indexes | TBD |  | |
| Create notification service for recruitment and event events | TBD |  | |
| Add Express notification list, read, and mark-all endpoints | TBD |  | |
| Build React navigation bell, unread badge, and dropdown | TBD |  | |
| Add notification type labels and deep links to action views | TBD |  | |
| Add real-time refresh or polling for new alerts | TBD |  | |
| Add empty, read, and permission states | TBD |  | |
| Add Vitest and integration tests for notification creation and reading | TBD |  | |

Table 43: US-021 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-021-T1 | Active user receives an invitation or application alert | The bell shows an unread count and the alert appears in the dropdown |
| US-021-T2 | User opens a notification | The relevant invitation or team review view opens |
| US-021-T3 | User marks one notification as read | Its unread state clears and the badge updates |
| US-021-T4 | User clicks Mark all as read | All displayed notifications become read |
| US-021-T5 | User has no notifications | A clear empty state appears |
| US-021-T6 | User tries to access another user's notifications | Only the user's own notifications are available |

Table 44: US-021 (user acceptance tests)

#### US-022

**As a Team Lead, I want to confirm and lock my team's roster, so that our membership is finalized and membership mutations are frozen.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Add team roster lock fields and server lock timestamp | TBD |  | |
| Build owner-only roster validation endpoint | TBD |  | |
| Implement atomic lock transaction with join and leave operations | TBD |  | |
| Cancel pending invitations and applications on lock | TBD |  | |
| Reject post-lock exits, removals, slot edits, and disbanding | TBD |  | |
| Build React roster review, lock confirmation, and status views | TBD |  | |
| Add Vitest and integration tests for minimum, maximum, and concurrency rules | TBD |  | |

Table 45: US-022 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-022-T1 | Team Lead locks a roster meeting official minimum and maximum | The roster locks and the server lock time is shown |
| US-022-T2 | Team Lead tries to lock an underfilled roster | Locking is rejected with the required member count |
| US-022-T3 | Team Lead locks while a join or leave is occurring | The operations resolve atomically and no partial roster is created |
| US-022-T4 | Member tries to leave or Team Lead edits a slot after lock | The mutation is rejected |
| US-022-T5 | PART or ADMIN who is not the owner tries to unlock or rewrite the roster | The action is denied |
| US-022-T6 | Team member opens the locked team | The locked roster and basic status confirmation are visible |

Table 46: US-022 (user acceptance tests)

#### US-023

**As a confirmed team member, I want to access a private team workspace with shared communication links, project concept notes, and teammate contacts, so that we can coordinate before the hackathon begins.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create PostgreSQL locked-team workspace, link, note, and revision models | TBD |  | |
| Add member-only workspace authorization for active locked teams | TBD |  | |
| Create owner-only HTTPS external-link endpoints | TBD |  | |
| Create shared markdown note and revision endpoints | TBD |  | |
| Add stale-save conflict handling using revision versions | TBD |  | |
| Build React workspace, member contacts, links, note editor, and revisions | TBD |  | |
| Apply privacy rules and deletion handling for shared data | TBD |  | |
| Add Vitest and integration tests for workspace access and concurrent saves | TBD |  | |

Table 47: US-023 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-023-T1 | Confirmed member opens a locked team's workspace | The workspace shows permitted contacts, links, roles, and notes |
| US-023-T2 | Owner adds an HTTPS communication link | The link is saved and visible to team members |
| US-023-T3 | Non-owner tries to add or edit the shared external link | The action is denied |
| US-023-T4 | Member edits and saves the shared markdown note | A new revision records the author and time |
| US-023-T5 | Two members save an old version at the same time | The stale save is rejected instead of overwriting the newer note |
| US-023-T6 | Visitor, unrelated PART, or ADMIN without membership opens the workspace | Access is denied and account email is not exposed |

Table 48: US-023 (user acceptance tests)

#### US-024

**As a confirmed member of a locked team, I want to export our roster record, so that we can share consistent team information if an event accepts it.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Define canonical roster snapshot serialization | TBD |  | |
| Create export service for HTML, PDF, and JSON formats | TBD |  | |
| Add checksum generation and included-field change detection | TBD |  | |
| Build React export controls and download states | TBD |  | |
| Exclude email and private contact fields from exports | TBD |  | |
| Add locked-member authorization and historical snapshot handling | TBD |  | |
| Add Vitest and integration tests for export content and checksums | TBD |  | |

Table 49: US-024 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-024-T1 | Confirmed locked-team member exports the roster as JSON | The file contains the team, event, lock time, member names, institutions, handles, and roles |
| US-024-T2 | Member exports the printable HTML or PDF card | A readable roster card is downloaded |
| US-024-T3 | Member exports the same unchanged snapshot twice | Both exports contain the same checksum |
| US-024-T4 | An included roster field changes and the member exports again | The checksum changes |
| US-024-T5 | Export viewer checks the labels | The lock time is labelled as recorded by HackMatch and the checksum as an integrity check |
| US-024-T6 | Visitor or non-member tries to export a team | Export is denied |

Table 50: US-024 (user acceptance tests)

#### US-025

**As a Participant, I want to report an abusive profile, offensive team listing, or suspicious external URL, so that Administrators can investigate misconduct.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create PostgreSQL moderation-report model and target references | TBD |  | |
| Build report modal for profiles, teams, and event listings | TBD |  | |
| Add category and optional explanation validation | TBD |  | |
| Enforce five reports per account per rolling hour | TBD |  | |
| Create US-026 moderation cases and receipt confirmation | TBD |  | |
| Protect reports from other participants and apply PART authentication | TBD |  | |
| Add Vitest and integration tests for report limits and targets | TBD |  | |

Table 51: US-025 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-025-T1 | Signed-in PART reports a visible team listing with a category | A moderation case is created and receipt is confirmed |
| US-025-T2 | PART submits an optional explanation with the report | The explanation is saved with the case |
| US-025-T3 | PART submits a sixth report within one rolling hour | The report is rejected with a retry message |
| US-025-T4 | Another PART tries to read someone else's report | The report is not accessible |
| US-025-T5 | Visitor tries to submit a report | The report action requires signed-in PART access |

Table 52: US-025 (user acceptance tests)

#### US-026

**As a Platform Administrator, I want to review flagged team content and malicious links in a moderation queue, so that the platform remains safe, compliant, and free of phishing threats.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create moderation-case queue and target-detail Express endpoints | TBD |  | |
| Protect moderation routes with ADMIN RBAC middleware | TBD |  | |
| Build newest-first React safety queue and case view | TBD |  | |
| Add dismiss, redact, warn, hide, and URL-disable actions | TBD |  | |
| Require a reason and create safe action records for each decision | TBD |  | |
| Remove hidden content from discovery and preserve historical memberships | TBD |  | |
| Hide credentials, private contacts, and private workspace data from cases | TBD |  | |
| Add Vitest and integration tests for moderation actions and access | TBD |  | |

Table 53: US-026 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-026-T1 | ADMIN opens the moderation queue | Cases appear newest first with targets, reasons, and times |
| US-026-T2 | ADMIN hides a flagged team listing with a reason | The listing is removed from ordinary discovery and its owner can see the status |
| US-026-T3 | ADMIN confirms a malicious URL | The URL is disabled immediately and related recruitment is stopped when required |
| US-026-T4 | ADMIN tries to complete an action without a reason | The action is rejected |
| US-026-T5 | PART or Visitor tries to open or invoke moderation controls | Access is denied |
| US-026-T6 | ADMIN opens a case for a private workspace | Private workspace access and private contacts are not granted |

Table 54: US-026 (user acceptance tests)

#### US-027

**As a Platform Administrator, I want to suspend or deactivate non-compliant accounts, so that bad actors cannot harass students or disrupt team formation.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create ADMIN account-management list and detail endpoints | TBD |  | |
| Add suspension, deactivation, and deletion-request data models | TBD |  | |
| Implement session revocation and sign-in blocking on suspension | TBD |  | |
| Cancel pending requests, hide profiles, and pause owned recruitment | TBD |  | |
| Implement ownership-verified deletion and 30-day target workflow | TBD |  | |
| Pseudonymize historical membership fields while preserving locked rosters | TBD |  | |
| Protect credentials, OTPs, notes, and public ADMIN self-promotion | TBD |  | |
| Build React account enforcement views and reason forms | TBD |  | |
| Add Vitest and integration tests for suspension and deletion rules | TBD |  | |

Table 55: US-027 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-027-T1 | ADMIN suspends a non-compliant account with a reason | Sessions are revoked, sign-in is blocked, and the profile is hidden |
| US-027-T2 | Suspended user tries to sign in or use a current session | Access is denied |
| US-027-T3 | ADMIN suspends an account that owns an unlocked team | Recruitment pauses and outgoing invitations are cancelled without deleting unrelated teams |
| US-027-T4 | ADMIN submits an ownership-verified deletion request | The request is recorded and live identifying data enters the deletion workflow |
| US-027-T5 | ADMIN tries to delete an unlocked team owner who has not disbanded | Deletion is blocked until the owner disbands |
| US-027-T6 | PART tries to use account-management controls | Access is denied |

Table 56: US-027 (user acceptance tests)

#### US-028

**As an Administrator, I want to review and filter administrative action records, so that I can investigate past decisions.**

| Task | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|
| Create append-only audit-record query endpoint | TBD |  | |
| Build React audit table with record ID, actor, action, target, reason, outcome, and UTC time | TBD |  | |
| Add actor, action-type, and date filters | TBD |  | |
| Add empty state and pagination for no or many results | TBD |  | |
| Apply read-only ADMIN permissions and deny record mutations | TBD |  | |
| Apply retention and pseudonymization display rules | TBD |  | |
| Add Vitest and integration tests for filters and access | TBD |  | |

Table 57: US-028 (disaggregated tasks)

| Test ID | Test (what the user does) | Expected result |
|---|---|---|
| US-028-T1 | ADMIN opens the audit review page | Event, moderation, and account action records are displayed |
| US-028-T2 | ADMIN filters by actor, action type, and date | Only matching records are shown |
| US-028-T3 | ADMIN searches for a combination with no matches | A clear empty state appears |
| US-028-T4 | ADMIN opens a record | The record ID, actor, target, safe summary, reason, outcome, and UTC time are visible |
| US-028-T5 | PART or Visitor opens the audit page | Access is denied |
| US-028-T6 | User tries to edit or delete an audit record through ordinary controls | No mutation is allowed |

Table 58: US-028 (user acceptance tests)

## Summary

| Story ID | Number of tasks | Total estimated hours | Number of acceptance tests |
|---|---:|---:|---:|
| US-001 | 8 |  | 6 |
| US-002 | 8 |  | 6 |
| US-003 | 8 |  | 5 |
| US-004 | 8 |  | 6 |
| US-005 | 7 |  | 5 |
| US-006 | 8 |  | 6 |
| US-007 | 7 |  | 6 |
| US-029 | 7 |  | 6 |
| US-008 | 8 |  | 6 |
| US-009 | 8 |  | 6 |
| US-010 | 9 |  | 6 |
| US-011 | 8 |  | 5 |
| US-012 | 9 |  | 6 |
| US-013 | 7 |  | 6 |
| US-014 | 7 |  | 5 |
| US-015 | 8 |  | 6 |
| US-016 | 7 |  | 5 |
| US-017 | 8 |  | 6 |
| US-018 | 8 |  | 6 |
| US-019 | 8 |  | 6 |
| US-020 | 8 |  | 6 |
| US-021 | 8 |  | 6 |
| US-022 | 7 |  | 6 |
| US-023 | 8 |  | 6 |
| US-024 | 7 |  | 6 |
| US-025 | 7 |  | 5 |
| US-026 | 8 |  | 6 |
| US-027 | 9 |  | 6 |
| US-028 | 7 |  | 6 |
| **Total** | **225** |  | **168** |
