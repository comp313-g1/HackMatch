# HackMatch — Smart Pre-Hackathon Team Formation Platform

**Team 1 — COMP 313 (Software Project 2)**  
*Centennial College | Fall 2026*

---

## Executive Overview

**HackMatch** is a specialized web platform designed to eliminate the friction, chaos, and skill imbalances of last-minute hackathon team formation. Rather than relying on noisy, unvetted Discord channels or rushed day-of networking, HackMatch enables students and independent hackers to build rich multidisciplinary profiles, discover upcoming events, post structured recruitment openings, and receive deterministic match recommendations based on complementary skills, availability, and competitive goals.

---

## Core Value Proposition & Differentiators

- **Complementary Matching:** Evaluates teams by skill synergy (e.g., pairing a React frontend developer with a Python/PostgreSQL backend specialist and a UI/UX designer) rather than generic keywords.
- **Goal Alignment:** Matches participants based on shared expectations (Casual Learning vs. Competitive Winning).
- **Roster Concurrency Management:** Prevents ghosting and last-minute dropouts via 48-hour invitation lifecycles, capacity locking, and exportable check-in team manifests.
- **Zero-Trust Privacy:** Strict PII redaction on public endpoints to protect students from unauthorized commercial recruiter harvesting and spam.

---

## Project Specification Documents

All project specification deliverables have been authored in compliance with project standards:

| Milestone | Document | Description |
|---|---|---|
| **00** | [`HackMatch Project Proposal`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/00_starter_pack/HackMatch_Project_Proposal.md) | Problem statement, proposed solution, scope boundaries, and differentiators. |
| **01** | [`User Roles & Personas`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/01_roles_and_personas/roles_and_personas.md) | Actor definitions (`DEV`, `CAPT`, `ORG`, `ADMIN`, `GUEST`, `ANTI`) with in-depth behavioural personas. |
| **02** | [`User Stories Backlog`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/02_user_stories/user_stories.md) | 17 agile user stories (`US-001`–`US-017`) across 6 feature areas with testable acceptance criteria. |
| **03** | [`MVP Definition & Implementation Plan`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/03_mvp/mvp_definition.md) | MoSCoW prioritization (12 Must-Haves) and dependency-ordered release roadmap. |
| **04** | [`Functional & Non-Functional Requirements`](file:///C:/Users/Brian/CentennialCollege3429/Semester_202609/COMP_313_Project2/Team-1-COMP313/docs/04_requirements/functional_nonfunctional_requirements.md) | 24 Functional Requirements (`FR-001`–`FR-024`) and 21 Non-Functional Requirements (`NR-001`–`NR-021`) with measurable SLOs. |

---

## System Actors & Roles Matrix

```
+-------------------------------------------------------------------------------+
|                                  GUEST                                        |
|             (Public Event Discovery, Teaser Listings, Conversion)             |
+-------------------------------------------------------------------------------+
                                      |
                               (Registers & Verifies)
                                      v
+-------------------------------------------------------------------------------+
|                                   DEV                                         |
|    (Participant: Profile Management, Event Availability, Team Applications)   |
+-------------------------------------------------------------------------------+
                                      |
                           (Creates Team Listing)
                                      v
+-------------------------------------------------------------------------------+
|                                   CAPT                                        |
|   (Team Captain: Recruiter, Vacancy Management, Invitations, Roster Locking)  |
+-------------------------------------------------------------------------------+
                                      |
        +-----------------------------+-----------------------------+
        |                                                           |
        v                                                           v
+-------------------------------+           +-------------------------------+
|              ORG              |           |             ADMIN             |
|   (Event Submissions & Info)  |           | (Content Moderation & Trust)  |
+-------------------------------+           +-------------------------------+
```

---

## Repository Structure

```text
Team-1-COMP313/
├── README.md                                         <- Master project overview
└── docs/
    ├── 00_starter_pack/
    │   └── HackMatch_Project_Proposal.md             <- Core concept & boundaries
    ├── 01_roles_and_personas/
    │   ├── README.md                                 <- Module guide
    │   ├── roles_and_personas_template.md            <- Standard template
    │   └── roles_and_personas.md                     <- Completed specification
    ├── 02_user_stories/
    │   ├── README.md                                 <- Module guide
    │   ├── user_stories_template.md                  <- Standard template
    │   └── user_stories.md                           <- 17 User Stories (US-001 to US-017)
    ├── 03_mvp/
    │   ├── README.md                                 <- Module guide
    │   ├── mvp_definition_template.md                <- Standard template
    │   └── mvp_definition.md                         <- MoSCoW & 12-step plan
    └── 04_requirements/
        ├── README.md                                 <- Module guide
        ├── functional_nonfunctional_requirements_template.md
        └── functional_nonfunctional_requirements.md  <- 24 FRs & 21 NFRs
```