# HackMatch Engineering Diagrams

This is the single documentation and navigation source for HackMatch engineering diagrams. Mermaid (`.mmd`) files are the editable sources of truth; matching `.png` files are report-ready renders. Story folders contain diagram assets only.

## Purpose and architecture baseline

- [`../02_user_stories/user_stories.md`](../02_user_stories/user_stories.md) defines current Event-Free User Story behavior and traceability. The [requirements](../04_requirements/functional_nonfunctional_requirements.md) and [task disaggregation](../05_sprint_1/task_disaggregation.md) provide supporting requirements and acceptance-test traceability.
- Source code, migrations, and tests determine each repository-audited implementation status.
- Team formation, discovery, availability, recommendations, invitations, and applications are platform-wide. Backend shadow events are database-compatibility details, not user-selected events.
- US-008, US-009, and US-010 are deprecated by the Event-Free Architecture and intentionally have no active diagrams.
- The diagrams explain focused workflows. The retained shared ERD supplies high-level physical-schema context without duplicating a full ERD in each story.

## Inventory

| Item | Count |
|---|---:|
| Diagrammed User Stories | 18 |
| Mermaid sources | 41 |
| Matching rendered diagram PNGs | 41 |
| Shared reference images | 1 |
| Total PNG files | 42 |

## Diagram and visual conventions

- Story assets use descriptive `US-XXX-feature-diagram-type` names; every generated Mermaid source has a same-basename PNG.
- Diagrams use a white background, dark text/connectors, readable spacing, explicit labels, and titles containing the story ID and diagram type.
- Blue represents participants, identity, profiles, and authentication; purple represents collaboration, teams, and recruitment; yellow/gold represents validation, availability, preferences, and decisions; green represents success and persistence; red/pink represents rejection, invalid, suspended, or destructive states; gray represents infrastructure, compatibility, planned, or deprecated concepts.
- Color is supplementary. Labels communicate meaning without relying on color.
- Event-Free workflows do not show a participant selecting an event. If a backend shadow event is technically relevant, it is subdued and identified as an internal compatibility detail.
- Diagrams exclude passwords, OTP values/hashes, tokens, credentials, private contact data, and unnecessary internal identifiers.

## Status definitions

- **Implemented (repository-audited):** The repository satisfies the audited story workflow and acceptance criteria, with no material gap found during diagram review.
- **Partial (repository-audited):** The principal workflow exists, but meaningful criteria, architecture, security, or production-verification gaps remain.
- **Planned — specification-grounded:** Committed requirements support an engineering design, but the repository lacks sufficient implementation to claim Partial or Implemented.
- **Post-MVP / future:** Outside the current MVP implementation audit; no implementation status is asserted.
- **Deprecated:** Removed from active scope and intentionally not diagrammed.

## Shared reference

[`shared/HackMatch Supabase Schema ERD.png`](<shared/HackMatch Supabase Schema ERD.png>) is the existing project Supabase physical-schema ERD. It was retained—not recreated—as the visual-style and high-level relationship reference and has no repository Mermaid source. It may show legacy or backend-compatibility structures such as `events`; their presence does not make them user-facing workflows. Repository migrations and schema remain authoritative for exact physical structure.

## User Story diagram index

Every link below resolves from this central README. “Source” opens the editable Mermaid file.

