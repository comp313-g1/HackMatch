# User Roles and Personas

## Overview

This document defines the user roles and personas for **HackMatch**, a team-formation platform for hackathon participants. It establishes the target user types, their system permissions, operational boundaries, and behavioural profiles. 

In accordance with system design best practices and the project requirements, user roles represent functional categories and authorization boundaries within the system, while personas represent realistic instances of those roles. Every user story in downstream requirements documents links directly to a Role Identifier defined here.

---

## User Role 1: Hackathon Participant (Student Developer / Designer)

**Role Identifier:** `DEV`

**Description:** The primary consumer of HackMatch. A student, recent graduate, or independent hacker who attends hackathons and is seeking teammates. This role covers developers (frontend, backend, full-stack, mobile, AI/ML) as well as UI/UX designers and domain presenters. They create a verified profile detailing their skills, tech stack, experience level, academic institution, past project links (GitHub/Portfolio), and event availability. They browse upcoming hackathons, flag themselves as "Looking for Team", receive rule-based match recommendations, and accept or decline team invitations.

**Primary Goals:**
- Create and maintain a rich, standardized profile showcasing technical stack, design skills, portfolio links, and hackathon experience.
- Discover upcoming hackathons and declare participation and availability status for specific events.
- Receive high-signal teammate recommendations based on complementary skill sets, mutual goals (e.g., casual learning vs. competitive winning), and compatible time zones/schedules.
- Review incoming team invitations and join a balanced, committed roster before the event begins.

**Technical Expertise:** Medium to High — ranges from first-year computer science students familiar with basic web development to advanced developers experienced with Git, cloud tools, APIs, and command-line interfaces.

**Key Characteristics:**
- Highly active in text-first, async platforms (Discord, Slack, GitHub, Devpost).
- Typically possesses deep skill in one area (e.g., UI design, React frontend, Python backend) and urgently needs collaborators with complementary strengths.
- Constrained by academic deadlines, exams, and part-time jobs; requires rapid, low-friction matching.
- Seeks teammates beyond their immediate campus bubble or personal social network.

**Constraints or Pain Points:**
- **Asymmetric Commitment:** Frustration with past hackathons where unvetted teammates ghosted mid-weekend or had mismatched work ethics.
- **Signal-to-Noise Problem:** Overwhelmed by unstructured `#find-a-team` Discord channels where hundreds of messages scroll by without standardized skill tags.
- **Skill Incompatibility:** Joining a team only to realize all 4 members are pure frontend developers with no backend or database experience.

**Personas:**

### Persona 1.1: Priya Sharma (Frontend Specialist Seeking Systems Teammate)
- **Demographics:** 21 years old, 3rd-year Software Engineering student at Centennial College.
- **Technical Background:** Proficient in React, Tailwind CSS, and Figma; basic Node.js knowledge; limited SQL/database experience.
- **Goals & Motivations:** Wants to win a category prize at an upcoming regional collegiate hackathon. Needs a reliable backend/API partner to handle database architecture and deployment.
- **Pain Points:** Tired of scouring 500+ unorganized messages on Discord. Reluctant to reach out to strangers without knowing their actual technical competency and commitment level.
- **Workflow:** Signs in via GitHub, selects an upcoming hackathon, sets role filter to "Backend / Cloud", specifies target goal as "Competitive", and reviews matches who complement her frontend strengths.

### Persona 1.2: Marcus Vance (Self-Taught Mobile Dev with Strict Availability)
- **Demographics:** 24 years old, career changer enrolled in an accelerated diploma program; works part-time on Friday evenings.
- **Technical Background:** Intermediate Flutter and Kotlin; comfortable consuming RESTful APIs.
- **Goals & Motivations:** Wants to build a portfolio-grade mobile prototype over the weekend to show potential employers.
- **Pain Points:** Past teams abandoned projects at 3:00 AM. Cannot afford to waste Saturday morning coordinating basics or working with teammates who only want to brainstorm and not code.
- **Workflow:** Sets availability filter to "Saturday 8:00 AM – Sunday 2:00 PM EST", links his GitHub repository, and looks for teams with an established product concept ready for implementation.

