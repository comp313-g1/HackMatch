# User Roles and Personas

## Overview

HackMatch is a pre-hackathon team formation platform designed to connect students with complementary technical skills, schedule availability, and project ambitions before an event begins. This document formally defines the user taxonomy, operational boundaries, and concrete user personas governing system design.

Following the course guidelines, the platform defines two global authenticated account types, one contextual role, one unauthenticated public state, and an explicit anti-user security boundary:

| Role Category | Role Name | Identifier | Account Type | Primary Responsibility |
|---|---|---|---|---|
| **Primary** | Hackathon Participant | `PART` | Global Account | Maintains portfolio profile, declares event availability, applies to teams, accepts invites. |
| **Contextual** | Team Lead | `LEAD` | Contextual Permission | A `PART` who creates a team. Requests unlisted events, defines vacancies, and locks rosters. |
| **Governance** | Platform Administrator | `ADMIN` | Privileged Account | Verifies crowdsourced event requests, moderates abuse reports, and audits system integrity. |
| **Public** | Unauthenticated Visitor | `VISITOR` | Session State | Discovers hackathons and previews open teams with strict privacy-redacted views. |
| **Anti-User** | Malicious Actor / Scraper | `THREAT` | Security Boundary | Unauthorized data harvesting, phishing event URLs, and platform harassment. |

---

## User Role 1: Hackathon Participant

**Role Identifier:** `PART`

**Description:** A student, recent graduate, or self-taught developer looking to find or join a balanced hackathon team. Participants sign in via federated OAuth (Google or GitHub) or email/password secured with mandatory Login Multi-Factor Authentication (MFA). They manage a structured technical profile (skills, primary role, experience tier, portfolio URLs, and historical hackathon records), search verified and pending hackathon directories, toggle event availability flags, apply to open vacancy slots, and process incoming team invitations.

**Primary Goals:**
- Showcase verified technical, design, or project management capabilities and past hackathon history.
- Discover hackathons, declare event-specific participation, and set personal objectives (`Learning`, `Project Completion`, or `Competitive / Prize-Hunting`).
- Find open team vacancies matching their skills and schedule constraints without manual Discord searching.
- Secure a spot on a confirmed, roster-locked team prior to hackathon registration deadlines.

**Technical Expertise:** Variable, ranging from complete beginners (first-time hackathon attendees) to advanced senior engineering students and experienced open-source contributors.

**Key Characteristics:**
- Time-constrained students balancing coursework and hackathon preparation.
- Diverse academic backgrounds, technical competencies, and hackathon experience tiers.
- Desktop-focused workflow: students access the platform via desktop or laptop web browsers (Chrome, Firefox, Safari, Edge) alongside their IDEs, terminal windows, and coursework.
- Reluctant to cold-message strangers on unstructured chat boards without knowing their real technical background and time commitment.

**Constraints or Pain Points:**
- **Single-Team Invariant:** A participant cannot belong to more than one confirmed roster for the same hackathon.
- **Application Throttle:** Limited to a maximum of 3 concurrent active team applications per event to eliminate mass-spamming.
- **Privacy Protections:** Student contact details (email, Discord handle) are concealed until a mutual invitation or application is formally accepted.

---

### Persona 1.1: Nisha Sharma (Collaborative Frontend Developer)
- **Demographics:** 21 years old, 3rd-year Software Engineering Technology student at Centennial College.
- **Device & Environment:** 13-inch Apple MacBook Air (1440x900 resolution, Chrome/Safari), working from campus library and computer labs.
- **Technical Background:** Intermediate. Proficient in React, Tailwind CSS, TypeScript, and Figma; basic Node.js; no database administration experience.
- **Goals & Motivations:** Wants to build a polished, accessible frontend for an AI sustainability tool at an upcoming inter-collegiate hackathon. Needs a reliable backend/API partner to manage server infrastructure.
- **Pain Points:** Overwhelmed by disorganized, fast-scrolling Discord `#looking-for-team` channels. Frustrated by reaching out to students who claim "full-stack skills" but cannot integrate REST APIs.
- **Workflow:** Signs in via Google OAuth on her laptop in the campus library. Searches for an upcoming regional hackathon, filters open team listings for "Backend / Node.js vacancy" with a "Competitive" goal, reviews the team pitch, and submits a join application.

---

### Persona 1.2: Omar Vance (Self-Taught Mobile Dev with Strict Schedule Constraints)
- **Demographics:** 24 years old, career changer enrolled in an accelerated diploma program; works a part-time job on Friday evenings.
- **Device & Environment:** Desktop dual-monitor workstation (1920x1080, Chrome); Android device for testing.
- **Technical Background:** Intermediate. Fluent in Kotlin, Flutter, and Firebase; highly proficient with Git version control.
- **Goals & Motivations:** Wants to build a native mobile proof-of-concept to strengthen his junior developer portfolio. Must find teammates who respect a strict 20-hour weekend time budget.
- **Pain Points:** Burned by previous hackathons where disorganized teams spent 14 hours debating project ideas and abandoned the code repository at 3:00 AM.
- **Workflow:** Signs in with GitHub OAuth. Populates his profile with his past GitHub repositories, sets his hackathon availability flag to "15–20 hours commitment / Pragmatic Delivery", and reviews inbound invitations sent by Team Leads.