| User Story | Status | Diagrams |
|---|---|---|
| **US-001 — Participant Registration and Email Verification** | Partial (repository-audited) | Participant Registration Use Case ([PNG](US-001/US-001-participant-registration-use-case.png), [source](US-001/US-001-participant-registration-use-case.mmd))<br>Registration Sequence ([PNG](US-001/US-001-registration-sequence.png), [source](US-001/US-001-registration-sequence.mmd))<br>Email Verification Sequence ([PNG](US-001/US-001-email-verification-sequence.png), [source](US-001/US-001-email-verification-sequence.mmd)) |
| **US-002 — Federated OAuth Registration and Authentication** | Partial (repository-audited) | OAuth Sign-In Sequence ([PNG](US-002/US-002-federated-oauth-sign-in-sequence.png), [source](US-002/US-002-federated-oauth-sign-in-sequence.mmd))<br>Provider Account Linking Sequence ([PNG](US-002/US-002-provider-account-linking-sequence.png), [source](US-002/US-002-provider-account-linking-sequence.mmd)) |
| **US-003 — User Login and Session Management** | Partial (repository-audited) | Login and Authorization Sequence ([PNG](US-003/US-003-login-authorization-sequence.png), [source](US-003/US-003-login-authorization-sequence.mmd))<br>Session Lifecycle State ([PNG](US-003/US-003-session-lifecycle-state.png), [source](US-003/US-003-session-lifecycle-state.mmd)) |
| **US-004 — Email-Based Login Two-Factor Authentication** | Partial (repository-audited) | MFA Login Sequence ([PNG](US-004/US-004-mfa-login-sequence.png), [source](US-004/US-004-mfa-login-sequence.mmd))<br>MFA Challenge State ([PNG](US-004/US-004-mfa-challenge-state.png), [source](US-004/US-004-mfa-challenge-state.mmd)) |
| **US-005 — Password Recovery for PART/ADMIN** | Implemented (repository-audited) | Recovery Request Sequence ([PNG](US-005/US-005-password-recovery-request-sequence.png), [source](US-005/US-005-password-recovery-request-sequence.mmd))<br>Reset Confirmation Sequence ([PNG](US-005/US-005-password-reset-confirmation-sequence.png), [source](US-005/US-005-password-reset-confirmation-sequence.mmd)) |
| **US-006 — Participant Profile Management** | Partial (repository-audited) | Profile Management Sequence ([PNG](US-006/US-006-profile-management-sequence.png), [source](US-006/US-006-profile-management-sequence.mmd))<br>Profile Visibility and Contact Access Flow ([PNG](US-006/US-006-profile-visibility-access-flow.png), [source](US-006/US-006-profile-visibility-access-flow.mmd))<br>Focused Profile Data ERD ([PNG](US-006/US-006-profile-data-erd.png), [source](US-006/US-006-profile-data-erd.mmd)) |
| **US-011 — Declare Platform Availability and Looking-for-Team Status** | Partial (repository-audited) | Availability Management Sequence ([PNG](US-011/US-011-platform-availability-sequence.png), [source](US-011/US-011-platform-availability-sequence.mmd))<br>LFT Lifecycle State ([PNG](US-011/US-011-looking-for-team-lifecycle-state.png), [source](US-011/US-011-looking-for-team-lifecycle-state.mmd))<br>Focused Availability Storage ERD ([PNG](US-011/US-011-availability-storage-erd.png), [source](US-011/US-011-availability-storage-erd.mmd)) |
| **US-012 — Create and Manage a Team Recruitment Listing** | Partial (repository-audited) | Event-Free Team Creation Sequence ([PNG](US-012/US-012-team-creation-sequence.png), [source](US-012/US-012-team-creation-sequence.mmd))<br>Owner Management Activity ([PNG](US-012/US-012-team-management-activity.png), [source](US-012/US-012-team-management-activity.mmd))<br>Team Lifecycle State ([PNG](US-012/US-012-team-lifecycle-state.png), [source](US-012/US-012-team-lifecycle-state.mmd)) |
| **US-013 — Browse and Filter Open Team Vacancies** | Partial (repository-audited) | Recruitment Board Sequence ([PNG](US-013/US-013-recruitment-board-sequence.png), [source](US-013/US-013-recruitment-board-sequence.mmd))<br>Visitor/PART Visibility Flow ([PNG](US-013/US-013-visitor-part-visibility-flow.png), [source](US-013/US-013-visitor-part-visibility-flow.mmd)) |
| **US-015 — Candidate Recommendations for Team Leads** | Partial (repository-audited) | Candidate Recommendation Sequence ([PNG](US-015/US-015-candidate-recommendation-sequence.png), [source](US-015/US-015-candidate-recommendation-sequence.mmd))<br>Eligibility and Scoring Flow ([PNG](US-015/US-015-eligibility-scoring-flow.png), [source](US-015/US-015-eligibility-scoring-flow.mmd)) |
| **US-017 — Issue a Team Invitation** | Partial (repository-audited) | Invitation Issuance Sequence ([PNG](US-017/US-017-invitation-issuance-sequence.png), [source](US-017/US-017-invitation-issuance-sequence.mmd))<br>Invitation Lifecycle State ([PNG](US-017/US-017-invitation-lifecycle-state.png), [source](US-017/US-017-invitation-lifecycle-state.mmd)) |
| **US-018 — Apply to Join a Team Vacancy** | Partial (repository-audited) | Application Submission Sequence ([PNG](US-018/US-018-application-submission-sequence.png), [source](US-018/US-018-application-submission-sequence.mmd))<br>Application Lifecycle State ([PNG](US-018/US-018-application-lifecycle-state.png), [source](US-018/US-018-application-lifecycle-state.mmd)) |
| **US-019 — Respond to a Team Invitation** | Partial (repository-audited) | Invitation Response Sequence ([PNG](US-019/US-019-invitation-response-sequence.png), [source](US-019/US-019-invitation-response-sequence.mmd))<br>Placement and Pre-Lock Leave Lifecycle ([PNG](US-019/US-019-placement-and-leave-lifecycle.png), [source](US-019/US-019-placement-and-leave-lifecycle.mmd)) |
| **US-020 — Team Lead Approves or Declines an Application** | Partial (repository-audited) | Application Decision Sequence ([PNG](US-020/US-020-application-decision-sequence.png), [source](US-020/US-020-application-decision-sequence.mmd)) |
| **US-022 — Confirm and Lock a Team Roster** | Partial (repository-audited) | Roster Lock Sequence ([PNG](US-022/US-022-roster-lock-sequence.png), [source](US-022/US-022-roster-lock-sequence.mmd))<br>Post-Lock Mutation Freeze Flow ([PNG](US-022/US-022-post-lock-mutation-freeze-flow.png), [source](US-022/US-022-post-lock-mutation-freeze-flow.mmd)) |
| **US-026 — Administrative Content Moderation and Safety Queue** | Partial (repository-audited) | Moderation Workflow Sequence ([PNG](US-026/US-026-moderation-workflow-sequence.png), [source](US-026/US-026-moderation-workflow-sequence.mmd))<br>Moderation Case Lifecycle Flow ([PNG](US-026/US-026-moderation-case-lifecycle-flow.png), [source](US-026/US-026-moderation-case-lifecycle-flow.mmd)) |
| **US-027 — Administrative Account Management and Enforcement** | Partial (repository-audited) | Account Suspension Sequence ([PNG](US-027/US-027-account-suspension-sequence.png), [source](US-027/US-027-account-suspension-sequence.mmd))<br>Verified Account Deletion Sequence ([PNG](US-027/US-027-account-deletion-sequence.png), [source](US-027/US-027-account-deletion-sequence.mmd)) |
| **US-030 — Participant Chat Forums and Messaging** | Planned — specification-grounded | Chat Use Case ([PNG](US-030/US-030-chat-use-case.png), [source](US-030/US-030-chat-use-case.mmd))<br>Core Chat Sequence ([PNG](US-030/US-030-core-chat-sequence.png), [source](US-030/US-030-core-chat-sequence.mmd))<br>Chat Access and Presence Flow ([PNG](US-030/US-030-presence-access-flow.png), [source](US-030/US-030-presence-access-flow.mmd))<br>Planned Chat Data Model ([PNG](US-030/US-030-chat-data-model.png), [source](US-030/US-030-chat-data-model.mmd)) |

