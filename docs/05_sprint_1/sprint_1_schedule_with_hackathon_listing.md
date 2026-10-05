# Sprint 1 Detailed Implementation Schedule (Aligned with Task Disaggregation)

**Sprint Duration:** October 5, 2026 – October 24, 2026 (Freeze: October 24 EOD; Course Demo: October 25, 2026)  
**Team Size:** 6 Developers  
**Sprint 1 Focus:** Identity, Authentication, Mandatory 2FA, Password Recovery, Profiles, Hackathon Event Directory, Submissions, Admin Verification, and Security Hardening  
**Scope Baseline (9 User Stories / 72 Disaggregated Tasks):**  
- **Feature Area 1 (Identity & Profiles):** [US-001](../02_user_stories/user_stories.md#us-001), [US-002](../02_user_stories/user_stories.md#us-002), [US-003](../02_user_stories/user_stories.md#us-003), [US-004](../02_user_stories/user_stories.md#us-004), [US-005](../02_user_stories/user_stories.md#us-005), [US-006](../02_user_stories/user_stories.md#us-006)  
- **Feature Area 2 (Hackathons & Verification):** [US-008](../02_user_stories/user_stories.md#us-008), [US-009](../02_user_stories/user_stories.md#us-009), [US-010](../02_user_stories/user_stories.md#us-010)  
**Source Baseline:** Every task title, scope, and test requirement in this schedule is directly mapped from [Task Disaggregation](task_disaggregation.md).  
**Deferred Scope (11 User Stories):** [US-011](../02_user_stories/user_stories.md#us-011)–[US-013](../02_user_stories/user_stories.md#us-013), [US-015](../02_user_stories/user_stories.md#us-015), [US-017](../02_user_stories/user_stories.md#us-017)–[US-020](../02_user_stories/user_stories.md#us-020), [US-022](../02_user_stories/user_stories.md#us-022), [US-026](../02_user_stories/user_stories.md#us-026), [US-027](../02_user_stories/user_stories.md#us-027) deferred to Sprint 2 (MVP Target: November 29, 2026) per [MVP Definition](../03_mvp/mvp_definition.md#official-course-milestones--mvp-work-only).

---

## 1. Team Allocation Matrix

The 72 disaggregated tasks from [Task Disaggregation](task_disaggregation.md) are distributed across three engineering streams:

| Dev ID | Assigned Member | Engineering Stream | Owned Stories | Task Count | Key Ownership |
|---|---|---|---|---|---|
| **Dev 1** | TBD (Assignee 1) | Credentials & Account Recovery | [US-001](../02_user_stories/user_stories.md#us-001), [US-005](../02_user_stories/user_stories.md#us-005) | 15 tasks | Registration form, password validation, verification links, recovery flow, and reset session revocation. |
| **Dev 2** | TBD (Assignee 2) | Federated Identity & 2FA Engine | [US-002](../02_user_stories/user_stories.md#us-002), [US-004](../02_user_stories/user_stories.md#us-004) | 16 tasks | Google/GitHub OAuth, provider linking, cryptographically secure 6-digit OTP engine, and 5-attempt/15-min lockout. |
| **Dev 3** | TBD (Assignee 3) | Primary Authentication & Sessions | [US-003](../02_user_stories/user_stories.md#us-003) | 8 tasks + Auth Arch | Login form, credential validation, failure throttling, JWT token rotation, and refresh token revocation. |
| **Dev 4** | TBD (Assignee 4) | Profiles & Public Event Directory | [US-006](../02_user_stories/user_stories.md#us-006), [US-008](../02_user_stories/user_stories.md#us-008) | 16 tasks | Profile editor, URL validation, visitor privacy redaction, and public event directory with multi-filter search. |
| **Dev 5** | TBD (Assignee 5) | Event Submissions & Admin Gating | [US-009](../02_user_stories/user_stories.md#us-009), [US-010](../02_user_stories/user_stories.md#us-010) | 17 tasks | Event submission, duplicate URL detection, admin verification queue, publication gating, and audit records. |
| **Dev 6** | TBD (Assignee 6) | Core Infrastructure, RBAC & QA | Cross-cutting Foundation | Supporting Infra | Repository setup (Vite/React/Express), Supabase DDL migrations, RBAC middleware, CI/CD, and test suite orchestration. |

---

## 2. Phase-by-Phase Timeline (October 5 – October 24)

```mermaid
gantt
    title Sprint 1 Schedule: 72 Disaggregated Tasks (US-001 to US-006 & US-008 to US-010)
    dateFormat  YYYY-MM-DD
    section Phase 0: Scaffolding & DB
    Repo Scaffolding & CI/CD Pipeline (Dev 6)       :p0_1, 2026-10-05, 2026-10-07
    PostgreSQL Schemas & Migrations (Dev 1,2,4,5,6) :p0_2, 2026-10-05, 2026-10-07
    API Contracts & Mock Adapters (All Devs)        :p0_3, 2026-10-05, 2026-10-07
    section Phase 1: Isolated Features
    US-001: Registration & Email Links (Dev 1)      :p1_1, 2026-10-08, 2026-10-13
    US-002: OAuth Buttons & Callback (Dev 2)        :p1_2, 2026-10-08, 2026-10-13
    US-003: Login Form & Credential Validation (Dev 3):p1_3, 2026-10-08, 2026-10-13
    US-004: OTP Generation & Entry Form (Dev 2)     :p1_4, 2026-10-08, 2026-10-13
    US-005: Password Recovery Request/Reset (Dev 1) :p1_5, 2026-10-08, 2026-10-13
    US-006: Profile Editor & Endpoints (Dev 4)      :p1_6, 2026-10-08, 2026-10-13
    US-008: Event Directory & Filters (Dev 4)       :p1_7, 2026-10-08, 2026-10-13
    US-009: Event Submission & Duplicate Check (Dev 5):p1_8, 2026-10-08, 2026-10-13
    US-010: Admin Verification Queue (Dev 5)        :p1_9, 2026-10-08, 2026-10-13
    section Phase 2: Integration & Gating
    Route Login/OAuth into OTP & Lockout (Dev 2, 3) :p2_1, 2026-10-14, 2026-10-18
    Enforce RBAC Claims & Protected Routes (Dev 3, 6):p2_2, 2026-10-14, 2026-10-18
    Profile Privacy Redaction & Access Rules (Dev 4, 6):p2_3, 2026-10-14, 2026-10-18
    Admin Event Approval & Publication Gating (Dev 5):p2_4, 2026-10-15, 2026-10-18
    Token Revocation on Reset/Logout (Dev 1, 3)     :p2_5, 2026-10-15, 2026-10-18
    section Phase 3: Tests & Hardening
    Vitest Suites for Auth & Recovery (Dev 1, 2, 3) :p3_1, 2026-10-19, 2026-10-22
    Vitest Suites for Profiles & Events (Dev 4, 5)  :p3_2, 2026-10-19, 2026-10-22
    Intrusion, WCAG & Layout Audits (Dev 6)         :p3_3, 2026-10-20, 2026-10-22
    section Phase 4: Freeze & Demo
    Release Tagging & Code Freeze (All)             :p4_1, 2026-10-23, 2026-10-23
    Sprint 1 Demo Live Rehearsal (All)              :p4_2, 2026-10-24, 2026-10-24
```

---

## 3. Granular Phase Breakdown (Mapped from task_disaggregation.md)

### Phase 0: Scaffolding, Schemas & Infrastructure (Oct 5 – Oct 7)
> *Goal: Establish database tables, schema models, and API contracts directly from [Task Disaggregation](task_disaggregation.md) so all 6 developers can build Phase 1 tasks in parallel using mock adapters.*

| Task ID | Story | Exact Task Name (from task_disaggregation.md) | Assignee | Est. | Target |
|---|---|---|---|---:|---|
| **S1-P0-01** | Cross-cutting | Initialize React (Vite) + Tailwind CSS client and Node.js/Express server; configure CI/CD pipeline | Dev 6 | 8h | Oct 6 |
| **S1-P0-02** | [US-001](../02_user_stories/user_stories.md#us-001) | Create PostgreSQL participant profile record with PART role and Unverified state | Dev 1, Dev 6 | 6h | Oct 7 |
| **S1-P0-03** | [US-002](../02_user_stories/user_stories.md#us-002) | Configure Firebase Google and GitHub OAuth providers | Dev 2 | 5h | Oct 6 |
| **S1-P0-04** | [US-002](../02_user_stories/user_stories.md#us-002) | Create provider identity link records for PART accounts | Dev 2, Dev 6 | 5h | Oct 7 |
| **S1-P0-05** | [US-004](../02_user_stories/user_stories.md#us-004) | Create PostgreSQL MFA challenge and attempt records | Dev 2, Dev 6 | 6h | Oct 7 |
| **S1-P0-06** | [US-006](../02_user_stories/user_stories.md#us-006) | Create Supabase PostgreSQL participant profile, skill, and portfolio tables | Dev 4, Dev 6 | 6h | Oct 7 |
| **S1-P0-07** | [US-008](../02_user_stories/user_stories.md#us-008) | Create PostgreSQL verified hackathon event model and indexes | Dev 4, Dev 6 | 6h | Oct 7 |
| **S1-P0-08** | [US-009](../02_user_stories/user_stories.md#us-009) | Create PostgreSQL pending event-submission model and status fields | Dev 5, Dev 6 | 6h | Oct 7 |
| **S1-P0-09** | [US-010](../02_user_stories/user_stories.md#us-010) | Create append-only event action records with actor, reason, outcome, and time | Dev 5, Dev 6 | 6h | Oct 7 |

---

### Phase 1: Isolated Feature Development (Oct 8 – Oct 13)
> *Goal: Build core UI components, input forms, API endpoints, and business rules defined in [Task Disaggregation](task_disaggregation.md).*

| Task ID | Story | Exact Task Name (from task_disaggregation.md) | Assignee | Est. | Target |
|---|---|---|---|---:|---|
| **S1-P1-01** | [US-001](../02_user_stories/user_stories.md#us-001) | Create Firebase Auth registration form for full name, email, and password | Dev 1 | 8h | Oct 10 |
| **S1-P1-02** | [US-001](../02_user_stories/user_stories.md#us-001) | Connect Firebase Auth email/password registration and password-policy validation | Dev 1 | 8h | Oct 11 |
| **S1-P1-03** | [US-001](../02_user_stories/user_stories.md#us-001) | Send and process Firebase email verification links | Dev 1 | 7h | Oct 13 |
| **S1-P1-04** | [US-002](../02_user_stories/user_stories.md#us-002) | Add React provider sign-in buttons and callback handling | Dev 2 | 7h | Oct 10 |
| **S1-P1-05** | [US-002](../02_user_stories/user_stories.md#us-002) | Require verified provider email before provisioning a PART profile | Dev 2 | 6h | Oct 12 |
| **S1-P1-06** | [US-003](../02_user_stories/user_stories.md#us-003) | Build Firebase email/password login form | Dev 3 | 7h | Oct 10 |
| **S1-P1-07** | [US-003](../02_user_stories/user_stories.md#us-003) | Add Firebase ID-token verification middleware in Express | Dev 3 | 8h | Oct 12 |
| **S1-P1-08** | [US-003](../02_user_stories/user_stories.md#us-003) | Add token refresh, expiry, HTTPS, and cookie security configuration | Dev 3 | 7h | Oct 13 |
| **S1-P1-09** | [US-004](../02_user_stories/user_stories.md#us-004) | Generate and email cryptographically random six-digit OTPs | Dev 2 | 8h | Oct 10 |
| **S1-P1-10** | [US-004](../02_user_stories/user_stories.md#us-004) | Add React OTP entry, resend, expiry, and error states | Dev 2 | 7h | Oct 12 |
| **S1-P1-11** | [US-004](../02_user_stories/user_stories.md#us-004) | Validate and atomically consume the current OTP | Dev 2 | 8h | Oct 13 |
| **S1-P1-12** | [US-005](../02_user_stories/user_stories.md#us-005) | Add password-recovery request page with generic confirmation | Dev 1 | 6h | Oct 10 |
| **S1-P1-13** | [US-005](../02_user_stories/user_stories.md#us-005) | Connect Firebase password-reset email service | Dev 1 | 7h | Oct 12 |
| **S1-P1-14** | [US-005](../02_user_stories/user_stories.md#us-005) | Add reset-link validation and password-policy form | Dev 1 | 7h | Oct 13 |
| **S1-P1-15** | [US-006](../02_user_stories/user_stories.md#us-006) | Create Express profile read and update endpoints | Dev 4 | 7h | Oct 10 |
| **S1-P1-16** | [US-006](../02_user_stories/user_stories.md#us-006) | Add validation for roles, skills, institution, and HTTPS portfolio URLs | Dev 4 | 6h | Oct 11 |
| **S1-P1-17** | [US-006](../02_user_stories/user_stories.md#us-006) | Build React profile edit and candidate-card components | Dev 4 | 8h | Oct 13 |
| **S1-P1-18** | [US-008](../02_user_stories/user_stories.md#us-008) | Create public Express event list and detail endpoints | Dev 4 | 7h | Oct 10 |
| **S1-P1-19** | [US-008](../02_user_stories/user_stories.md#us-008) | Add keyword, format, and time-state filters | Dev 4 | 6h | Oct 11 |
| **S1-P1-20** | [US-008](../02_user_stories/user_stories.md#us-008) | Build React event directory, filter controls, and empty state | Dev 4 | 8h | Oct 12 |
| **S1-P1-21** | [US-008](../02_user_stories/user_stories.md#us-008) | Show verified event metadata and safe official links | Dev 4 | 5h | Oct 13 |
| **S1-P1-22** | [US-009](../02_user_stories/user_stories.md#us-009) | Build React event submission form with official event fields | Dev 5 | 8h | Oct 10 |
| **S1-P1-23** | [US-009](../02_user_stories/user_stories.md#us-009) | Add server-side HTTPS, date, format, location, and team-limit validation | Dev 5 | 7h | Oct 11 |
| **S1-P1-24** | [US-009](../02_user_stories/user_stories.md#us-009) | Add normalized URL and edition/start-date duplicate checks | Dev 5 | 8h | Oct 12 |
| **S1-P1-25** | [US-009](../02_user_stories/user_stories.md#us-009) | Create Express submitter status and resubmission endpoints | Dev 5 | 7h | Oct 13 |
| **S1-P1-26** | [US-010](../02_user_stories/user_stories.md#us-010) | Create ADMIN event-verification queue and detail endpoints | Dev 5 | 7h | Oct 11 |
| **S1-P1-27** | [US-010](../02_user_stories/user_stories.md#us-010) | Build organizer-source, dates, URL, and team-limit review form | Dev 5 | 8h | Oct 12 |
| **S1-P1-28** | [US-010](../02_user_stories/user_stories.md#us-010) | Implement approve, reject, correct, merge, and archive services | Dev 5 | 8h | Oct 13 |

---

### Phase 2: Pipeline Integration, Security Gating & Error States (Oct 14 – Oct 18)
> *Goal: Connect authentication pipelines, enforce RBAC custom claims, apply privacy boundaries, and handle error/lockout states.*

| Task ID | Story | Exact Task Name (from task_disaggregation.md) | Assignee | Est. | Target |
|---|---|---|---|---:|---|
| **S1-P2-01** | [US-001](../02_user_stories/user_stories.md#us-001) | Block unverified team, availability, application, and invitation actions | Dev 1 | 6h | Oct 15 |
| **S1-P2-02** | [US-001](../02_user_stories/user_stories.md#us-001) | Protect ADMIN provisioning from public registration | Dev 1, Dev 6 | 5h | Oct 16 |
| **S1-P2-03** | [US-001](../02_user_stories/user_stories.md#us-001) | Add React verification, replacement-link, and invalid-link states | Dev 1 | 6h | Oct 17 |
| **S1-P2-04** | [US-002](../02_user_stories/user_stories.md#us-002) | Add reauthentication before linking a provider to an existing account | Dev 2 | 6h | Oct 15 |
| **S1-P2-05** | [US-002](../02_user_stories/user_stories.md#us-002) | Route every provider sign-in into the email OTP flow | Dev 2 | 7h | Oct 16 |
| **S1-P2-06** | [US-002](../02_user_stories/user_stories.md#us-002) | Add provider cancellation, failure, and unverified-email states | Dev 2 | 6h | Oct 17 |
| **S1-P2-07** | [US-003](../02_user_stories/user_stories.md#us-003) | Enforce PART and ADMIN custom-claim authorization | Dev 3, Dev 6 | 7h | Oct 15 |
| **S1-P2-08** | [US-003](../02_user_stories/user_stories.md#us-003) | Require the US-004 MFA claim before protected access | Dev 3 | 7h | Oct 16 |
| **S1-P2-09** | [US-003](../02_user_stories/user_stories.md#us-003) | Add logout with Firebase refresh-token revocation | Dev 3 | 6h | Oct 17 |
| **S1-P2-10** | [US-003](../02_user_stories/user_stories.md#us-003) | Add suspended-account checks and generic login errors | Dev 3 | 6h | Oct 18 |
| **S1-P2-11** | [US-004](../02_user_stories/user_stories.md#us-004) | Implement five-attempt counter and 15-minute account lock | Dev 2 | 8h | Oct 15 |
| **S1-P2-12** | [US-004](../02_user_stories/user_stories.md#us-004) | Invalidate predecessor challenges on resend and lock | Dev 2 | 6h | Oct 16 |
| **S1-P2-13** | [US-004](../02_user_stories/user_stories.md#us-004) | Add email delivery failure and retry handling | Dev 2 | 6h | Oct 17 |
| **S1-P2-14** | [US-005](../02_user_stories/user_stories.md#us-005) | Revoke Firebase refresh tokens after a successful reset | Dev 1 | 6h | Oct 15 |
| **S1-P2-15** | [US-005](../02_user_stories/user_stories.md#us-005) | Route the next login through MFA without auto-login | Dev 1 | 6h | Oct 16 |
| **S1-P2-16** | [US-005](../02_user_stories/user_stories.md#us-005) | Add expired, invalid, used-link, and OAuth recovery states | Dev 1 | 6h | Oct 17 |
| **S1-P2-17** | [US-006](../02_user_stories/user_stories.md#us-006) | Apply profile privacy rules for visitors, PART users, and confirmed teammates | Dev 4, Dev 6 | 7h | Oct 15 |
| **S1-P2-18** | [US-006](../02_user_stories/user_stories.md#us-006) | Show self-declared portfolio labels and field-specific errors | Dev 4 | 5h | Oct 16 |
| **S1-P2-19** | [US-006](../02_user_stories/user_stories.md#us-006) | Revoke shared contact visibility after team removal | Dev 4 | 6h | Oct 17 |
| **S1-P2-20** | [US-008](../02_user_stories/user_stories.md#us-008) | Hide pending/rejected events and disable unsafe links | Dev 4 | 5h | Oct 15 |
| **S1-P2-21** | [US-008](../02_user_stories/user_stories.md#us-008) | Connect event details to the team vacancy board | Dev 4 | 6h | Oct 17 |
| **S1-P2-22** | [US-009](../02_user_stories/user_stories.md#us-009) | Show similar candidate events without automatic merging | Dev 5 | 6h | Oct 15 |
| **S1-P2-23** | [US-009](../02_user_stories/user_stories.md#us-009) | Block recruitment until ADMIN approval and show feedback | Dev 5 | 7h | Oct 16 |
| **S1-P2-24** | [US-010](../02_user_stories/user_stories.md#us-010) | Add RBAC middleware for ADMIN event operations | Dev 5, Dev 6 | 7h | Oct 15 |
| **S1-P2-25** | [US-010](../02_user_stories/user_stories.md#us-010) | Add transactional duplicate merge and invariant-conflict checks | Dev 5 | 7h | Oct 16 |
| **S1-P2-26** | [US-010](../02_user_stories/user_stories.md#us-010) | Disable unsafe links and recruitment while preserving memberships | Dev 5 | 6h | Oct 17 |
| **S1-P2-27** | [US-010](../02_user_stories/user_stories.md#us-010) | Build React queue, feedback, status, and affected-team views | Dev 5 | 7h | Oct 18 |

---

### Phase 3: Vitest Test Suites, Acceptance Verification & Rubric Evidence (Oct 19 – Oct 22)
> *Goal: Execute the 9 disaggregated Vitest test tasks directly from [Task Disaggregation](task_disaggregation.md) and satisfy course rubric requirements.*

| Task ID | Story | Exact Task Name (from task_disaggregation.md) | Assignee | Est. | Target |
|---|---|---|---|---:|---|
| **S1-P3-01** | [US-001](../02_user_stories/user_stories.md#us-001) | Add Vitest unit tests and integration tests for registration and verification | Dev 1 | 8h | Oct 20 |
| **S1-P3-02** | [US-002](../02_user_stories/user_stories.md#us-002) | Add Vitest and integration tests for OAuth registration and linking | Dev 2 | 8h | Oct 20 |
| **S1-P3-03** | [US-003](../02_user_stories/user_stories.md#us-003) | Add Vitest middleware tests and login integration tests | Dev 3 | 8h | Oct 20 |
| **S1-P3-04** | [US-004](../02_user_stories/user_stories.md#us-004) | Add Vitest and integration tests for OTP lifecycle and locking | Dev 2 | 8h | Oct 21 |
| **S1-P3-05** | [US-005](../02_user_stories/user_stories.md#us-005) | Add Vitest and integration tests for password recovery | Dev 1 | 7h | Oct 21 |
| **S1-P3-06** | [US-006](../02_user_stories/user_stories.md#us-006) | Add Vitest and integration tests for profile permissions and validation | Dev 4 | 8h | Oct 21 |
| **S1-P3-07** | [US-008](../02_user_stories/user_stories.md#us-008) | Add Vitest and integration tests for filters and visibility | Dev 4 | 7h | Oct 22 |
| **S1-P3-08** | [US-009](../02_user_stories/user_stories.md#us-009) | Add Vitest and integration tests for duplicate and status workflows | Dev 5 | 8h | Oct 22 |
| **S1-P3-09** | [US-010](../02_user_stories/user_stories.md#us-010) | Add Vitest and integration tests for ADMIN lifecycle operations | Dev 5 | 8h | Oct 22 |
| **S1-P3-10** | Rubric QA | Perform WCAG 2.1 AA accessibility audit, responsive checks, and compile execution reports | Dev 6 | 8h | Oct 22 |

---

### Phase 4: Code Freeze & Demo Rehearsal (Oct 23 – Oct 24)

| Task ID | Task Description | Assignee | Duration | Target Date |
|---|---|---|---|---|
| **S1-P4-01** | **Feature Freeze:** Merge `develop` into `release/sprint-1`. Fix blocking defects only. | All Devs | 1 day | Oct 23 |
| **S1-P4-02** | **Demo Rehearsal 1 (Identity & Security):** Live dry run of registration, OAuth, OTP challenge, lockout defense, and profile editing. | All Devs | Half day | Oct 24 (Morning) |
| **S1-P4-03** | **Demo Rehearsal 2 (Events & Admin Gating):** Live dry run of participant event submission, duplicate detection, admin verification, and public discovery. | All Devs | Half day | Oct 24 (Afternoon) |
| **S1-P4-04** | **Artifact Sign-Off:** Confirm Git commit history, pull requests, test logs, and diagrams are submitted to course portal. | All Devs | Half day | Oct 24 EOD |

---

## 4. User Acceptance Test (UAT) Traceability Matrix

Every live demonstration step maps directly to the test scenarios defined in [Task Disaggregation](task_disaggregation.md):

| Test ID | Origin Story | Scenario Tested in Demo | Expected Outcome in Demo |
|---|---|---|---|
| **US-001-T1** | [US-001](../02_user_stories/user_stories.md#us-001) | Visitor submits valid registration form | Account created in `Unverified` state; verification email dispatched. |
| **US-001-T2** | [US-001](../02_user_stories/user_stories.md#us-001) | Visitor submits non-compliant password | Password policy errors rendered; form values preserved. |
| **US-001-T3** | [US-001](../02_user_stories/user_stories.md#us-001) | User opens valid email verification link | Account state transitions to `Verified`; directed to sign in. |
| **US-002-T1** | [US-002](../02_user_stories/user_stories.md#us-002) | User clicks Google or GitHub OAuth | Identity authenticated with provider, but routed to email OTP before session issuance. |
| **US-003-T1** | [US-003](../02_user_stories/user_stories.md#us-003) | User enters valid primary credentials | Credentials accepted; redirected to MFA challenge screen. |
| **US-004-T1** | [US-004](../02_user_stories/user_stories.md#us-004) | User enters valid 6-digit OTP code | OTP consumed atomically; JWT session issued; user dashboard loads. |
| **US-004-T3** | [US-004](../02_user_stories/user_stories.md#us-004) | User inputs 5 consecutive incorrect OTPs | Account is locked for 15 minutes; challenges invalidated. |
| **US-005-T4** | [US-005](../02_user_stories/user_stories.md#us-005) | User resets password and logs in | All previous sessions terminated; requires fresh primary login and OTP. |
| **US-006-T1** | [US-006](../02_user_stories/user_stories.md#us-006) | Participant edits role, skills, institution, and links | Data persisted; portfolio URLs labeled self-declared. |
| **US-006-T3** | [US-006](../02_user_stories/user_stories.md#us-006) | Unauthenticated visitor inspects profile endpoint | Private participant contact and email are redacted. |
| **US-008-T1** | [US-008](../02_user_stories/user_stories.md#us-008) | Visitor browses event directory | Verified hackathon cards render with dates, formats, and safe links. |
| **US-008-T2** | [US-008](../02_user_stories/user_stories.md#us-008) | User applies keyword and format filters | Real-time filtering shows only matching verified events. |
| **US-009-T1** | [US-009](../02_user_stories/user_stories.md#us-009) | Participant submits unlisted hackathon | Event saved in `Pending` state; hidden from public directory. |
| **US-009-T3** | [US-009](../02_user_stories/user_stories.md#us-009) | Participant submits duplicate normalized URL | Duplicate detection flags candidate; duplicate record blocked. |
| **US-010-T1** | [US-010](../02_user_stories/user_stories.md#us-010) | Administrator accesses verification queue | Non-ADMIN access denied; ADMIN reviews submitted rules and dates. |
| **US-010-T3** | [US-010](../02_user_stories/user_stories.md#us-010) | Administrator approves pending submission | Event publishes immediately; appears in public directory. |
