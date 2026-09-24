# User Roles and Personas

## Overview

HackMatch helps participants form teams before a hackathon. Following the professor's template, the MVP roles below each have a description, goals, technical expertise, characteristics, constraints, and personas. Team-specific permissions, unauthenticated visitors, stakeholders, and threat actors are distinguished from account roles.

The MVP account roles are Participant (`PART`) and Platform Administrator (`ADMIN`). Team Lead is a Participant who owns a particular team, not a global account role. Visitors have no stored role.

---

## User Role 1: Hackathon Participant

**Role Identifier:** `PART`

**Description:** A student, recent graduate, or independent hacker seeking teammates. Participants include developers, designers, and other contributors. They sign in with email-based login 2FA, maintain profiles with skills, stack, experience, school, goals, availability, and portfolio links, browse hackathons and open team listings, apply to teams, and accept or decline invitations. Regular participants browse and filter open teams; they do not receive algorithmic team recommendations in the MVP.

**Primary Goals:**
- Present skills and goals clearly in a profile.
- Find an event and declare availability for it.
- Browse and filter open teams, then apply or respond to an invitation.
- Join a confirmed team before the event begins.

**Technical Expertise:** Variable, from first-time hackers and designers to experienced developers.

**Key Characteristics:**
- May contribute development, design, or another project skill.
- Has limited time to assess team fit before an event.
- May seek teammates outside an existing school or social circle.

**Constraints or Pain Points:**
- Unstructured channels make skills and commitment hard to compare.
- A user cannot belong to more than one confirmed team for the same hackathon.

**Personas:**

### Persona 1.1: Nisha Sharma (Frontend Specialist Seeking Systems Teammate)
- **Demographics:** 21 years old, 3rd-year Software Engineering student at Centennial College.
- **Technical Background:** Proficient in React, Tailwind CSS, and Figma; basic Node.js knowledge; limited SQL/database experience.
- **Goals & Motivations:** Wants to win a category prize at an upcoming regional collegiate hackathon. Needs a reliable backend/API partner to handle database architecture and deployment.
- **Pain Points:** Tired of scouring 500+ unorganized messages on Discord. Reluctant to reach out to strangers without knowing their actual technical competency and commitment level.
- **Workflow:** Signs in with email-based login 2FA, selects an upcoming hackathon, filters open teams for compatible goals and skill needs, and applies to a suitable team.

### Persona 1.2: Omar Vance (Self-Taught Mobile Dev with Strict Availability)
- **Demographics:** 24 years old, career changer enrolled in an accelerated diploma program; works part-time on Friday evenings.
- **Technical Background:** Intermediate Flutter and Kotlin; comfortable consuming RESTful APIs.
- **Goals & Motivations:** Wants to build a portfolio-grade mobile prototype over the weekend to show potential employers.
- **Pain Points:** Past teams abandoned projects at 3:00 AM. Cannot afford to waste Saturday morning coordinating basics or working with teammates who only want to brainstorm and not code.
- **Workflow:** Records his availability for an event, links his GitHub repository, filters open teams for a compatible concept and schedule, and applies to a suitable team.

### Persona 1.3: Marcus Thorne (Accepted Teammate Seeking Active Collaboration)
- **Demographics:** 22 years old, 3rd-year Software Engineering Technology student at Centennial College.
- **Technical Background:** Intermediate backend developer; Node.js, Express, PostgreSQL, Git.
- **Goals & Motivations:** Wants to join an active team early to align on project architecture and repository setup before the event begins.
- **Pain Points:** Frustrated by joining teams where the team lead stops communicating or pivots the project unexpectedly, leaving him trapped on an inactive roster.
- **Workflow:** Accepts an invitation from a Team Lead, accesses his team view to retrieve teammate contact details, and coordinates setup. If the team stalls or becomes inactive prior to roster lock, he leaves the team to return to looking-for-team status.

---

## Team-Specific Responsibility: Team Lead

**Role Identifier:** `PART` with team-owner permission; no separate `LEAD` or `CAPT` account role.

**Description:** A Participant who creates and owns a team leads that team. For that team, the lead can manage its recruitment listing and open slots, review recommended participant candidates, send invitations, process applications, and confirm and lock the roster. The same person may lead one team and act as a regular Participant in another hackathon. Roster export is deferred unless needed for event check-in.

**Primary Goals:**
- Publish the team's project concept, goal, and open skill needs.
- Review candidate recommendations and send invitations.
- Approve or decline applications using a simple workflow.
- Confirm and lock a complete roster.

**Technical Expertise:** Variable; ownership depends on creating the team, not seniority.

**Key Characteristics:**
- Initiates team formation and coordinates recruitment.
- Values complementary skills and shared goals.

**Constraints or Pain Points:**
- Must respect event team-size limits and existing team membership.
- Cannot change membership after the roster is locked.

**Personas:**