### Stories without story-specific diagrams

| Stories | Status | Reason |
|---|---|---|
| US-007, US-014, US-021, US-023, US-024, US-025, US-028 | Post-MVP; diagram audit pending | Outside the current MVP diagram audit. |
| US-016, US-029 | Active future scope; diagram audit pending | Future stories retained without an implementation claim. |
| US-008, US-009, US-010 | Deprecated | Removed by the Event-Free Architecture and intentionally omitted. |

## Important repository-audit notes

These notes preserve the material gaps identified during the diagram audits without repeating each story’s full requirements.

| Story | Key implementation gaps or constraints |
|---|---|
| US-001 | Email action-code handling is split between Firebase client and API paths, so the participant verification flag can diverge from the UI; the documented custom 24-hour token does not match Firebase-managed behavior. |
| US-002 | OAuth sign-in exists, but existing-account linking lacks complete MFA/active-account/revocation checks and React integration; provider provisioning is not fully atomic. |
| US-003 | Secure cookie sessions are optional while the React path normally uses Firebase bearer tokens; several documented lifetime, lockout, and logout-scope details differ. |
| US-004 | Six-digit OTP, 10-minute expiry, and fifth-failure lock behavior exist; fresh primary-auth enforcement after lock and transactional resend invalidation remain gaps. |
| US-005 | The core Firebase recovery flow is implemented. Firebase controls reset expiry; used-code classification is process-local, and post-reset claim cleanup/revocation steps can partially succeed. |
| US-006 | Some public/owner profile projections expose internal participant IDs beyond the intended privacy model; multi-table profile replacement is not transactional. |
| US-011 | Platform-wide LFT uses an internal compatibility event row, but some UI copy remains event-oriented and candidate output exposes internal IDs. |
| US-012 | The main creation path is Event-Free, but legacy paths still accept/require `eventId`; shadow-event creation, initial vacancies, and LFT restoration have atomicity/scoping gaps. |
| US-013 | Server projections enforce visitor/PART privacy, but shadow-event lifecycle filtering, a 200-row prefilter, and missing public browse rate limiting can affect results. |
| US-015 | Platform-wide recommendation behavior is mostly present, but repository-failure fallback uses event-wide membership exclusion and responses expose internal participant IDs. |
| US-017 | Event-Free client/API inputs and 48-hour/quota behavior exist; SQL still applies shadow-event membership/lifecycle rules and some DTO/UI paths expose event or internal IDs. |
| US-018 | Express checks use a platform-wide cap and target-team membership, while the atomic RPC still uses per-event quota/membership/lifecycle rules; mocked and live-database expectations conflict. |
| US-019 | Atomic response/leave flows exist, but SQL still uses shadow-event membership, capacity, lifecycle, and cleanup rules; LFT clearing differs from US-020. |
| US-020 | Atomic decision/idempotency behavior exists, but approval still uses shadow-event membership/capacity/lifecycle and can clear the wrong LFT compatibility row. |
| US-022 | Lock/freeze behavior exists, but SQL uses event bounds/status and per-event membership rather than fixed 2–4 target-team rules; one focused client accessibility test was failing at audit time. |
| US-026 | ADMIN moderation exists, but mutation and audit writes are sequential rather than atomic; URL disablement may touch a shadow event and action records lack a direct case relationship. |
| US-027 | Suspension and verified deletion exist; unsuspension is not implemented, Firebase/PostgreSQL/audit steps are non-atomic, and moderation “Hidden” is reused for account state. |