---

## User Role 2: Team Captain (Team Creator / Recruiter)

**Role Identifier:** `CAPT`

**Description:** A contextual, team-level primary role assumed by any authenticated Participant (`DEV`) who initiates a team, posts an opening on the "Looking for Team" board, or owns a specific project concept. In addition to standard `DEV` permissions, the Team Captain holds managerial authority over a team instance: configuring the team listing, setting required skill slots, issuing direct invitations, accepting or rejecting join requests, and finalizing the locked roster before event submission.

**Primary Goals:**
- Define and publish a team recruitment listing specifying target hackathon, project concept, open skill requirements (e.g., "Need 1 UI/UX Designer, 1 ML Engineer"), and desired commitment level.
- Filter candidate profiles and issue direct team invitations to optimal fits.
- Evaluate incoming applications/join requests from interested participants.
- Lock and confirm the finalized roster to generate an exportable team summary for event check-in.

**Technical Expertise:** Medium to High — usually an intermediate or senior student with a clear technical roadmap, or an organized project lead capable of breaking down deliverables.

**Key Characteristics:**
- Proactive planner who initiates team building 1–3 weeks before the hackathon rather than the night of the event.
- Values team balance, communication clarity, and schedule alignment over raw headcount.
- Serves as the primary point of contact for external inquiries.

**Constraints or Pain Points:**
- **Roster Flaking:** Candidates accepting invites and then abandoning the team days before the hackathon without notification.
- **Application Overload:** Manually reviewing dozens of fragmented messages across LinkedIn, Discord, and email to compare candidate credentials.
- **Role Redundancy:** Accidentally over-recruiting for one discipline while leaving critical architectural gaps unfilled.

**Personas:**

### Persona 2.1: Elena Rostova (Competitive Full-Stack Project Lead)
- **Demographics:** 23 years old, 4th-year Computer Science student, veteran of 5 hackathons (2 podium finishes).
- **Technical Background:** Advanced TypeScript, Python, Docker, PostgreSQL, AWS.
- **Goals & Motivations:** Has a refined concept for an AI-powered accessibility tool. Seeks 1 UI/UX designer and 1 machine learning student to complete a 4-person team.
- **Pain Points:** Wastes hours interviewing students who claimed "full-stack proficiency" but cannot write basic API routes or commit code to Git branches.
- **Workflow:** Creates team profile "AccessiVision", tags required roles: `[UI/UX, PyTorch]`, sets milestone goals, reviews rule-ranked recommendations, and sends invitations with clear project briefs attached.

### Persona 2.2: Jordan Lee (Collaborative First-Time Coordinator)
- **Demographics:** 20 years old, 2nd-year student attending their first major inter-university hackathon with a close classmate.
- **Technical Background:** Basic Java, Python, and HTML/CSS.
- **Goals & Motivations:** Wants to recruit two additional teammates who share a beginner-friendly, collaborative learning mindset.
- **Pain Points:** Intimidated by hyper-competitive teams; needs an easy, transparent way to recruit peers at a similar skill level without feeling judged.
- **Workflow:** Posts a listing marked "Learning & Fun", sets team size to 4, filters for other first- or second-year students, and approves incoming requests after quick profile checks.

---

## User Role 3: Hackathon Organizer

**Role Identifier:** `ORG`

**Description:** A secondary administrative user representing an official student club, academic department, incubator, or corporate hackathon host (e.g., Major League Hacking chapter, collegiate tech club). Organizers publish and manage official event listings on HackMatch, providing accurate dates, event formats (in-person, hybrid, virtual), submission deadlines, venue/Discord links, track themes, and maximum team size limits. Organizers benefit from reduced team-formation chaos during event kickoff.

**Primary Goals:**
- Publish verified hackathon listings with complete event metadata (dates, format, themes, prize tracks, eligibility rules, external registration links).
- Monitor participant team-formation velocity for their event to forecast attendance and identify unassigned attendees.
- Update event announcements, venue details, or schedule adjustments that automatically notify linked participants.
- Export finalized team rosters to streamline check-in and platform submissions (e.g., Devpost synchronization).

