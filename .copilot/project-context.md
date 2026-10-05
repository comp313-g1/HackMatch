# HackMatch Project Context

## Product

HackMatch is a responsive browser application for forming teams around verified hackathon events. It connects Participants looking for teams with Participants recruiting for event-specific openings. It does not provide ticketing, payments, judging, attendee registration, full event scheduling, native mobile apps, or in-app chat.

## Roles and authorization model

| Identifier | Meaning | Stored account role? | Core access |
|---|---|---|---|
| `VISITOR` | Unauthenticated visitor | No | Browse verified events and anonymized team vacancies |
| `PART` | Participant account | Yes | Profile, availability, browsing, applications, invitations, event submissions |
| `LEAD` | Team owner context | No | A `PART` who owns one team; manages vacancies, recruitment, decisions, and roster lock for that team |
| `ADMIN` | Platform administrator | Yes | Event verification, lifecycle management, account controls, moderation, action records |

Never model `LEAD` as a separate global role. A Participant can be a Team Lead for one event and a regular member elsewhere. External organizers and academic stakeholders do not receive application permissions from the documentation.

## MVP boundary

The MVP contains exactly 20 Must-Have stories:

`US-001` through `US-006`, `US-008` through `US-013`, `US-015`, `US-017` through `US-020`, `US-022`, `US-026`, and `US-027`.

The seven Should-Have stories and two May-Have stories remain outside the MVP unless the team explicitly changes the baseline. The planned MVP implementation target is November 29, 2026. Sprint 1 is October 25, 2026; final delivery/presentation is December 18, 2026.

## Security and integrity invariants

- All primary login routes require email OTP before a usable session.
- OTP expires after 10 minutes.
- Five incorrect OTP attempts lock the account for 15 minutes and invalidate outstanding challenges.
- Password recovery does not bypass OTP or clear an OTP lock.
- Public registration cannot choose or create `ADMIN`.
- Pending event submissions are private to the submitter and ADMIN.
- Only verified events enable availability, teams, invitations, applications, and roster actions.
- A confirmed Participant cannot belong to two teams for one event.
- Invitation acceptance and application approval must recheck eligibility and capacity atomically.
- Confirmed placement clears relevant availability and competing pending requests as specified.
- Locked teams do not accept ordinary membership changes.
- Visitors cannot see participant identities, handles, portfolio links, or private contacts.
- Optional shared contact handles are visible only to confirmed teammates and access is revoked after leaving/removal.
- Logs and diagnostics must not contain passwords, OTPs, reset/verification tokens, session credentials, or private contact/note content.

## Documentation interpretation

The requirements policy register contains both confirmed direction and proposed defaults. Agents must label these separately. A proposed threshold is not a demonstrated quality result. A research citation supports rationale, not proof of product demand or compliance.

The Sprint 1 task backlog requires independent, non-blocking tasks. Agents must not convert story-level relationships into implementation blockers when a mock, fixture, local stub, or isolated test can make a task independently reviewable.