---

### Persona 1.3: Marcus Thorne (Accessibility-Focused Developer / Screen Reader User)
- **Demographics:** 22 years old, final-year Computer Science student, low-vision developer.
- **Device & Environment:** Windows 11 laptop running NVDA screen reader, high-contrast OS mode, full keyboard navigation (no mouse).
- **Technical Background:** Advanced backend and systems engineer. Proficient in Python, Go, PostgreSQL, Docker, and Linux.
- **Goals & Motivations:** Wants to join an active team early to establish repository architecture and Dockerized development environments before event check-in.
- **Pain Points:** Inaccessible platforms with low-contrast buttons, unlabelled modal popups, and non-navigable search filters that break screen-reader focus.
- **Workflow:** Signs in via standard credentials with email-based OTP MFA. Relies on structured WCAG 2.1 AA keyboard navigation to browse team vacancies, inspect vacancy requirements, and accept an invitation from a Team Lead.

---

## Contextual Role: Team Lead

**Role Identifier:** `LEAD` *(Contextual authorization state of a `PART`)*

**Description:** Any authenticated Participant (`PART`) who initializes a new team listing assumes the contextual `LEAD` permissions for that specific team record. The Team Lead anchors the team to an existing official hackathon or submits a crowdsourced event registration request. They specify the project concept, competitive objective, and discrete vacancy slots, review incoming applications, send direct invitations to solo candidates, and lock the final roster.

**Primary Goals:**
- Form a well-rounded, complementary team before the hackathon kickoff.
- Register an unlisted hackathon if not currently in the platform directory.
- Define explicit skill vacancies (e.g., "1 UI/UX Designer" and "1 Backend Engineer") to attract targeted talent.
- Update and refine team details (project concept pitch, vacancy roles, required skills) through self-service editing prior to roster lock.
- Screen candidate profiles, approve or decline applications, and lock the confirmed roster.

**Technical Expertise:** Variable; permission is granted based on team creation, not seniority or skill level.

**Key Characteristics:**
- Proactive coordinator who takes ownership of project vision and team composition.
- Seeks transparency regarding applicant skill levels and past hackathon delivery reliability.

**Constraints or Pain Points:**
- **Capacity Limits:** Enforced team size limits ($2 \le \text{members} \le 6$) bounded by the target hackathon's rules.
- **Invitation Race Condition:** Pending invitations must auto-cancel if open slots fill via approved applications before the invitee responds.
- **Roster Freezing:** Once the Lead locks the roster, no further membership mutations, invitations, or applications are permitted.

---

### Team Lead Persona 2.1: Elena Rostova (Competitive Full-Stack Project Lead)
- **Demographics:** 23 years old, 4th-year Software Engineering student; veteran of 5 hackathons (2 podium placements).
- **Device & Environment:** High-DPI laptop (1440p, macOS Chrome).
- **Technical Background:** Advanced. TypeScript, Next.js, Python FastAPI, PostgreSQL, AWS, Docker.
- **Goals & Motivations:** Has a validated project concept for an automated medical note summarizer. Aims to place in the top 3 at an upcoming university hackathon. Needs exactly 1 ML engineer and 1 UI/UX designer.
- **Pain Points:** Inability to find an unlisted local hackathon on generic platforms; spending valuable hacking time setting up basic team logistics.
- **Workflow:** Searches HackMatch for "MetHacks 2026". Finds no matching event. Submits an event creation request (Title, Website URL, Dates, Max Team Size = 4). Optimistically initializes the team under `Pending Verification` status, publishes 2 structured vacancy slots, reviews rule-ranked candidate recommendations, dispatches invitations, and locks the roster once accepted.

---

### Team Lead Persona 2.2: Jordan Lee (Collaborative First-Time Coordinator)
- **Demographics:** 20 years old, 2nd-year student attending their first inter-university hackathon with a close classmate.
- **Device & Environment:** 15-inch Windows laptop (1920x1080 resolution, Edge browser).
- **Technical Background:** Beginner-to-Intermediate. Basic Java, Python, HTML/CSS, Git.
- **Goals & Motivations:** Wants to recruit two beginner-friendly peers who value learning and mentorship over ruthless competition.
- **Pain Points:** Intimidated by hyper-competitive teams; needs a transparent, friendly way to evaluate applicants without feeling inadequate.
- **Workflow:** Selects an existing verified hackathon from the directory. Posts a team listing with the goal set to "Casual / Learning", configures vacancy cards on the web dashboard, reviews interested applicants, and approves candidates who share a learning mindset.

---

## User Role 2: Platform Administrator

**Role Identifier:** `ADMIN`

