# User Roles and Personas

## Overview

HackMatch is a pre-hackathon team formation platform designed to connect students with complementary technical skills, schedule availability, and project ambitions before an event begins. This document defines account roles, contextual permissions, stakeholders, and illustrative personas for the expanded product. The personas are hypothetical design aids; no interviews, measured user research, or organizer endorsement are claimed. Named events and rules in their workflows are illustrative, not assertions about actual event policies.

Following the course guidelines, the platform defines two global authenticated account types, one contextual role, one unauthenticated public state, external/academic stakeholder groups, and an explicit anti-user security boundary:

| Role Category | Role Name | Identifier | Account Type | Primary Responsibility |
|---|---|---|---|---|
| **Primary** | Hackathon Participant | `PART` | Global Account | Maintains portfolio profile, declares event availability, applies to teams, accepts invites. |
| **Contextual** | Team Lead | `LEAD` | Contextual Permission | A `PART` who creates a team. Defines vacancies, recruits candidates, and locks their team roster. Any verified PART may submit an event before owning a team. |
| **Governance** | Platform Administrator | `ADMIN` | Privileged Account | Creates/verifies event records, manages accounts, and handles basic moderation; reporting/audit interfaces expand after MVP. |
| **Public** | Unauthenticated Visitor | `VISITOR` | Session State | Discovers hackathons and previews open teams with strict privacy-redacted views. |
| **Stakeholder** | Event Organizers & Academic Evaluators | `STAKE` | External / Academic | Provides official event rules or evaluates course deliverables; no application permissions. |
| **Anti-User** | Malicious Actor / Scraper | `THREAT` | Security Boundary | Unauthorized data harvesting, phishing event URLs, and platform harassment. |


