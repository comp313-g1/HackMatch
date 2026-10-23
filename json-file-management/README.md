# HackMatch Demo JSON Reference

This directory provides safe, searchable, copy/paste-friendly reference data for manual testing and Sprint demonstrations.

- `participants.json` lists display names, handles, roles, skills, portfolio examples, preferences, and expected LFT states.
- `teams.json` describes Civic Signal and Campus Compass without exposing backend shadow events.
- `invitations.json` describes Blake’s pending Backend invitation.
- `applications.json` describes Casey’s pending AI/ML application.
- `expected-scenarios.json` contains short manual test flows and expected outcomes.

These files intentionally omit real email addresses, passwords, Firebase UIDs, PostgreSQL participant UUIDs, shadow-event IDs, tokens, OTPs, and private credentials. Resolve login email addresses from the operator-controlled environment variables documented in [`../db-seed/README.md`](../db-seed/README.md).
