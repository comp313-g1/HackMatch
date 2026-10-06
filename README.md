# HackMatch

HackMatch is a planned pre-hackathon team-formation platform for students and early-career developers. Participants discover verified hackathons, find open team opportunities or create their own listings, and connect with complementary teammates through applications and invitations. Participants browse and filter teams; Participants acting as Team Leads receive rule-based candidate recommendations and manage recruitment through to a confirmed, locked roster.

HackMatch focuses on forming teams before an event. It maintains event records to support recruitment, rather than providing a full hackathon-management service.

## Problem / Purpose

Team formation can be fragmented across messages and manually maintained lists, leaving openings, availability, and commitments unclear. HackMatch aims to help people find collaborators beyond their existing contacts and follow a structured path from interest to confirmed membership. The Project Proposal explains the evidence and assumptions behind this approach.

## Core MVP Capabilities

The semester MVP consists of **20 Must-Have stories** grouped into these capabilities:

- **Account access:** Participant registration and email verification, credential or Google/GitHub sign-in, password recovery, session management, and required email one-time passwords (OTP) for every login, including OAuth. Public registration creates Participant accounts only.
- **Participant profiles:** Self-declared skills, contribution areas, and portfolio links, with defined profile and contact visibility boundaries.
- **Trusted event discovery:** Public browsing/filtering of verified hackathons, Participant event submissions, and Administrator verification, correction, duplicate handling, and lifecycle management.
- **Recruitment discovery:** Event-specific Looking-for-Team status, owned team listings with open slots, and Participant browsing/filtering of vacancies. Team Leads receive explainable, rule-based candidate recommendations.
- **Joining and membership safeguards:** Invitations, applications, Participant invitation responses, Team Lead application decisions, and basic status alerts. Both joining routes enforce capacity and one confirmed team per Participant per hackathon, including before roster lock.
- **Roster completion:** Team ownership, defined pre-lock membership changes, and confirmation/locking of event-compliant rosters. Team creation confirms the owner's membership under the same safeguards.
- **Limited administration:** Event management, account controls and authorized deletion handling, basic content moderation, and administrative action records.

The product is specified as a responsive website supporting desktop, tablet/iPad, and phone portrait/landscape layouts.

**Beyond the MVP:** Should-Haves include history/badges, advanced candidate search, a full notification centre, private coordination workspace, roster export, participant reporting, and audit search. Participant-facing team recommendations and authenticator-app 2FA are uncommitted May-Haves. These features are not required MVP delivery work.

## Roles

- **`PART` — Participant:** The standard authenticated participant account.
- **`ADMIN` — Platform Administrator:** A privileged account for verified event records, account management, and basic moderation.
- **Team Lead:** Contextual permissions held by a `PART` who owns a specific team; not a separate global account role. A Participant can lead a team for one event and be a regular member elsewhere.
- **Visitor:** An unauthenticated actor who can browse public events and anonymized team previews; not a stored account role.

Hackathon Organizers and campus clubs are external stakeholders and possible future self-service users. Course professors/evaluators are academic stakeholders. Neither group receives an MVP account role through stakeholder status.

## Event Verification Workflow

**Verified PART submits → Private pending review → ADMIN approval → Public verified event → Team formation enabled**

Pending submissions are visible only to their submitter and ADMIN. Approval checks official event information and rules; duplicate submissions are handled against the shared event record. Verification supports recruitment and does not establish organizer endorsement or attendee admission. Ticketing, payments, judging, attendee registration, and full event management are outside HackMatch's core purpose.

## Documentation

These Markdown documents define the current product specification:

- [Project Proposal](docs/00_starter_pack/HackMatch_Project_Proposal.md) — problem, solution, scope, research, and competitive positioning.
- [Roles and Personas](docs/01_roles_and_personas/roles_and_personas.md) — account roles, contextual permissions, stakeholders, and illustrative personas.
- [User Stories](docs/02_user_stories/user_stories.md) — canonical backlog and acceptance criteria.
- [MVP Definition](docs/03_mvp/mvp_definition.md) — delivery categories, implementation dependencies, and milestones.
- [Functional and Non-Functional Requirements](docs/04_requirements/functional_nonfunctional_requirements.md) — detailed behaviour, quality criteria, traceability, and proposed policy decisions.

## Current Specification Summary

| Specification | Count |
|---|---:|
| Total user stories | 29 |
| Must-Have / MVP stories | 20 |
| Should-Have / post-MVP stories | 7 |
| May-Have / uncommitted stories | 2 |
| Functional requirements | 85 |
| Non-functional requirements | 24 |
| Total requirements | 109 |

Requirement totals cover the full documented scope, including deferred features. **MVP means Must-Haves only.**

## Project Milestones

- **October 25, 2026:** Sprint / Iteration 1.
- **November 29, 2026:** Sprint / Iteration 2 and planned MVP implementation target.
- **December 13, 2026:** Final Project Report.
- **December 18, 2026:** Final Project & Presentation.

The implementation timeline focuses on the Must-Have MVP. Subsequent course work covers validation, fixes, reporting, and presentation; Should-Haves and May-Haves do not drive required semester delivery.

## Project Status

The Markdown documentation provides the stabilized baseline for implementation planning. This repository currently contains documentation and a license; application source code is not yet present. The capabilities above describe the specification, not completed functionality. Proposed policy parameters and deployment targets still requiring confirmation are identified in the requirements document.

## Team

- Po-Kai Chao
- Joel Israel Alon Gonzalez
- Sahil Gupta
- Edgar Soto Hernandez
- Mohmedjuber Jangda
- Wei Tong

---

## Local Development & Getting Started

### 1. Prerequisites
- **Node.js:** `22.x LTS` (pin via `.nvmrc`)
- **npm:** `10.x` or higher

### 2. Initial Setup
Clone the repository and install dependencies across all monorepo workspaces:
```bash
# Clone the repository
git clone <repo-url>
cd Team-1-COMP313

# Install dependencies (root, client, and server)
npm install
```

### 3. Environment Configuration
Copy the template files to create local `.env` files:
```bash
# Server configuration (Express API)
cp server/.env.example server/.env

# Client configuration (React + Vite)
cp client/.env.example client/.env
```
> **Note:** Acquire real team Firebase and Supabase development secrets out-of-band. Never commit `.env` files to git.

### 4. Running the Application
Start both the client and server concurrently in development mode:
```bash
# Run both client and server dev servers
npm run dev

# Or run separately:
npm run dev --workspace=client   # Runs Vite on http://localhost:5173
npm run dev --workspace=server   # Runs Express API on http://localhost:3001
```

### 5. Running Quality Checks & Tests
```bash
# Run ESLint across all workspaces
npm run lint

# Run TypeScript typechecks across all workspaces
npm run typecheck

# Run test suites completely offline
npm run test

# Run tests with coverage reporting
npm run test:coverage

# Build client and server bundles
npm run build
```