**Technical Expertise:** Medium — proficient with web management platforms, event registration systems (Eventbrite, Hopin), and community management tools, but not necessarily a software engineer.

**Key Characteristics:**
- Operates under tight event deadlines with limited volunteer staff.
- Manages communications across fragmented channels (social media, campus flyers, university mailing lists, Discord).
- Accountable to sponsors, faculty, and attendees for event turnout and satisfaction.

**Constraints or Pain Points:**
- **Listing Desynchronization:** Event schedule updates on the main website fail to propagate to external community channels, causing student confusion.
- **Kickoff Friction:** Spending the first 2–3 hours of the hackathon running awkward, chaotic in-person mixer games to pair up 100+ unassigned students.
- **Listing Spam Risk:** Needing assurance that their official event brand cannot be spoofed or duplicated by unauthorized parties.

**Personas:**

### Persona 3.1: Alex Chen (Campus Tech Club Lead & Hackathon Director)
- **Demographics:** 22 years old, President of Centennial College Computing Society, lead organizer of "HackCentennial" (350 anticipated attendees).
- **Technical Background:** Competent with web administration, Markdown, Discord bots, and Google Workspace.
- **Goals & Motivations:** Ensure that at least 80% of registered solo participants are matched into balanced teams before Opening Ceremony, eliminating the day-one team formation bottleneck.
- **Pain Points:** Overwhelmed by managing Google Sheets and answering repetitive Discord DMs from solo attendees panicking about finding a team 30 minutes before hacking starts.
- **Workflow:** Submits event listing for "HackCentennial 2026" with max team size = 4, reviews published dashboard, and shares HackMatch event link in official registration confirmation emails.

---

## User Role 4: Platform Administrator

**Role Identifier:** `ADMIN`

**Description:** A tertiary administrative user responsible for the operational governance, data integrity, security, and content moderation of the HackMatch platform. Administrators manage user account disputes, verify event legitimacy submitted by organizers, handle abuse reports (e.g., harassment, hate speech, spam profiles, impersonation), manage rule-matching engine configurations, and monitor system health and audit logs.

**Primary Goals:**
- Review and verify hackathon listings submitted by `ORG` accounts before or shortly after public publishing.
- Investigate and adjudicate reports of abusive profiles, malicious links, or harassing messages.
- Manage user lifecycle (account suspension, credential revocation, data deletion requests under privacy laws).
- Maintain system stability, manage database backups, and inspect error logs.

**Technical Expertise:** High — software engineers or DevOps administrators with full access to cloud infrastructure, database management tools, security logging, and administrative portals.

**Key Characteristics:**
- Prioritizes user safety, platform trustworthiness, and operational uptime.
- Relies on structured dashboards, audit trails, and automated alerts rather than manual inspection.
- Enforces strict compliance with data privacy standards (protecting student email addresses and personal identity data).

**Constraints or Pain Points:**
- **Moderation Bottlenecks:** Lack of bulk-action moderation tooling leading to backlog during peak hackathon season (September–November and January–March).
- **Fraud & Spam Detection:** Preventing bad actors from using the platform to phish student GitHub accounts or post fraudulent recruitment links.
- **Balancing Automation with Human Review:** Need rule-based automation to flag suspicious activity without penalizing legitimate students.

**Personas:**

### Persona 4.1: Riley Miller (Lead Operations & Moderation Engineer)
- **Demographics:** 28 years old, Senior Systems Administrator / Open Source Maintainer.
- **Technical Background:** Expert in PostgreSQL, OAuth2/OIDC, Docker, RESTful security architectures, and logging systems.
- **Goals & Motivations:** Maintain 99.9% uptime during global hackathon weekends while keeping moderation response times under 2 hours for critical flags.
- **Pain Points:** Frustrated when user reports lack context or reproducible logs; needs an administrative panel that ties user reports directly to profile diffs and audit trails.
- **Workflow:** Logs into the HackMatch Admin Portal daily, reviews the moderation queue for flagged profiles, verifies pending organizer submissions, and inspects API latency metrics.

---

## User Role 5: Unauthenticated Visitor (Prospective User)

**Role Identifier:** `GUEST`

