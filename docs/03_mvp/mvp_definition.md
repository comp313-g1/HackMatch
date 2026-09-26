# MVP Definition

## Overview

This document defines the Minimum Viable Product (MVP) scope, MoSCoW prioritization, and implementation roadmap for **HackMatch**. The MVP represents the most cohesive, high-impact subset of capabilities that solves the core problem articulated in [`docs/00_starter_pack/HackMatch_Project_Proposal.md`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/00_starter_pack/HackMatch_Project_Proposal.md): eliminating chaotic, last-minute hackathon team formation by connecting students based on complementary skills, availability, and goals.

Using the MoSCoW framework, this specification categorizes all twenty-nine user stories from [`docs/02_user_stories/user_stories.md`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md) into delivery tiers. The initial release package encompasses twenty-seven tightly coupled user stories structured across four implementation phases, providing sufficient technical depth and balanced ownership for a 6-person engineering team while strictly excluding non-core distractions like in-app chat or public discussion forums.

---

## User Story Categorization (MoSCoW)

### Must-Haves (Core MVP Engine)

Must-Haves represent the non-negotiable operational core of HackMatch. Without these capabilities, participants cannot securely authenticate, discover hackathons, declare availability, publish open team vacancy slots, receive rule-based match recommendations, or finalize confirmed rosters.

| User Story | Justification |
|---|---|
| [`US-001: Participant Registration & Email Verification`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-001) | Foundational identity barrier; required to verify student email ownership, prevent bot spam, and establish a secure baseline for participant accounts. |
| [`US-002: Federated OAuth Registration & Authentication`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-002) | Essential developer onboarding primitive mandated by stakeholders; provides single-click sign-in via Google and GitHub OAuth to eliminate registration friction. |
| [`US-003: User Login & Session Management`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-003) | Fundamental session security; enforces credential verification, rate-limiting, and JWT/refresh token lifecycles with HTTP-only cookie storage. |
| [`US-004: Login Multi-Factor Authentication (MFA)`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-004) | Non-negotiable security requirement mandated by stakeholder review; enforces secondary email-based OTP verification on recurring logins to protect against credential stuffing. |
| [`US-005: Password Recovery for PART/ADMIN`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-005) | Essential account maintenance; provides cryptographic single-use reset links to prevent user lockout without compromising multi-factor security. |
| [`US-006: Participant Profile Management`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-006) | Core data asset; captures standardized technical roles, skill tags, academic institution, and portfolio URLs necessary to power the recommendation engine. |
| [`US-008: Public Hackathon Discovery & Multi-Filter Search`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-008) | Essential top-of-funnel discovery; anchors team formation to specific hackathons with external website links, format filters, and verified event badges. |
| [`US-009: Team Lead Crowdsourced Event Registration Request`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-009) | Core scalability mechanism; allows Team Leads to submit unlisted hackathons on the fly and begin recruiting immediately under optimistic `Pending Verification` status. |
| [`US-010: Administrative Event Verification, Correction, and Lifecycle Management`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-010) | Single source of truth gatekeeper; allows administrators to audit crowdsourced event URLs, factually correct mismatched team limits/dates, merge duplicates, and approve listings. |
| [`US-011: Declare Event Availability & Looking-for-Team Status`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-011) | Core participation trigger; enables solo students to signal event-specific availability, commitment hours, and competitive goals. |
| [`US-012: Create & Manage Team Recruitment Listing`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-012) | Essential team recruitment capability; enables Team Leads to define discrete vacancy slots, manage project pitches, and exercise self-service editing before roster lock. |
| [`US-013: Browse & Filter Open Team Vacancies`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-013) | Primary solo participant discovery; allows candidates to search open vacancy slots filtered by required skill tags and team objectives. |
| [`US-015: Candidate Recommendations for Team Leads`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-015) | Core market differentiator; computes a deterministic compatibility score ($0\text{--}100\%$) matching candidate skills and availability against open vacancy slot requirements. |
| [`US-017: Issue a Team Invitation`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-017) | Essential interaction primitive; allows Team Leads to convert recommended candidates into potential teammates with a 48-hour time-to-live (TTL). |
| [`US-018: Apply to Join a Team Vacancy`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-018) | Essential bottom-up recruitment primitive; allows solo participants to apply for specific team slots with an introductory note (max 3 concurrent active applications). |
| [`US-019: Respond to a Team Invitation`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-019) | Critical workflow resolution engine; handles acceptance, rejection, capacity limits, and atomic race-condition prevention across concurrent slot filling. |
| [`US-020: Team Lead Approves or Declines an Application`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-020) | Team Lead evaluation gate; enables reviewing applicant profiles and approving members while auto-canceling remaining invites when capacity saturates. |
| [`US-022: Confirm and Lock a Team Roster`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-022) | Milestone completion; enforces team capacity bounds ($2 \le \text{size} \le \text{max}$), permanently freezes membership mutations, and unlocks post-formation tooling. |
| [`US-026: Administrative Content Moderation & Safety Queue`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-026) | Platform safety enforcement; empowers administrators to triage reported listings, redact offensive descriptions, and purge malicious phishing URLs. |
| [`US-027: Administrative Account Management & Enforcement`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-027) | Platform integrity and legal compliance; supports account deactivations for code of conduct violators and handles GDPR/PIPEDA student right-to-be-forgotten purges. |

