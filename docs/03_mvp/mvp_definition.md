# MVP Definition

## Overview

This document defines the Minimum Viable Product (MVP) scope and release strategy for **HackMatch**. The MVP represents the smallest, most cohesive subset of capabilities that solves the core problem articulated in [`docs/00_starter_pack/HackMatch_Project_Proposal.md`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/00_starter_pack/HackMatch_Project_Proposal.md): eliminating chaotic, last-minute hackathon team formation by connecting students based on complementary skills, availability, and goals.

Using the MoSCoW framework, this document systematically categorizes all 17 user stories from [`docs/02_user_stories/user_stories.md`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md) into five delivery tiers. The MVP consists strictly of the **Must-Haves** (12 user stories), scheduled across an optimized, dependency-ordered implementation roadmap.

---

## User Story Categorization

### Must-Haves

User stories in this category represent the core value engine of HackMatch. Without these capabilities, participants cannot create verified developer/designer profiles, discover hackathons, declare availability, publish open team slots, receive rule-based match recommendations, or finalize confirmed rosters.

| User Story | Justification |
|---|---|
| [`US-001: User Registration & Email Verification`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-001) | Foundational identity barrier; required to establish user accounts, enforce security, and prevent bot abuse. |
| [`US-002: User Authentication & Session Management`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-002) | Essential for user session security, state persistence, and role-based access control. |
| [`US-003: Participant Profile Management`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-003) | Core data asset; captures skills, experience tiers, and links necessary for rule-based matching algorithms. |
| [`US-004: Public Hackathon Discovery & Filtering`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-004) | Essential top-of-funnel discovery; participants must anchor their team-seeking status to specific hackathons. |
| [`US-007: Declare Event Availability & "Looking for Team" Status`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-007) | Core participation trigger; enables solo students to signal event-specific availability and competitive goals. |
| [`US-008: Create Team Recruitment Listing`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-008) | Essential recruitment capability; enables team captains to post project concepts and define open skill slots. |
| [`US-009: Browse & Search Recruitment Listings`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-009) | Core discovery mechanism; allows solo participants to find open teams matching their declared abilities. |
| [`US-010: Candidate Teammate Recommendations for Captains`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-010) | Primary market differentiator; uses deterministic scoring to recommend complementary candidates to captains. |
| [`US-012: Issue Direct Team Invitation`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-012) | Essential interaction primitive; allows captains to convert recommended candidates into potential teammates. |
| [`US-013: Apply to Join Team`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-013) | Essential bottom-up recruitment primitive; allows solo participants to apply for specific team slots. |
| [`US-014: Manage Invitation & Application Lifecycle`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-014) | Critical workflow resolution engine; handles acceptance, rejection, capacity limits, and race-condition prevention. |
| [`US-015: Roster Finalization & Export`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-015) | Core milestone completion; locks confirmed team members and generates the check-in manifest for event organizers. |

---

### Should-Haves

User stories that significantly enhance usability, administrative oversight, and reciprocal matching, scheduled for implementation immediately post-MVP (v1.1 – v1.2).

| User Story | Value & Timeline |
|---|---|
| [`US-011: Recommended Teams for Solo Participants`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-011) | **v1.1 - Post-Launch.** Enhances participant discovery by pushing matching teams to solo users; in MVP v1.0, solo users rely on search and manual filtering via US-009. |
| [`US-005: Hackathon Listing Creation & Management`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-005) | **v1.1 - Post-Launch.** Self-serve organizer portal; in MVP v1.0, event listings are seeded and curated directly via database seeds or administrative intake. |
| [`US-006: Event Moderation & Verification`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-006) | **v1.1 - Post-Launch.** Companion verification queue for US-005; not required in v1.0 while event listings are admin-managed. |
| [`US-016: Report Abusive User or Fraudulent Listing`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-016) | **v1.2 - Trust & Safety Update.** In-app user reporting modal; MVP v1.0 relies on direct administrative support email contacts. |
| [`US-017: Administrative Content Moderation & Account Suspension`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-017) | **v1.2 - Trust & Safety Update.** Structured admin moderation dashboard; MVP v1.0 uses direct database operations for user suspension. |

---

### Nice-To-Haves

Desirable features that add user delight, automated workflows, and external ecosystem integration, considered for subsequent milestone updates (v1.3+).

