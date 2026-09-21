# Functional and Non-Functional Requirements Document

## Overview

This document specifies the authoritative functional and non-functional engineering requirements for **HackMatch**. While [`docs/02_user_stories/user_stories.md`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md) articulates capabilities from user perspectives and [`docs/03_mvp/mvp_definition.md`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/03_mvp/mvp_definition.md) establishes delivery phases, this specification translates those artifacts into concrete, measurable system behaviors, technical constraints, and testable contracts.

Every requirement is assigned a persistent identifier (`FR-XXX` for Functional Requirements, `NR-XXX` for Non-Functional Requirements) and linked directly to upstream user stories (`US-XXX`) to ensure end-to-end traceability across design, development, and quality assurance.

---

## Functional Requirements

Functional requirements define the specific operational behaviors, data mutations, and business rules enforced by the HackMatch software system.

### Feature Area 1: Authentication & User Profiles

Core identity, authorization, credential management, and participant profile data persistence.

| ID | Requirement | Related User Stories | Acceptance Conditions |
|---|---|---|---|
| **FR-001** | The system shall register new user accounts with mandatory cryptographic email verification. | [`US-001`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-001) | Generates a 256-bit secure URL token expiring in 24 hours. Accounts remain in `Unverified` state and cannot create teams or issue invites until verified. |
| **FR-002** | The system shall authenticate user credentials and issue secure session tokens. | [`US-002`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-002) | Emits signed HTTP-only cookies/JWTs. Enforces rate-limiting: locks authentication after 5 failed attempts per IP for 15 minutes. |
| **FR-003** | The system shall provide secure self-serve password recovery. | [`US-002`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-002) | Dispatches a single-use reset token valid for 60 minutes. Invalidates all existing active sessions upon successful password update. |
| **FR-004** | The system shall manage structured participant profiles containing technical, design, and academic attributes. | [`US-003`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-003) | Enforces schema validation on: Primary Roles (`Frontend`, `Backend`, `Mobile`, `AI/ML`, `UI/UX`, `Pitch`), Experience Tier (`Beginner`, `Intermediate`, `Veteran`), verified GitHub/LinkedIn URLs, and standardized skill tags. |
| **FR-005** | The system shall enforce data privacy boundaries on public profile endpoints. | [`US-003`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-003) | Redacts email addresses, system IDs, and private audit logs from public/guest API views. Displays public handles and verified links only. |

---

### Feature Area 2: Hackathon Directory & Event Management

Centralized event directory, event lifecycle state transitions, and organizer submission controls.

| ID | Requirement | Related User Stories | Acceptance Conditions |
|---|---|---|---|
| **FR-006** | The system shall provide a multi-parameter search and filter engine for upcoming hackathons. | [`US-004`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-004) | Filters events by: Event Format (`In-Person`, `Hybrid`, `Virtual`), Status (`Upcoming`, `Ongoing`, `Concluded`), and keyword match on title/host/city. |
| **FR-007** | The system shall enforce event metadata schema and asset constraints on organizer submissions. | [`US-005`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-005) | Validates that Start Date is in the future, End Date >= Start Date, Max Team Size is between 2 and 6, and uploaded banner image is JPEG/PNG/WebP <= 2MB. |
| **FR-008** | The system shall manage an administrative event verification workflow. | [`US-006`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-006) | Organizers submissions enter `Pending Verification` status. Only an administrator can transition status to `Published`, rendering the event visible in the public directory. |

---

### Feature Area 3: Team Recruitment & Looking-for-Team Boards

Event-scoped participant availability tracking and team vacancy management.

| ID | Requirement | Related User Stories | Acceptance Conditions |
|---|---|---|---|
| **FR-009** | The system shall manage event-scoped participant availability flags. | [`US-007`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-007) | Allows participants to toggle *"Looking for Team"* per hackathon, capturing desired event role, goal (`Casual`, `Learning`, `Competitive`), and commitment hours. |
| **FR-010** | The system shall publish structured team recruitment listings with discrete skill vacancy slots. | [`US-008`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-008) | Captain creates a team record specifying Team Name, Project Pitch (max 500 chars), Team Goal, and up to `MaxTeamSize - 1` unfilled slots with required skill tags. |
| **FR-011** | The system shall filter and display open team recruitment posts. | [`US-009`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-009) | Displays teams with unfilled vacancies; allows filtering by required skill tags, team size, and competitive goal. Displays remaining open slot count. |
| **FR-012** | The system shall synchronize participant availability states upon team assignment. | [`US-007`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-007), [`US-014`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-014) | When a user joins a team for Hackathon X, their *"Looking for Team"* flag for Hackathon X is automatically cleared and removed from public available participant boards. |

---

### Feature Area 4: Rule-Based Matching & Teammate Recommendations

Deterministic matching algorithm computing compatibility scores between vacancies and candidate profiles.