---

### Should-Haves (Supporting MVP Enhancements)

Should-Haves provide critical operational polish, transparency, and collaboration infrastructure that turn a bare-bones matching demo into an investor-grade, production-quality product. In a 6-person team, these stories distribute workload and guarantee adequate technical depth.

| User Story | Value & Justification |
|---|---|
| [`US-007: Participant Hackathon History & Portfolio Verification`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-007) | Replaces unverifiable claims with an objective track record; tracks past hackathons attended and calculates objective experience tier badges (`Beginner`, `Competitor`, `Veteran`). |
| [`US-014: Advanced Candidate Directory Search & Filter for Team Leads`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-014) | Supplements algorithmic recommendations by giving Team Leads manual multi-tag filter tools across declared skills, experience tiers, and availability. |
| [`US-021: In-App Notification Center & Real-Time Recruitment Alerts`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-021) | Eliminates communication lag; surfaces in-app badge counters and action links for invitations, application approvals, and event verification status changes. |
| [`US-023: Team Private Coordination Workspace`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-023) | Delivers the post-match value proposition; provides a private dashboard for locked teams to access external Discord/Slack channels, GitHub repository links, and shared pitch notes. |
| [`US-024: Export Team Manifest & Check-In Verification Card`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-024) | Bridges the virtual platform to physical hackathon check-in; generates a standardized, printable HTML/PDF card and downloadable JSON roster with pre-event verification hashes. |
| [`US-025: User Reporting Modal for Abusive Content & Malicious Links`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-025) | Provides the crowd-sourced intake channel for the administrative moderation queue (US-026); rate-limited to 5 reports/hour to prevent griefing. |
| [`US-028: Immutable Administrative Audit Logging`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-028) | Ensures governance transparency; records append-only audit entries capturing Admin ID, Target Entity, Prior/New State, and UTC Timestamp for all moderation and verification decisions. |

---

### Could-Haves (Future Scope — Post-Launch v1.1)

Capabilities that enhance convenience and two-sided discovery, formally deferred to subsequent releases to protect MVP release velocity.

| User Story | Value & Post-Launch Timeline |
|---|---|
| [`US-016: Recommended Teams for Participants`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-016) | **v1.1 - Post-Launch.** Reverse matching algorithm pushing recommended teams to solo hackers; in MVP v1.0, solo users discover teams via multi-parameter search and manual filtering (US-013). |
| [`US-029: Authenticator App (TOTP) Multi-Factor Authentication`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-029) | **v1.1 - Post-Launch.** Adds zero-latency, app-based multi-factor authentication (Google Authenticator / Microsoft Authenticator) for security-conscious developers, expanding beyond the baseline email OTP implementation. |

---

### Nice-To-Haves (v1.2+)

Exploratory integrations adding ecosystem automation:
* **US-N01: Automated Discord Webhook & Server Sync:** Auto-provisioning private Discord channels and role assignments upon roster lock.
* **US-N02: GitHub Organization & Repo Scaffolding:** Automated API creation of a shared team GitHub repository pre-configured with template README and gitignore.
* **US-N03: Interactive Time-Zone & Schedule Matrix:** Visual schedule heat-map showing team overlap across conflicting classes and weekend commitments.

---

### Out of Scope (Explicitly Excluded)

Capabilities deliberately barred from the HackMatch product architecture to maintain focus, prevent unmaintainable code bloat, and avoid duplicating existing mature platforms:

| Excluded Capability | Justification |
|---|---|
| **In-App Real-Time Chat (WebSocket Messaging)** | Hackathon students already communicate on Discord and Slack. Building custom in-app chat creates an inferior, unmoderated tool that users immediately abandon. Solved pragmatically by sharing Discord/Slack invite links in the Private Team Workspace ([`US-023`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-023)). |
| **Reddit-Style Public Discussion Forums / Articles** | HackMatch is a purpose-driven matchmaking engine, not a social media aggregator. Discussion threads introduce massive comment moderation overhead without advancing team formation. |
| **Native Audio / Video Calling (WebRTC)** | Video infrastructure introduces immense bandwidth, signaling, and maintenance overhead already solved by Zoom, Google Meet, and Discord. |
| **Full Hackathon Event Management & Project Judging** | Outside the core product domain; platforms like Devpost and Eventbrite already dominate project judging and ticket management. |
| **Mobile Viewports (< 1024px) & Native Mobile Application Builds** | HackMatch is intentionally engineered and scoped as a **Desktop-First Web Application** (optimized for screen resolutions $\ge 1024 \times 768$). Hackathon team leads and developers assemble teams, draft project pitches, and link GitHub repositories on laptops and workstations where development tools, IDEs, and browser developer consoles reside. Optimizing complex candidate filter matrices and split-pane team workspaces for small smartphone screens (360px–390px) and handling touch-based orientation reflow introduces substantial CSS and responsive layout overhead with negligible value during pre-event team formation sprints. Mobile screens display a non-blocking advisory banner recommending a desktop browser, with mobile touch layouts formally deferred to post-capstone releases. |

