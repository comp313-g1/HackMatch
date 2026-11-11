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
| Diagrammed User Stories | 28 |
| Mermaid sources | 74 |
| Matching rendered diagram PNGs | 74 |
| Shared reference images | 1 |
| Total PNG files | 75 |

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
| **US-014 — Advanced Candidate Directory Search and Filter for Team Leads** | Implemented (repository-audited) | Event-Free Candidate Directory Sequence ([PNG](US-014/US-014-candidate-directory-sequence.png), [source](US-014/US-014-candidate-directory-sequence.mmd))<br>Candidate Eligibility and Privacy Filter Flow ([PNG](US-014/US-014-candidate-eligibility-filter-flow.png), [source](US-014/US-014-candidate-eligibility-filter-flow.mmd)) |
| **US-015 — Candidate Recommendations for Team Leads** | Partial (repository-audited) | Candidate Recommendation Sequence ([PNG](US-015/US-015-candidate-recommendation-sequence.png), [source](US-015/US-015-candidate-recommendation-sequence.mmd))<br>Eligibility and Scoring Flow ([PNG](US-015/US-015-eligibility-scoring-flow.png), [source](US-015/US-015-eligibility-scoring-flow.mmd)) |
| **US-017 — Issue a Team Invitation** | Partial (repository-audited) | Invitation Issuance Sequence ([PNG](US-017/US-017-invitation-issuance-sequence.png), [source](US-017/US-017-invitation-issuance-sequence.mmd))<br>Invitation Lifecycle State ([PNG](US-017/US-017-invitation-lifecycle-state.png), [source](US-017/US-017-invitation-lifecycle-state.mmd)) |
| **US-018 — Apply to Join a Team Vacancy** | Partial (repository-audited) | Application Submission Sequence ([PNG](US-018/US-018-application-submission-sequence.png), [source](US-018/US-018-application-submission-sequence.mmd))<br>Application Lifecycle State ([PNG](US-018/US-018-application-lifecycle-state.png), [source](US-018/US-018-application-lifecycle-state.mmd)) |
| **US-019 — Respond to a Team Invitation** | Partial (repository-audited) | Invitation Response Sequence ([PNG](US-019/US-019-invitation-response-sequence.png), [source](US-019/US-019-invitation-response-sequence.mmd))<br>Placement and Pre-Lock Leave Lifecycle ([PNG](US-019/US-019-placement-and-leave-lifecycle.png), [source](US-019/US-019-placement-and-leave-lifecycle.mmd)) |
| **US-020 — Team Lead Approves or Declines an Application** | Partial (repository-audited) | Application Decision Sequence ([PNG](US-020/US-020-application-decision-sequence.png), [source](US-020/US-020-application-decision-sequence.mmd)) |
| **US-021 — In-App Notification Center and Real-Time Recruitment Alerts** | Implemented (repository-audited) | Notification Persistence, Delivery, and Read Sequence ([PNG](US-021/US-021-notification-delivery-sequence.png), [source](US-021/US-021-notification-delivery-sequence.mmd))<br>Notification Authorization and Read-State Flow ([PNG](US-021/US-021-notification-access-read-flow.png), [source](US-021/US-021-notification-access-read-flow.mmd))<br>Focused Notification Data Model ([PNG](US-021/US-021-notification-data-model.png), [source](US-021/US-021-notification-data-model.mmd)) |
| **US-022 — Confirm and Lock a Team Roster** | Partial (repository-audited) | Roster Lock Sequence ([PNG](US-022/US-022-roster-lock-sequence.png), [source](US-022/US-022-roster-lock-sequence.mmd))<br>Post-Lock Mutation Freeze Flow ([PNG](US-022/US-022-post-lock-mutation-freeze-flow.png), [source](US-022/US-022-post-lock-mutation-freeze-flow.mmd)) |
| **US-023 — Team Private Coordination Workspace** | Implemented (repository-audited) | Private Workspace Sequence ([PNG](US-023/US-023-private-workspace-sequence.png), [source](US-023/US-023-private-workspace-sequence.mmd))<br>Private Workspace Authorization Flow ([PNG](US-023/US-023-private-workspace-access-flow.png), [source](US-023/US-023-private-workspace-access-flow.mmd))<br>Focused Workspace Data Model ([PNG](US-023/US-023-private-workspace-data-model.png), [source](US-023/US-023-private-workspace-data-model.mmd)) |
| **US-024 — Export Team Manifest and Check-In Verification Card** | Implemented (repository-audited) | Locked Team Manifest Export Sequence ([PNG](US-024/US-024-team-manifest-export-sequence.png), [source](US-024/US-024-team-manifest-export-sequence.mmd))<br>Manifest Authorization and Integrity Flow ([PNG](US-024/US-024-team-manifest-integrity-flow.png), [source](US-024/US-024-team-manifest-integrity-flow.mmd))<br>Team Manifest Persistence Model ([PNG](US-024/US-024-team-manifest-data-model.png), [source](US-024/US-024-team-manifest-data-model.mmd)) |
| **US-025 — User Reporting Modal for Abusive Content and Malicious Links** | Implemented (repository-audited) | Participant Report Submission Sequence ([PNG](US-025/US-025-participant-report-sequence.png), [source](US-025/US-025-participant-report-sequence.mmd))<br>Reporting Authorization, Validation, and Privacy Flow ([PNG](US-025/US-025-participant-report-access-flow.png), [source](US-025/US-025-participant-report-access-flow.mmd))<br>Participant Report and Moderation Case Model ([PNG](US-025/US-025-participant-report-data-model.png), [source](US-025/US-025-participant-report-data-model.mmd)) |
| **US-026 — Administrative Content Moderation and Safety Queue** | Partial (repository-audited) | Moderation Workflow Sequence ([PNG](US-026/US-026-moderation-workflow-sequence.png), [source](US-026/US-026-moderation-workflow-sequence.mmd))<br>Moderation Case Lifecycle Flow ([PNG](US-026/US-026-moderation-case-lifecycle-flow.png), [source](US-026/US-026-moderation-case-lifecycle-flow.mmd)) |
| **US-027 — Administrative Account Management and Enforcement** | Partial (repository-audited) | Account Suspension Sequence ([PNG](US-027/US-027-account-suspension-sequence.png), [source](US-027/US-027-account-suspension-sequence.mmd))<br>Verified Account Deletion Sequence ([PNG](US-027/US-027-account-deletion-sequence.png), [source](US-027/US-027-account-deletion-sequence.mmd)) |
| **US-028 — Administrative Audit Review and Filtering** | Implemented (repository-audited) | ADMIN Audit Review Sequence ([PNG](US-028/US-028-audit-review-sequence.png), [source](US-028/US-028-audit-review-sequence.mmd))<br>Audit Authorization, Filtering, and State Flow ([PNG](US-028/US-028-audit-access-filter-flow.png), [source](US-028/US-028-audit-access-filter-flow.mmd))<br>Append-Only Audit Record Query Model ([PNG](US-028/US-028-audit-record-data-model.png), [source](US-028/US-028-audit-record-data-model.mmd)) |
| **US-030 — Participant Chat Forums and Messaging** | Planned — specification-grounded | Chat Use Case ([PNG](US-030/US-030-chat-use-case.png), [source](US-030/US-030-chat-use-case.mmd))<br>Core Chat Sequence ([PNG](US-030/US-030-core-chat-sequence.png), [source](US-030/US-030-core-chat-sequence.mmd))<br>Chat Access and Presence Flow ([PNG](US-030/US-030-presence-access-flow.png), [source](US-030/US-030-presence-access-flow.mmd))<br>Planned Chat Data Model ([PNG](US-030/US-030-chat-data-model.png), [source](US-030/US-030-chat-data-model.mmd)) |
| **US-031 — Private Team Chat Channel for Confirmed Team Members** | Implemented (repository-audited) | Private Team Chat Use Case ([PNG](US-031/US-031-private-team-chat-use-case.png), [source](US-031/US-031-private-team-chat-use-case.mmd))<br>Private Team Chat Sequence ([PNG](US-031/US-031-private-team-chat-sequence.png), [source](US-031/US-031-private-team-chat-sequence.mmd))<br>Authorization and Privacy Flow ([PNG](US-031/US-031-team-chat-authorization-flow.png), [source](US-031/US-031-team-chat-authorization-flow.mmd))<br>Focused Team Chat Data Model ([PNG](US-031/US-031-team-chat-data-model.png), [source](US-031/US-031-team-chat-data-model.mmd))<br>History and Lifecycle Flow ([PNG](US-031/US-031-team-chat-lifecycle-flow.png), [source](US-031/US-031-team-chat-lifecycle-flow.mmd)) |
| **US-032 — Private Direct Messaging Between Participants** | Partial (repository-audited) | Focused Direct Message Data Model ([PNG](US-032/US-032-direct-message-data-model.png), [source](US-032/US-032-direct-message-data-model.mmd))<br>Direct Message Sequence ([PNG](US-032/US-032-direct-message-sequence.png), [source](US-032/US-032-direct-message-sequence.mmd))<br>Access and Privacy Flow ([PNG](US-032/US-032-direct-message-access-flow.png), [source](US-032/US-032-direct-message-access-flow.mmd)) |
| **US-033 — Chat Moderation and Reporting Hooks** | Implemented (repository-audited) | Chat Moderation Use Case ([PNG](US-033/US-033-chat-moderation-use-case.png), [source](US-033/US-033-chat-moderation-use-case.mmd))<br>Report, Review, and Action Sequence ([PNG](US-033/US-033-chat-moderation-sequence.png), [source](US-033/US-033-chat-moderation-sequence.mmd))<br>Polymorphic Moderation Target Model ([PNG](US-033/US-033-moderation-target-model.png), [source](US-033/US-033-moderation-target-model.mmd))<br>Authorization and Privacy Flow ([PNG](US-033/US-033-moderation-privacy-flow.png), [source](US-033/US-033-moderation-privacy-flow.mmd)) |
| **US-034 — Chat Unread and Mention Badges** | Implemented (repository-audited) | Chat Activity and Badge Flow ([PNG](US-034/US-034-chat-activity-badge-flow.png), [source](US-034/US-034-chat-activity-badge-flow.mmd))<br>Unread Loading and Mark-Read Sequence ([PNG](US-034/US-034-unread-mark-read-sequence.png), [source](US-034/US-034-unread-mark-read-sequence.mmd))<br>Read Cursor and Mention Persistence Model ([PNG](US-034/US-034-read-cursor-mention-data-model.png), [source](US-034/US-034-read-cursor-mention-data-model.mmd))<br>Atomic Monotonic Mark-Read Flow ([PNG](US-034/US-034-atomic-mark-read-flow.png), [source](US-034/US-034-atomic-mark-read-flow.mmd)) |