| ID | Requirement | Related User Stories | Acceptance Conditions |
|---|---|---|---|
| **FR-013** | The system shall compute a deterministic match compatibility score between open team slots and solo participants. | [`US-010`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-010) | Computes a composite score (0–100%) weighted as: `(Skill Overlap * 0.40) + (Goal Alignment * 0.30) + (Schedule Compatibility * 0.30)`. |
| **FR-014** | The system shall surface ranked candidate recommendations to team captains. | [`US-010`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-010) | Ranks candidates in descending order of match score. Excludes candidates already assigned to a confirmed team for that hackathon. Displays matching skill pills. |
| **FR-015** | The system shall compute inverse team recommendations for solo participants. | [`US-011`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-011) | Matches a participant's declared skills against unfilled team vacancy requirements for a selected hackathon, displaying affinity percentage and matched slot titles. |

---

### Feature Area 5: Invitations, Applications & Roster Management

State-machine management for team invitations, applications, concurrency control, and roster finalization.

| ID | Requirement | Related User Stories | Acceptance Conditions |
|---|---|---|---|
| **FR-016** | The system shall issue direct team invitations from captains to candidates. | [`US-012`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-012) | Creates an invitation record in `Pending` state. Prevents dispatch if team has zero open slots. Capped at 1 active invite per candidate per team. |
| **FR-017** | The system shall enforce a strict time-to-live (TTL) on pending team invitations. | [`US-012`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-012) | Invitations automatically transition from `Pending` to `Expired` exactly 48 hours after creation if no action is taken. |
| **FR-018** | The system shall allow solo participants to submit join applications to open team slots. | [`US-013`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-013) | Creates an application record in `Pending Review` state. Restricts each participant to a maximum of 3 concurrent active applications per hackathon. |
| **FR-019** | The system shall resolve race conditions and capacity saturation upon invitation/application acceptance. | [`US-014`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-014) | Executed within an atomic database transaction: when a team reaches maximum capacity, all remaining pending invitations and incoming applications are automatically set to `Canceled / Team Full`. |
| **FR-020** | The system shall lock confirmed rosters and generate exportable team manifests. | [`US-015`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-015) | Captain locks roster (requires >= 2 members). Transitions state to `Confirmed / Locked`, disabling further membership mutations. Generates JSON and CSV manifest containing member names, emails, GitHub handles, and assigned roles. |

---

### Feature Area 6: Moderation, Platform Governance & Trust

Reporting workflows, content remediation, suspension controls, and administrative audit trails.

| ID | Requirement | Related User Stories | Acceptance Conditions |
|---|---|---|---|
| **FR-021** | The system shall allow authenticated users to report abusive content or fraudulent profiles. | [`US-016`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-016) | Modal captures category (`Spam`, `Harassment`, `Inappropriate`, `Fraud`) and text rationale. Rate-limited to 5 reports per user per hour. |
| **FR-022** | The system shall provide an administrative moderation queue with actionable disciplinary controls. | [`US-017`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-017) | Displays flagged reports sorted by severity. Provides actions: `Dismiss`, `Edit/Redact Content`, `Warn User`, and `Suspend Account`. |
| **FR-023** | The system shall purge suspended users and listings from active search indices. | [`US-017`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-017) | Account suspension immediately revokes auth tokens, hides profile from directories, and cancels all active team memberships and listings. |
| **FR-024** | The system shall maintain an immutable administrative audit log. | [`US-006`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-006), [`US-017`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-017) | Records Admin ID, Action Type, Target Entity ID, Prior State, New State, and UTC Timestamp for all moderation and event approvals. |

---

## Non-Functional Requirements

Non-functional requirements specify quality attributes, service level objectives (SLOs), security benchmarks, and operational constraints.

### Performance

Targets governing latency, processing throughput, and resource limits under active load.

| ID | Requirement | Related User Stories | Measurable Criteria |
|---|---|---|---|
| **NR-001** | Public directory page load and initial render latency. | [`US-004`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-004), [`US-009`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-009) | Initial page load (First Contentful Paint) < 1.5 seconds; Time to Interactive < 2.5 seconds on simulated 4G mobile networks. |
| **NR-002** | Rule-based teammate recommendation engine execution latency. | [`US-010`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-010), [`US-011`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-011) | Computing and ranking compatibility scores for up to 500 active event candidates must execute in < 300 ms (p95). |
| **NR-003** | Core database query execution efficiency. | All | Primary search, filter, and profile retrieval SQL queries must execute in < 100 ms (p95) for tables with up to 100,000 records using appropriate B-tree indices. |

---

### Security

Controls enforcing cryptography, access barriers, authentication safeguards, and data protection.