Focused audits for US-013, US-015, US-017–US-022, US-026, and US-027 could not validate live Supabase transactions in the audit environment; several integration suites use mocks. Treat their diagrams as explanations of inspected code and intended invariants, not proof of a deployed database state.

### US-030 scope, evidence, and ambiguities

US-030 is **Planned — specification-grounded**: the committed story, FRs, and tasks support the designs, but no chat/presence migrations, API routes, UI, or implementation tests were found.

- **Current MVP:** FR-086 explicit participant presence (`Online`, `Idle`, `Do Not Disturb`, `Invisible`); FR-087 forum/channel listing and creation with required title/description and retained invalid drafts; FR-088 authorized-channel message reading/sending with handle, UTC timestamp, content, UI states, and retained failed drafts; FR-089 server-enforced privacy and denial for visitors, unverified participants, and suspended participants.
- **Deferred:** FR-090 team-scoped channels, FR-091 direct messaging, and FR-092 moderation/reporting hooks are Should-Have/next-sprint scope; FR-093 reactions, typing indicators, attachments, and voice/video are May-Have/future scope.
- **Specification ambiguities:** the MVP does not define channel-membership persistence or join/leave rules, the permitted peer audience for presence, automatic presence transitions, endpoint/DTO/error contracts, or channel ordering. The diagrams do not invent these rules.
- **Data model:** the focused data diagram is explicitly conceptual/planned. It uses existing participant identity plus only the specified presence, channel, and message concepts; it does not invent a channel-membership table or deferred feature entities.
- **Acceptance-test traceability:** US-030-T1 through US-030-T6 cover presence persistence, channel creation, safe message display, access denial, validation/draft retention, and exclusion of password, OTP, and email fields.
- **Evidence:** reusable authentication/active-account guards exist, but no US-030 application tests or live database implementation exist. The four Mermaid diagrams were syntax-rendered and visually inspected when created.

## Rendering guidance

Render every `.mmd` to a same-basename `.png` with the established Mermaid CLI workflow and a white background. Temporary tooling is acceptable, but diagram rendering must not add application dependencies or alter lockfiles. Validate Mermaid syntax, open the PNG, and check titles, legibility, clipping, overlaps, connectors, Event-Free terminology, and sensitive-data exclusion. The retained shared ERD is the sole PNG without a matching Mermaid source.