| User Story |
|---|
| **US-N01: In-App Teammate Direct Messaging** — Real-time private chat between prospective teammates before formal invitation acceptance. |
| **US-N02: Hackathon Idea & Pitch Voting Board** — Collaborative whiteboard for teams to brainstorm and upvote project concepts before event kickoff. |
| **US-N03: Discord Webhook & Server Sync** — Automatic generation of private Discord channels and role assignments for confirmed rosters. |
| **US-N04: GitHub Organization & Repo Provisioning** — One-click automated creation of a shared team GitHub repository upon roster lock. |
| **US-N05: Interactive Availability & Time-Zone Matrix** — Visual schedule overlay showing team overlap across conflicting classes and time zones. |

---

### May-Haves

Speculative and exploratory capabilities requiring user validation, market testing, or deeper technical research before commitment.

| User Story | Tentative Status |
|---|---|
| **US-M01: Post-Hackathon Peer Endorsements & Reliability Badges** | Pending user feedback; requires fraud-prevention heuristics to avoid reciprocal collusion or rating inflation. |
| **US-M02: Semantic Skill Extraction via GitHub Profile Parsing** | Requires API rate-limit analysis and AI evaluation to assess if automated scraping yields accurate skills. |
| **US-M03: Sponsor Challenge & Prize Track Affinity Matching** | Depends on organizer partnerships and willingness to provide structured sponsor challenge APIs. |

---

### Out of Scope

Capabilities explicitly excluded from the HackMatch product roadmap to maintain architectural focus and prevent scope creep.

| Title or User Story | Reason Out of Scope |
|---|---|
| **Full Social-Network Feed & Timelines** | Outside core domain; HackMatch is a purpose-driven matching tool, not a general-purpose social network. |
| **Native In-App Audio / Video Calling** | Better solved by third-party integrations (Discord, Zoom, Google Meet); building custom WebRTC media infrastructure introduces immense maintenance overhead. |
| **Full Event Management, Ticketing & Judging Tools** | Outside product mission; platforms like Devpost and Eventbrite already dominate judging and registration workflows. |
| **Native Mobile Applications (iOS / Android)** | Requires duplicate codebase maintenance; modern responsive web application (PWA) satisfies mobile browser use cases. |

---

## MVP Definition

Your Minimum Viable Product consists of all **Must-Have** user stories categorized above, implemented in the priority order defined in the MVP Implementation Plan section below. The MVP is complete when all Must-Have stories have been implemented and tested. No Must-Have story should be deferred to post-launch unless there is an explicit business decision to do so.

**MVP User Stories:** `US-001`, `US-002`, `US-003`, `US-004`, `US-007`, `US-008`, `US-009`, `US-010`, `US-012`, `US-013`, `US-014`, `US-015`

**MVP Scope:** The HackMatch MVP delivers an end-to-end, deterministic team-formation web platform. It enables student developers and designers to register verified accounts, build standardized skill profiles, discover upcoming hackathons, publish structured team recruitment posts, receive rule-based match recommendations based on complementary skills and availability, and finalize confirmed team rosters prior to event commencement.

**MVP Target Release Date:** November 20, 2026

---

### MVP Implementation Plan

The table below sequences all 12 Must-Have user stories. Dependencies are strictly respected: no story has a lower priority number than any story it depends upon. Foundational infrastructure (Auth, Hackathon Directory, Profiles) is front-loaded to enable parallel development on downstream team-matching workflows.

| Priority | User Story | Depends On | Relates To |
|---|---|---|---|
| **1** | [`US-001: User Registration & Email Verification`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-001) | None | US-002, US-004 |
| **2** | [`US-004: Public Hackathon Discovery & Filtering`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-004) | None | US-001, US-007, US-008 |
| **3** | [`US-002: User Authentication & Session Management`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-002) | US-001 | US-003 |
| **4** | [`US-003: Participant Profile Management`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-003) | US-002 | US-007, US-008, US-010 |
| **5** | [`US-007: Declare Event Availability & "Looking for Team" Status`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-007) | US-003, US-004 | US-008, US-009, US-010 |
| **6** | [`US-008: Create Team Recruitment Listing`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-008) | US-003, US-004 | US-007, US-009, US-010 |
| **7** | [`US-009: Browse & Search Recruitment Listings`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-009) | US-004, US-008 | US-007, US-013 |
| **8** | [`US-010: Candidate Teammate Recommendations for Captains`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-010) | US-003, US-007, US-008 | US-012 |
| **9** | [`US-012: Issue Direct Team Invitation`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-012) | US-008, US-010 | US-014 |
| **10** | [`US-013: Apply to Join Team`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-013) | US-003, US-009 | US-014 |
| **11** | [`US-014: Manage Invitation & Application Lifecycle`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-014) | US-012, US-013 | US-015 |
| **12** | [`US-015: Roster Finalization & Export`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md#US-015) | US-008, US-014 | None |