### Team Lead Persona 1: Elena Rostova (Competitive Full-Stack Project Lead)
- **Demographics:** 23 years old, 4th-year Computer Science student, veteran of 5 hackathons (2 podium finishes).
- **Technical Background:** Advanced TypeScript, Python, Docker, PostgreSQL, AWS.
- **Goals & Motivations:** Has a refined concept for an AI-powered accessibility tool. Seeks 1 UI/UX designer and 1 machine learning student to complete a 4-person team.
- **Pain Points:** Wastes hours interviewing students who claimed "full-stack proficiency" but cannot write basic API routes or commit code to Git branches.
- **Workflow:** Creates the AccessiVision team listing with open skill slots, reviews rule-ranked participant candidates, processes applications, sends invitations, and locks the confirmed roster.

### Team Lead Persona 2: Jordan Lee (Collaborative First-Time Coordinator)
- **Demographics:** 20 years old, 2nd-year student attending their first major inter-university hackathon with a close classmate.
- **Technical Background:** Basic Java, Python, and HTML/CSS.
- **Goals & Motivations:** Wants to recruit two additional teammates who share a beginner-friendly, collaborative learning mindset.
- **Pain Points:** Intimidated by hyper-competitive teams; needs an easy, transparent way to recruit peers at a similar skill level without feeling judged.
- **Workflow:** Posts a beginner-friendly listing with open skill slots, reviews interested participants, and approves suitable applications after checking their profiles.

---

## User Role 2: Platform Administrator

**Role Identifier:** `ADMIN`

**Description:** A designated MVP user with a limited administrator interface. Administrators sign in with email-based login 2FA, create, update, and archive hackathon listings, and perform basic moderation of inappropriate team posts and accounts. Organizer submission queues, extensive reporting, and enterprise telemetry are outside this MVP role. Admin authority does not grant ownership of participant teams.

**Primary Goals:**
- Keep official hackathon listings current.
- Remove abusive posts and deactivate non-compliant accounts when needed.
- Restrict administrative functions to authorized users.

**Technical Expertise:** Comfortable checking event information and using a web administration interface.

**Key Characteristics:**
- Manages platform listings and basic safety across events.
- Keeps participant and administrator permissions distinct.

**Constraints or Pain Points:**
- Outdated events and misleading posts reduce trust.
- The course project calls for focused administration workflows.

**Personas:**

### Persona 2.1: Riley Miller (Student Hackathon Operations Lead)
- **Demographics:** 22 years old, final-year Computer Systems student and VP of Logistics for a student computing society.
- **Technical Background:** Proficient with web admin consoles, spreadsheet management, Discord community moderation, and basic SQL data lookups.
- **Goals & Motivations:** Keep campus hackathon listings accurate, ensure recruitment listings comply with student codes of conduct, and maintain platform credibility.
- **Pain Points:** Spammed with duplicate, misleading, or joke recruitment listings; needs a straightforward administrative dashboard to hide offensive posts and disable troll accounts.
- **Workflow:** Signs in with email-based login 2FA, updates official hackathon details, removes inappropriate team listings, and deactivates abusive accounts when reported.

---

## Unauthenticated Visitor

**Role Identifier:** None; there is no stored `GUEST` account role.

**Description:** A prospective user who can browse public hackathon information and privacy-safe previews of open team listings. Visitors cannot create profiles, apply, send invitations, or view private participant details until they register.

**Primary Goals:**
- Explore upcoming hackathons and available teams.
- Register to participate in team formation.

**Technical Expertise:** Variable.

**Key Characteristics:** Has no authenticated session or team permissions.

**Constraints or Pain Points:** Cannot interact with teams before registering.

**Personas:**

### Visitor Persona: Samira Khan (First-Year Student Exploring Hackathons)
- **Demographics:** 19 years old, 1st-year Computer Programming student who has never attended a hackathon.
- **Technical Background:** Learning basic Python and HTML; curious about hackathons but intimidated by high competition.
- **Goals & Motivations:** Wants to browse upcoming local student hackathons and see if there are teams welcoming beginners before she registers.
- **Pain Points:** Skeptical of platforms that force registration behind paywalls or immediate email requirements before showing any content.
- **Workflow:** Browses public hackathons and team listings, finds a beginner-friendly team, and registers to participate.

---

## Security and Threat Actors

Malicious scrapers, spammers, and unauthorized users are threat actors, not business stakeholders or assignable roles. Private data and protected actions must remain behind appropriate access controls. Detailed controls belong in the requirements document.

### Threat Scenario: "ScraperBot / Commercial Recruiter"
- **Profile:** Automated bot or aggressive third-party recruiter seeking to build an unconsented database of student developers for commercial placement.
- **Hostile Motivation:** Extract thousands of candidate records with minimal friction.
- **Target Seam:** Public hackathon participant directories and unredacted candidate cards.
- **Expected Platform Reaction:** Private account details remain unavailable to visitors and protected actions require authorization.