**Description:** An authorized system operator responsible for platform safety, content moderation, directory verification, and operational governance. Administrators access a restricted administrative dashboard protected by mandatory multi-factor authentication. They review crowdsourced event creation requests with full authority to factually correct mismatched parameters (such as rectifying user-submitted team size caps to match official event terms, adjusting dates, or correcting website links) prior to approval, merge duplicate submissions, or reject non-compliant requests with explanatory feedback. Administrators also maintain published canonical event records if external event rules change.

**Primary Goals:**
- Audit, correct, and verify crowdsourced event metadata (e.g., aligning team size limits and dates with official website terms) before publishing.
- Maintain an accurate, verified hackathon directory by evaluating crowdsourced requests and updating published records.
- Protect participants from phishing schemes, harassment, and fraudulent profiles.
- Enforce fair platform usage and maintain transparent, immutable audit trails.

**Technical Expertise:** Proficient in administrative web consoles, data verification, basic SQL queries, and community moderation workflows.

**Key Characteristics:**
- Operates under strict least-privilege principles (cannot tamper with private team rosters or read unflagged private communications).
- Requires clear, actionable workflows to prevent verification backlogs.

**Constraints or Pain Points:**
- **Verification Velocity:** Must quickly verify or reject crowdsourced event submissions to prevent blocking team recruitment.
- **Compliance & Privacy:** Must ensure account deletions comply with data privacy regulations (PIPEDA / GDPR right-to-be-forgotten).

---

### Persona 3.1: Riley Miller (Student Platform Safety & Verification Lead)
- **Demographics:** 22 years old, final-year Cybersecurity & Systems Administration student; student club operations lead.
- **Device & Environment:** Desktop workstation (1080p, Firefox Developer Edition, Linux).
- **Technical Background:** Advanced. Web security, database management, regex pattern matching, DNS validation, moderation tooling.
- **Goals & Motivations:** Ensure HackMatch remains a safe, credible platform for all collegiate participants while preventing spam bots and malicious actors.
- **Pain Points:** Flooded with duplicate event creation requests caused by slight user spelling variations; dealing with fake hackathon postings linking to malicious credential harvesters.
- **Workflow:** Signs in via mandatory credentials + hardware/email MFA. Opens the Administrative Dashboard. Reviews the Event Verification Queue: inspects Elena’s submission for "MetHacks 2026"; notices the student requested Max Team Size = 6, but verification of the official event rules shows a strict 4-person limit; edits the record's max team size field to 4, validates the official SSL certificate and domain, checks for existing duplicate records, and clicks `Approve & Publish`. Transitions to the Moderation Queue to review a flagged team posting containing offensive language, issues a formal warning, and redacts the listing text.

---

## Public State: Unauthenticated Visitor

**Role Identifier:** `VISITOR`

**Description:** A prospective user who lands on the HackMatch web client without an active authenticated session. Visitors can browse upcoming hackathon listings, view anonymized team vacancy boards, and inspect public platform documentation. To prevent commercial talent scraping and student stalking, all personal contact information, verified profile links, and direct messaging features remain strictly locked behind registration.

**Primary Goals:**
- Explore available hackathons and evaluate open team vacancies before creating an account.
- Experience zero-friction, registration-free preview of platform value.
- Register a new `PART` account or authenticate via Google/GitHub OAuth once a suitable team or event is found.

**Technical Expertise:** Variable.

**Constraints or Pain Points:**
- Read-only access: cannot create teams, submit join applications, send invitations, or access full participant profiles.

---

### Persona 4.1: Samira Khan (First-Year Student Exploring Hackathons)
- **Demographics:** 19 years old, 1st-year Computer Programming student who has never attended a tech event.
- **Device & Environment:** Campus computer lab desktop workstation (1920x1080 resolution, Chrome desktop).
- **Technical Background:** Novice. Learning basic Python and web scripting; intimidated by high-pressure competitive environments.
- **Pain Points:** Skeptical of platforms that force immediate account registration or credit card entry just to view event listings.
- **Workflow:** Lands on the HackMatch homepage via a campus Discord flyer link on her lab desktop. Browses verified hackathon listings, filters open teams by "Beginner Welcome", finds Jordan’s team, and clicks "Sign in with Google" to create her verified `PART` profile.

---

## Security Boundaries & Anti-Users

Threat actors represent unauthorized entities whose motivations directly oppose system security, user privacy, and platform integrity. Modeling these boundaries ensures non-functional security and moderation requirements are grounded in defensive specifications:

1. **Commercial Scraper / Talent Harvester (`THREAT-SCRAPE`):** Automated bot scripts or aggressive third-party recruiters attempting to harvest student emails, GitHub profiles, and portfolio data without consent. Countered by strict rate limiting (max 60 req/min per IP) and data redaction on all public directory endpoints.
2. **Phishing Impersonator / Griefing Troll (`THREAT-TROLL`):** Malicious actors seeking to submit fake hackathon postings with phishing links, post abusive or harassing team descriptions, or flood team leads with spam applications. Countered by mandatory URL schema validation, HTML input sanitization, optimistic `Unverified` event badges, rate-limited applications (max 3 active), and administrative instant-suspension tooling backed by immutable audit logs.