Delivery scope follows the [MVP definition](../03_mvp/mvp_definition.md): **20 Must-Haves in MVP, 7 Should-Haves after MVP, 2 May-Haves uncommitted** across [29 current stories](../02_user_stories/user_stories.md). Candidate recommendations, basic status alerts and ADMIN action records are MVP. History/badges, advanced candidate search, full notification centre, workspace, export, participant reporting and searchable audit review are post-MVP. Participant-facing recommendations and authenticator methods remain May-Haves. Proposed numerical rules require the confirmations in the [policy register](../04_requirements/functional_nonfunctional_requirements.md#policy-register).

PART and ADMIN are the only stored account roles. LEAD is a label for ownership permissions on one team; VISITOR is an unauthenticated state. STAKE/THREAT labels describe stakeholders/security analysis and never become account roles. A PART can lead a team in one event and be a regular member elsewhere. Every login, including Google/GitHub, requires email OTP: **10-minute expiry; 5 incorrect OTP attempts lock the account for 15 minutes**.

---

## User Role 1: Hackathon Participant

**Role Identifier:** `PART`

**Description:** A student, recent graduate, or self-taught developer looking to find or join a balanced hackathon team. Participants use Google/GitHub or email/password as primary sign-in, followed in every case by mandatory email OTP. They maintain self-declared skills/roles and portfolio URLs, browse Verified events, declare availability, apply and respond to invitations. Any verified PART may submit an unlisted event to ADMIN; pending submissions are visible only to their submitter and ADMIN. History and experience badges are post-MVP.

**Primary Goals:**
- Showcase self-declared technical/design capabilities and portfolio links; add participation history when the post-MVP feature is delivered.
- Discover hackathons, declare event-specific participation, and set personal objectives (`Learning`, `Project Completion`, or `Competitive`).
- Find open team vacancies matching their skills and schedule constraints without manual Discord searching.
- Secure a spot on a confirmed, roster-locked team prior to hackathon registration deadlines.

**Technical Expertise:** Variable, ranging from complete beginners (first-time hackathon attendees) to advanced senior engineering students and experienced open-source contributors.

**Key Characteristics:**
- Time-constrained students balancing coursework and hackathon preparation.
- Diverse academic backgrounds, technical competencies, and hackathon experience tiers.
- Responsive-browser workflow: students may use desktops/laptops alongside development tools or tablet/iPad and phone browsers in portrait or landscape. Core tasks support these layouts; native apps are outside scope.
- Reluctant to cold-message strangers on unstructured chat boards without knowing their real technical background and time commitment.

**Constraints or Pain Points:**
- **Single-Team Invariant:** A participant cannot belong to more than one confirmed roster for the same hackathon.
- **Application Throttle:** Retained proposed limit of 3 pending applications per event reduces bulk applications; it does not guarantee prevention of spam (policy R-02).
- **Privacy Protections:** Account email/authentication data remain private. Optional shared contact handles become visible only to confirmed teammates, with the owner informed; leaving/removal revokes this access. Profile skills/portfolio links are visible to authenticated PART users, not Visitors.

---

### Persona 1.1: Nisha Sharma (Collaborative Frontend Developer)
- **Demographics:** 21 years old, 3rd-year Software Engineering Technology student at Centennial College.
- **Device & Environment:** 13-inch Apple MacBook Air (1440x900 resolution, Chrome/Safari), working from campus library and computer labs.
- **Technical Background:** Intermediate. Proficient in React, Tailwind CSS, TypeScript, and Figma; basic Node.js; no database administration experience.
- **Goals & Motivations:** Wants to build a polished, accessible frontend for an AI sustainability tool at an upcoming inter-collegiate hackathon. Needs a reliable backend/API partner to manage server infrastructure.
- **Pain Points:** Overwhelmed by disorganized, fast-scrolling Discord `#looking-for-team` channels. Frustrated by reaching out to students who claim "full-stack skills" but cannot integrate REST APIs.
- **Workflow:** Signs in via Google followed by email OTP on her laptop in the campus library. Searches for an upcoming regional hackathon, filters open team listings for a "Frontend / React vacancy" in a team whose existing members cover backend/API work with a "Competitive" goal, reviews the team pitch, and submits a join application.

---

### Persona 1.2: Omar Vance (Self-Taught Mobile Dev with Strict Schedule Constraints)
- **Demographics:** 24 years old, career changer enrolled in an accelerated diploma program; works a part-time job on Friday evenings.
- **Device & Environment:** Desktop dual-monitor workstation (1920x1080, Chrome); Android device for testing.
- **Technical Background:** Intermediate. Fluent in Kotlin, Flutter, and Firebase; highly proficient with Git version control.
- **Goals & Motivations:** Wants to build a native mobile proof-of-concept to strengthen his junior developer portfolio. Must find teammates who respect a strict 20-hour weekend time budget.
- **Pain Points:** Burned by previous hackathons where disorganized teams spent 14 hours debating project ideas and abandoned the code repository at 3:00 AM.
- **Workflow:** Signs in with GitHub followed by email OTP. Populates his profile with his past GitHub repositories, sets his hackathon availability flag to "20 commitment hours / Project Completion", and reviews inbound invitations sent by Team Leads.

---

### Persona 1.3: Adrian Thorne (Accessibility-Focused Developer / Screen Reader User)
- **Demographics:** 22 years old, final-year Computer Science student, low-vision developer.
- **Device & Environment:** Windows 11 laptop running NVDA screen reader, high-contrast OS mode, full keyboard navigation (no mouse).
- **Technical Background:** Advanced backend and systems engineer. Proficient in Python, Go, PostgreSQL, Docker, and Linux.
- **Goals & Motivations:** Wants to join an active team early to establish repository architecture and Dockerized development environments before event check-in.
- **Pain Points:** Inaccessible platforms with low-contrast buttons, unlabelled modal popups, and non-navigable search filters that break screen-reader focus.
- **Workflow:** Signs in via standard credentials with email-based OTP MFA. Relies on structured WCAG 2.1 AA keyboard navigation to browse team vacancies, inspect vacancy requirements, and accept an invitation from a Team Lead.

---

## Contextual Role: Team Lead

**Role Identifier:** `LEAD` *(Contextual authorization state of a `PART`)*

**Description:** Any authenticated Participant (`PART`) who initializes a new team listing assumes the contextual `LEAD` permissions for that specific team record. The Team Lead anchors their team to a Verified event. Before team creation, any verified PART may submit a missing event, but ADMIN approval must occur before it is public or usable for recruitment. They specify the project concept, competitive objective, and discrete vacancy slots, review incoming applications, send direct invitations to solo candidates, and lock the final roster.

**Primary Goals:**
- Form a well-rounded, complementary team before the hackathon kickoff.
- As a PART, propose a missing event and track its verification status before team creation.
- Define explicit skill vacancies (e.g., "1 UI/UX Designer" and "1 Backend Engineer") to attract targeted talent.
- Update and refine team details (project concept pitch, vacancy roles, required skills) through self-service editing prior to roster lock.
- Screen candidate profiles, approve or decline applications, and lock the confirmed roster.

**Technical Expertise:** Variable; permission is granted based on team creation, not seniority or skill level.

**Key Characteristics:**
- Proactive coordinator who takes ownership of project vision and team composition.
- Seeks transparency regarding applicant skill levels and past hackathon delivery reliability.

**Constraints or Pain Points:**
- **Capacity Limits:** The verified event defines official minimum/maximum team size, including the owner. No universal 4-person or 2–6 limit is imposed. Missing official limits keep the event pending (policy R-01).
- **Membership Integrity:** Creating a team, accepting an invitation and approving an application enforce the same one-confirmed-team-per-event rule atomically. A filled slot cancels its remaining requests; the newly confirmed participant's other pending requests for that event are canceled/withdrawn.
- **Roster Freezing:** Lock permanently closes recruitment/membership edits. Before lock, non-owners may leave or be removed with a reason; owners may disband but cannot leave an owned team or transfer ownership in this release. See R-02 for retained lifecycle defaults.

---

### Team Lead Persona 2.1: Elena Rostova (Competitive Full-Stack Project Lead)
- **Demographics:** 23 years old, 4th-year Software Engineering student; veteran of 5 hackathons (2 podium placements).
- **Device & Environment:** High-DPI laptop (1440p, macOS Chrome).
- **Technical Background:** Advanced. TypeScript, Next.js, Python FastAPI, PostgreSQL, AWS, Docker.
- **Goals & Motivations:** Has a project concept for an automated medical note summarizer. Aims to place in the top 3 at an upcoming university hackathon. Needs exactly 1 ML engineer and 1 UI/UX designer.
- **Pain Points:** Inability to find an unlisted local hackathon on generic platforms; spending valuable hacking time setting up basic team logistics.
- **Workflow:** Searches HackMatch for "MetHacks 2026". Finds no matching event. Submits an event request as a PART (title, official URL, dates, official limits; the hypothetical example has a maximum of 4). Waits for ADMIN approval before creating a team, publishes the needed ML/UI vacancies within event capacity, reviews rule-ranked candidates, sends invitations, and locks a valid roster.

---

### Team Lead Persona 2.2: Jordan Lee (Collaborative First-Time Coordinator)
- **Demographics:** 20 years old, 2nd-year student attending their first inter-university hackathon with a close classmate.
- **Device & Environment:** 15-inch Windows laptop (1920x1080 resolution, Edge browser).
- **Technical Background:** Beginner-to-Intermediate. Basic Java, Python, HTML/CSS, Git.
- **Goals & Motivations:** Wants to recruit two beginner-friendly peers who value learning and mentorship over ruthless competition.
- **Pain Points:** Intimidated by hyper-competitive teams; needs a transparent, friendly way to evaluate applicants without feeling inadequate.
- **Workflow:** Selects an existing verified hackathon from the directory. Posts a team listing with the goal set to "Learning", configures vacancy cards on the web dashboard, reviews interested applicants, and approves candidates who share a learning mindset.

---

## User Role 2: Platform Administrator

**Role Identifier:** `ADMIN`

**Description:** An authorized system operator responsible for platform safety, content moderation, directory verification, and operational governance. Administrators access a restricted administrative dashboard protected by mandatory multi-factor authentication. They create official listings and review PART event submissions with authority to factually correct mismatched parameters (such as rectifying user-submitted team size caps to match official event terms, adjusting dates, or correcting website links) prior to approval, merge duplicate submissions, or reject non-compliant requests with feedback. A merge or rule correction that would invalidate memberships/capacity is rejected without partial changes. ADMIN can disable unsafe event recruitment but cannot secretly rewrite team rosters.

**Primary Goals:**
- Audit, correct, and verify crowdsourced event metadata (e.g., aligning team size limits and dates with official website terms) before publishing.
- Maintain an accurate, verified hackathon directory by evaluating crowdsourced requests and updating published records.
- Protect participants from phishing schemes, harassment, and fraudulent profiles.
- Enforce fair platform usage and keep basic action records; searchable audit review is post-MVP.

**Technical Expertise:** Proficient in administrative web consoles, data verification, basic SQL queries, and community moderation workflows.

**Key Characteristics:**
- Operates under strict least-privilege principles (cannot rewrite private rosters or read private team workspace notes solely through ADMIN status).
- Requires clear, actionable workflows to prevent verification backlogs.

**Constraints or Pain Points:**
- **Verification Workload:** Recruitment waits for approval, so ADMIN needs a clear pending queue and reasons/status visible to submitters.
- **Privacy:** Uses the proposed 30-day live-data deletion service target; legal applicability and backup/log retention require team confirmation under R-06 before real-user production.

---

### Persona 3.1: Riley Miller (Student Platform Safety & Verification Lead)
- **Demographics:** 22 years old, final-year Cybersecurity & Systems Administration student; student club operations lead.
- **Device & Environment:** Desktop workstation (1080p, Firefox Developer Edition, Linux).
- **Technical Background:** Advanced. Web security, database management, regex pattern matching, DNS validation, moderation tooling.
- **Goals & Motivations:** Ensure HackMatch remains a safe, credible platform for all collegiate participants while preventing spam bots and malicious actors.
- **Pain Points:** Flooded with duplicate event creation requests caused by slight user spelling variations; dealing with fake hackathon postings linking to malicious credential harvesters.
- **Workflow:** Signs in via credentials and mandatory email OTP. Opens the Administrative Dashboard. Reviews the Event Verification Queue: inspects Elena’s submission for "MetHacks 2026"; confirms the submitted maximum of 4 against the hypothetical official rules, checks organizer identity, edition, URL destination, dates, and duplicates, and clicks `Approve & Publish`. A TLS certificate alone is not evidence of legitimacy. Creates a moderation case for an offensive public team post, records a warning, and redacts it. Participant report intake and searchable audit review join this workflow after MVP.

---

## Public State: Unauthenticated Visitor

**Role Identifier:** `VISITOR`

**Description:** A prospective user who lands on the HackMatch web client without an active authenticated session. Visitors can browse upcoming hackathon listings, view anonymized team vacancy boards, and inspect public platform documentation. To prevent commercial talent scraping and student stalking, participant profile cards, member handles, and portfolio/contact links are not exposed to Visitors. Registration does not unlock private contacts; confirmed team membership is required. In-app direct messaging is outside scope.

**Primary Goals:**
- Explore available hackathons and evaluate open team vacancies before creating an account.
- Experience zero-friction, registration-free preview of platform value.
- Register a new PART account or use Google/GitHub primary sign-in, then complete email OTP before interaction.

**Technical Expertise:** Variable.

**Key Characteristics:**
- Has no stored account role or authenticated session.
- Uses responsive public pages to assess events and anonymized team vacancies.

**Constraints or Pain Points:**
- Read-only access: cannot create teams, submit join applications, send invitations, or access full participant profiles.

---

### Persona 4.1: Samira Khan (First-Year Student Exploring Hackathons)
- **Demographics:** 19 years old, 1st-year Computer Programming student who has never attended a tech event.
- **Device & Environment:** Campus computer lab desktop workstation (1920x1080 resolution, Chrome desktop).
- **Technical Background:** Novice. Learning basic Python and web scripting; intimidated by high-pressure competitive environments.
- **Goals & Motivations:** Explore suitable events and learning-oriented teams before committing to registration.
- **Pain Points:** Skeptical of platforms that force immediate account registration or credit card entry just to view event listings.
- **Workflow:** Lands on the HackMatch homepage via a campus Discord flyer link on her lab desktop. Browses verified hackathon listings and anonymized team previews, notices Jordan’s "Learning" goal, and uses Google primary sign-in followed by mandatory email OTP to create/access her PART account. She can then filter teams and apply.

---

## Project Stakeholders

Direct users (PART and ADMIN) are stakeholders too. The groups below have external or academic interests and no MVP account permissions. They do not confer implementation authority through hypothetical personas.

### External Stakeholders: Hackathon Organizers and Campus Clubs

- **Role Identifier:** STAKE-EXT (stakeholder label, not account role).
- **Description:** Publish official event information that ADMIN checks when creating/verifying canonical records. Examples include collegiate event committees and clubs; no partnership or endorsement is claimed.
- **Primary Goals:** Accurate dates/eligibility/team rules; participants forming valid teams; fewer duplicate or misleading event records.
- **Technical Expertise:** Variable event operations/web literacy; no HackMatch console required.
- **Key Characteristics:** External source of official event rules and possible future self-service users. Event-configured limits vary; there is no universal four-person requirement.
- **Constraints or Pain Points:** HackMatch verification does not replace official registration or make a team eligible. Later roster export is optional information whose acceptance by an organizer must be established, not presumed.
- **Traceability:** [US-009](../02_user_stories/user_stories.md#us-009), [US-010](../02_user_stories/user_stories.md#us-010), [FR-085](../04_requirements/functional_nonfunctional_requirements.md#fr-085); later [US-024](../02_user_stories/user_stories.md#us-024). No ticketing, payments, judging or full scheduling is included.

### Academic Stakeholders: Course Professor and Evaluators

- **Role Identifier:** STAKE-ACAD (stakeholder label, not account role).
- **Description:** Evaluate COMP313 deliverables, traceability, scope realism and engineering quality; no application role is needed.
- **Primary Goals:** Both required Markdown and Word deliverables, evidence-based proposal with at least 20 references, detailed testable FR/NFR coverage, secure and usable MVP.
- **Technical Expertise:** Software-development and academic evaluation expertise.
- **Key Characteristics:** Supplied feedback includes email OTP in FR and NFR, 10-minute expiry, account lock for 15 minutes after 5 incorrect OTP attempts, and tablet/phone orientation support. Specific libraries, numerical matching weights and enterprise traffic targets are not attributed to the professor.
- **Constraints or Pain Points:** The Word timeline must focus on Must-Have MVP work; detailed stories stay in Markdown unless its template asks otherwise. MVP target November 29, 2026; final report December 13, 2026; final delivery/presentation December 18, 2026. Sprint 1 is October 25, 2026.
- **Traceability:** [Current backlog](../02_user_stories/user_stories.md), [MVP milestones](../03_mvp/mvp_definition.md), and [requirements/policy register](../04_requirements/functional_nonfunctional_requirements.md#policy-register). Citation style must be consistent; IEEE is not asserted as mandatory where the template allows alternatives.

---

## Security Boundaries & Anti-Users

Threat actors represent unauthorized entities whose motivations directly oppose system security, user privacy, and platform integrity. Modeling these boundaries ensures non-functional security and moderation requirements are grounded in defensive specifications:

1. **Commercial Scraper / Talent Harvester (`THREAT-SCRAPE`):** Automated bot scripts or aggressive third-party recruiters attempting to harvest student emails, GitHub profiles, and portfolio data without consent. Mitigated by public-data redaction and the proposed 60 requests/minute/IP limit (R-07). These controls do not guarantee that scraping is impossible; shared-network impact must be tested.
2. **Phishing Impersonator / Griefing Troll (`THREAT-TROLL`):** Malicious actors seeking to submit fake hackathon postings with phishing links, post abusive or harassing team descriptions, or flood team leads with spam applications. Mitigated by private pending submissions, ADMIN approval before publication/recruitment, safe URL/content handling, proposed application limits, account suspension and basic action records. Full participant reporting/audit review arrives after MVP.