| ID | Requirement | Related User Stories | Measurable Criteria |
|---|---|---|---|
| **NR-004** | Cryptographic password storage standards. | [`US-001`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-001), [`US-002`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-002) | All passwords must be hashed using `bcrypt` with a minimum cost factor of 12 (or `Argon2id` with equivalent memory/time hardness). |
| **NR-005** | Encryption in transit and at rest. | All | All client-server communications must strictly enforce TLS 1.3 (TLS 1.2 minimum). Sensitive relational data and database backups must be encrypted at rest using AES-256. |
| **NR-006** | Session security and token lifecycle. | [`US-002`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-002) | JWT access tokens expire after 15 minutes; refresh tokens expire after 7 days and must be stored in HTTP-only, `SameSite=Strict`, `Secure` cookies. |
| **NR-007** | Protection against OWASP Top 10 web vulnerabilities. | All | Zero SQL injection vulnerabilities via parameterized ORM queries; all user markdown and input sanitized via HTML DOMPurify to eliminate Cross-Site Scripting (XSS). |

---

### Scalability

System capacity to absorb growing user bases and burst traffic during hackathon registration cycles.

| ID | Requirement | Related User Stories | Measurable Criteria |
|---|---|---|---|
| **NR-008** | Concurrent user capacity during peak event formation. | [`US-004`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-004), [`US-008`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-008), [`US-010`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-010) | Architecture must sustain at least 5,000 concurrent active users without degradation in response time or connection dropping. |
| **NR-009** | Database scaling under increasing record volume. | [`US-003`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-003), [`US-008`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-008) | Database must maintain linear query performance for datasets of up to 50,000 participant profiles and 10,000 team listings. |
| **NR-010** | API throughput capacity at peak recruitment window. | [`US-012`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-012), [`US-014`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-014) | System must process at least 500 requests per second (RPS) across recruitment and notification endpoints at peak load. |

---

### Reliability and Availability

Operational resilience, uptime guarantees, and disaster recovery objectives.

| ID | Requirement | Related User Stories | Measurable Criteria |
|---|---|---|---|
| **NR-011** | System availability during hackathon season. | All | Platform must maintain 99.9% uptime during peak collegiate hackathon season (September–November and January–March), allowing < 43 minutes of unscheduled downtime per month. |
| **NR-012** | Database backup schedule and disaster recovery objectives. | All | Automated automated daily snapshots and hourly WAL incremental backups; Recovery Point Objective (RPO) < 1 hour, Recovery Time Objective (RTO) < 30 minutes. |
| **NR-013** | Fault tolerance and graceful service degradation. | [`US-010`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-010) | If the match recommendation engine encounters an internal timeout (> 2 sec), the system must gracefully fall back to standard chronological candidate search without failing the HTTP request. |

---

### Usability

User interface ergonomics, accessibility mandates, and browser interoperability.

| ID | Requirement | Related User Stories | Measurable Criteria |
|---|---|---|---|
| **NR-014** | Web accessibility compliance. | All | 100% of user-facing web views must comply with WCAG 2.1 Level AA standards (including keyboard navigability, high-contrast text ratios >= 4.5:1, and ARIA labels on dynamic modals). |
| **NR-015** | Cross-browser compatibility. | All | Web client must render and operate flawlessly on the latest 2 major versions of Google Chrome, Mozilla Firefox, Apple Safari, and Microsoft Edge. |
| **NR-016** | Responsive mobile viewport adaptation. | All | Layout must dynamically adapt across standard viewports from mobile (360px width) up to ultra-wide desktop (2560px width) without horizontal overflow or clipped navigation. |

---

### Maintainability and Supportability

Code engineering quality, telemetry instrumentation, and diagnostic monitoring.

| ID | Requirement | Related User Stories | Measurable Criteria |
|---|---|---|---|
| **NR-017** | Automated test suite coverage. | All | Backend business logic and matching algorithms must maintain >= 80% automated unit and integration test branch coverage prior to release merging. |
| **NR-018** | Structured application logging and error context. | All | All application errors must emit structured JSON logs containing: Request ID, User ID (if authenticated), Endpoint, Exception Stack Trace, and Timestamp. |
| **NR-019** | System health check and telemetry exposure. | All | API must expose a `/health` endpoint reporting database connectivity and memory status; system metrics exported in Prometheus format. |

---

### Compliance and Legal

Student data privacy, regulatory compliance, and fair data use policies.

| ID | Requirement | Related User Stories | Measurable Criteria |
|---|---|---|---|
| **NR-020** | Student data privacy and right-to-be-forgotten. | [`US-001`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-001), [`US-003`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-003) | System must comply with Canadian PIPEDA and GDPR standards: user account deletion requests must purge all personally identifiable information within 30 days. |
| **NR-021** | Anti-scraping defenses against unauthorized talent harvesting. | [`US-004`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-004), [`US-007`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-007) | Public directory endpoints enforce strict IP-based rate limiting (maximum 60 requests per minute per IP) and block known commercial scraper user-agents. |