**Description:** A top-of-funnel prospective user who visits HackMatch without an authenticated session. Guests are granted strictly read-only access to discover public hackathon listings, view anonymized team recruitment boards, and inspect platform capabilities. Guests cannot create profiles, contact participants, view private student contact details, create teams, or issue invitations without completing registration. The primary purpose of this role is conversion.

**Primary Goals:**
- Explore active and upcoming hackathons to evaluate platform utility and event relevance.
- Preview active "Looking for Team" listings (with contact info and full profile data redacted).
- Evaluate platform security and privacy policies before committing personal student credentials.
- Register for an authenticated `DEV` or `ORG` account via a streamlined onboarding flow.

**Technical Expertise:** Variable — from complete novices to seasoned engineers exploring the platform for the first time.

**Key Characteristics:**
- Has zero persistent state in the system database.
- Evaluates the landing page and public directory within 15–30 seconds before deciding whether to bounce or register.
- Protected by zero-trust boundaries: restricted to public endpoints with strict rate limiting.

**Constraints or Pain Points:**
- Cannot interact with or message prospective teams without creating an account.
- Reluctant to register if the platform demands excessive private data before showcasing value.

**Personas:**

### Persona 5.1: Samira Khan (First-Year Student Exploring Hackathons)
- **Demographics:** 19 years old, 1st-year Computer Programming student who has never attended a hackathon.
- **Technical Background:** Learning basic Python and HTML; curious about hackathons but intimidated by high competition.
- **Goals & Motivations:** Wants to browse upcoming local student hackathons and see if there are teams welcoming beginners before she registers.
- **Pain Points:** Skeptical of platforms that force registration behind paywalls or immediate email requirements before showing any content.
- **Workflow:** Lands on HackMatch, clicks "Browse Hackathons", views the event card for HackCentennial, sees "14 teams looking for beginners", clicks "Register to Match", and completes account creation.

---

## User Role 6: Malicious Actor / Unauthorized Scraper (Anti-User)

**Role Identifier:** `ANTI`

**Description:** A true negative persona and architectural anti-user. This represents an entity whose goals directly oppose the platform's security, user privacy, and business objectives. This includes automated web scrapers attempting to harvest student emails and GitHub profiles, commercial recruiters attempting to bypass platform rules for unsolicited talent poaching, spammers posting phishing links on team boards, and malicious users attempting cross-site scripting (XSS) or unauthorized API access.

**Primary Goals (Hostile):**
- Scrape student personal identifying information (PII), emails, and portfolio data for bulk marketing or spam.
- Inject unauthorized links, commercial advertisements, or phishing URLs into "Looking for Team" posts.
- Circumvent rate limits and authentication controls to manipulate matching algorithms or flood team rosters.

**Key Characteristics:**
- Employs headless browsers, automated scripts, or disposable throwaway accounts.
- Exploits unauthenticated guest endpoints and unvalidated input fields.
- Exhibits atypical browsing velocity (hundreds of requests per minute).

**Architectural Defenses & System Constraints:**
- **Zero PII Exposure:** Guest endpoints never expose email addresses, phone numbers, or direct Discord handles; sensitive data requires authenticated sessions.
- **Rate Limiting & Bot Mitigation:** Aggressive IP-based and token-based rate limiting on all public search and auth endpoints.
- **Input Sanitization:** Strict schema validation and markdown sanitization on all user-submitted text fields (profiles, team descriptions, event listings) to neutralize XSS attacks.
- **Domain Whitelisting & Verification:** Optional academic email verification (`.edu`, `.ca` student domains) to discourage commercial recruiters and disposable spam accounts.

**Personas:**

### Persona 6.1: "ScraperBot / Commercial Recruiter"
- **Profile:** Automated bot or aggressive third-party recruiter seeking to build an unconsented database of student developers for commercial placement.
- **Hostile Motivation:** Extract thousands of candidate records with minimal friction.
- **Target Seam:** Public hackathon participant directories and unredacted candidate cards.
- **Expected Platform Reaction:** Access denied; public endpoints paginate and redact PII; bot detected by rate limiters and blocked with HTTP 429 / CAPTCHA challenge.