---

## MVP Release Definition

**Release Baseline:** The HackMatch MVP release package consists of all **Must-Have** (20 stories) and **Should-Have** (7 stories) user stories, totaling **27 operational user stories**. 

**Release Target Date:** November 20, 2026

**Target Release Objective:** Deliver an investor-grade, end-to-end team formation platform enabling student hackers to authenticate securely (Google/GitHub OAuth + MFA), crowdsource verified hackathons, create structured vacancy-based recruitment listings, receive explainable match recommendations, coordinate in private team workspaces, and export verified check-in manifests.

---

## MVP Implementation Plan

The table below sequences all 27 implementation stories across four dependency-ordered development phases. Dependencies are strictly respected: no story is scheduled before its architectural prerequisites are completed.

| Phase | Priority | User Story | Depends On | Primary Owner / Domain |
|---|---|---|---|---|
| **Phase 1: Foundation, Auth & Events** | **1** | [`US-001: Participant Registration & Email Verification`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-001) | None | Identity / Security |
| | **2** | [`US-002: Federated OAuth Registration & Authentication`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-002) | US-001 | Identity / Security |
| | **3** | [`US-003: User Login & Session Management`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-003) | US-001, US-002 | Identity / Security |
| | **4** | [`US-004: Login Multi-Factor Authentication (MFA)`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-004) | US-003 | Identity / Security |
| | **5** | [`US-005: Password Recovery for PART/ADMIN`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-005) | US-001, US-003 | Identity / Security |
| | **6** | [`US-008: Public Hackathon Discovery & Multi-Filter Search`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-008) | None | Directory / Events |
| | **7** | [`US-009: Team Lead Crowdsourced Event Registration Request`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-009) | US-003, US-008 | Directory / Events |
| | **8** | [`US-010: Administrative Event Verification, Correction & Lifecycle`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-010) | US-008, US-009 | Directory / Events |
| **Phase 2: Profiles, Availability & Recruitment** | **9** | [`US-006: Participant Profile Management`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-006) | US-003 | Profiles & Records |
| | **10** | [`US-007: Participant Hackathon History & Portfolio Verification`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-007) | US-006 | Profiles & Records |
| | **11** | [`US-011: Declare Event Availability & Looking-for-Team Status`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-011) | US-006, US-008 | Recruitment Boards |
| | **12** | [`US-012: Create & Manage Team Recruitment Listing`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-012) | US-006, US-008 | Recruitment Boards |
| | **13** | [`US-013: Browse & Filter Open Team Vacancies`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-013) | US-008, US-012 | Recruitment Boards |
| | **14** | [`US-014: Advanced Candidate Directory Search & Filter`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-014) | US-006, US-011 | Recruitment Boards |
| **Phase 3: Matching & Recruitment State Machine** | **15** | [`US-015: Candidate Recommendations for Team Leads`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-015) | US-006, US-011, US-012 | Algorithmic Matching |
| | **16** | [`US-017: Issue a Team Invitation`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-017) | US-012, US-015 | Recruitment Workflows |
| | **17** | [`US-018: Apply to Join a Team Vacancy`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-018) | US-006, US-013 | Recruitment Workflows |
| | **18** | [`US-019: Respond to a Team Invitation`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-019) | US-017, US-018 | Recruitment Workflows |
| | **19** | [`US-020: Team Lead Approves or Declines an Application`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-020) | US-018, US-019 | Recruitment Workflows |
| | **20** | [`US-021: In-App Notification Center & Recruitment Alerts`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-021) | US-017, US-018, US-019, US-020 | Communication Alerts |
| | **21** | [`US-022: Confirm and Lock a Team Roster`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-022) | US-012, US-019, US-020 | Roster Finalization |
| **Phase 4: Workspace, Manifest & Governance** | **22** | [`US-023: Team Private Coordination Workspace`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-023) | US-022 | Team Workspace |
| | **23** | [`US-024: Export Team Manifest & Check-In Card`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-024) | US-022 | Team Workspace |
| | **24** | [`US-025: User Reporting Modal for Abusive Content & Links`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-025) | US-006, US-012 | Trust & Safety |
| | **25** | [`US-026: Administrative Content Moderation & Safety Queue`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-026) | US-025 | Trust & Safety |
| | **26** | [`US-027: Administrative Account Management & Enforcement`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-027) | US-003, US-026 | Administration |
| | **27** | [`US-028: Immutable Administrative Audit Logging`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-028) | US-010, US-026, US-027 | Administration / Audit |