### Stories without story-specific diagrams

| Stories | Status | Reason |
|---|---|---|
| US-007 | Post-MVP / out of #426 scope | No current implementation diagram was required; it remains intentionally undiagrammed. |
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
| US-014 | The current candidate directory is Event-Free and team-owner scoped. Older story language remains event-oriented, while backend event state is retained only as internal compatibility context. |
| US-015 | Platform-wide recommendation behavior is mostly present, but repository-failure fallback uses event-wide membership exclusion and responses expose internal participant IDs. |
| US-017 | Event-Free client/API inputs and 48-hour/quota behavior exist; SQL still applies shadow-event membership/lifecycle rules and some DTO/UI paths expose event or internal IDs. |
| US-018 | Express checks use a platform-wide cap and target-team membership, while the atomic RPC still uses per-event quota/membership/lifecycle rules; mocked and live-database expectations conflict. |
| US-019 | Atomic response/leave flows exist, but SQL still uses shadow-event membership, capacity, lifecycle, and cleanup rules; LFT clearing differs from US-020. |
| US-020 | Atomic decision/idempotency behavior exists, but approval still uses shadow-event membership/capacity/lifecycle and can clear the wrong LFT compatibility row. |
| US-021 | Participant-owned notification persistence, retrieval, SSE delivery, and idempotent read operations are implemented. Its `read_at` state is separate from the later US-034 chat read-cursor tables. |
| US-022 | Lock/freeze behavior exists, but SQL uses event bounds/status and per-event membership rather than fixed 2–4 target-team rules; one focused client accessibility test was failing at audit time. |
| US-023 | The private workspace is limited to current Confirmed team members and uses privacy-safe projections; visitors, unrelated participants, former members, and unrelated ADMIN users receive no workspace data. |
| US-024 | Locked-team manifests use canonical privacy-projected snapshots and SHA-256 integrity comparison. Stored event data is compatibility/record context, not a participant-facing event workflow or organizer approval. |
| US-025 | The original participant UI reports eligible team, profile, event, or URL targets into the US-026 pipeline. US-033 later adds `chat_message`; that extension is deliberately not presented as original US-025 scope. |
| US-026 | ADMIN moderation exists, but mutation and audit writes are sequential rather than atomic; URL disablement may touch a shadow event and action records lack a direct case relationship. |
| US-027 | Suspension and verified deletion exist; unsuspension is not implemented, Firebase/PostgreSQL/audit steps are non-atomic, and moderation “Hidden” is reused for account state. |
| US-028 | Event, moderation, and account actions share the append-only `event_action_records` table and are categorized from `action_type`; the ADMIN query path is read-only, filtered, keyset-paged, and privacy-scrubbed. |
| US-031 | One immutable private channel is linked per team; only verified active PART users with current Confirmed membership receive access. Open and Locked teams remain writable, Disbanded channels are read-only history, former members lose access, unrelated ADMIN users have no bypass, and safe projections prevent private-field leakage. |
| US-032 | Canonical low/high participant pairs, one thread per pair, participant-only reads, block/eligibility-aware sends, safe projections, and the React inbox/thread/composer are implemented. The broader #391 access/validation suite remains pending; the client message type still names legacy `authorId` while the #390 server projection returns `fromMe`, although the current UI renders neither field. |
| US-033 | US-026 moderation now accepts polymorphic `chat_channel` and `chat_message` targets without physical chat foreign keys. Eligible PART users can report only visible `chat_messages`; direct-message rows are outside the current target contract. ADMIN detail uses bounded, redacted evidence projections, stale targets remain safely reviewable, and chat cases currently support dismissal only with a safe append-only action record. |
| US-034 | Channel/team and DM cursors use separate FK-safe tables and deterministic `(created_at, message id)` positions. Mention rows store stable participant IDs, counts are authorized and content-free, mark-read is atomic/monotonic, and React badges refresh on load and relevant actions without adding realtime delivery or constant polling. |

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
