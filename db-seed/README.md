# HackMatch Demo Database Seed

This operator-only tool provisions six deterministic demo identities and the `recruitment-v1` scenario across Firebase Authentication and Supabase/PostgreSQL. It is intended for local development, repeatable testing, demonstrations, and Sprint presentations.

## Shared Database Safety

The HackMatch development database is shared by the team. Coordinate with all team members before running any seed, password-rotation, or reset command.

Before running the scripts:

1. Confirm that another team member is not currently running a seed or reset operation.
2. Check whether the `recruitment-v1` scenario has already been applied.
3. Capture the current counts of the affected database tables with a visible date/time for reference.
4. Run `npm run demo:seed -- --check --scenario recruitment-v1` before using `--apply`.
5. Review the check output and confirm that the Firebase and Supabase targets are the intended HackMatch development environments.
6. Do not use `--rotate-password`, `demo:reset -- --scenario-only`, or `demo:reset -- --all` without coordinating with the team first.

The normal `demo:seed -- --apply` operation is idempotent. Rerunning it reconciles the deterministic manifest-owned records rather than creating duplicate demo data. This has been verified by running the seed twice and confirming that the second run reported the existing Firebase and PostgreSQL accounts as unchanged.

Reset and password-rotation operations can still affect shared demo accounts and data, so they require additional team coordination.

## Structure

- `manifests/` contains deterministic account labels, UUIDs, profiles, availability, and recruitment relationships. It contains no email addresses or passwords.
- `src/` contains manifest validation, Firebase and PostgreSQL reconciliation, graph creation/reset, verification, and the CLI.
- `.runtime/` is created after a successful apply and is Git-ignored. Its index contains masked email labels and deterministic IDs only.
- [`../json-file-management/`](../json-file-management/) contains safe human-readable values for manual testing.

## Required environment

The CLI uses the existing server-side Firebase Admin and Supabase service-role configuration:

```text
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY

HACKMATCH_DEMO_NAMESPACE=hm-demo-v1
HACKMATCH_DEMO_EXPECTED_FIREBASE_PROJECT_ID
HACKMATCH_DEMO_EXPECTED_SUPABASE_HOST
HACKMATCH_DEMO_ALLOW_REMOTE=false

HACKMATCH_DEMO_ADMIN_OPS_EMAIL
HACKMATCH_DEMO_ADMIN_SAFETY_EMAIL
HACKMATCH_DEMO_AVERY_EMAIL
HACKMATCH_DEMO_BLAKE_EMAIL
HACKMATCH_DEMO_CASEY_EMAIL
HACKMATCH_DEMO_DREW_EMAIL
HACKMATCH_DEMO_PASSWORD
```

`HACKMATCH_DEMO_EXPECTED_SUPABASE_HOST` is the URL host, including a port when present, such as `127.0.0.1:54321`. Remote Supabase hosts are rejected unless the expected host matches **and** `HACKMATCH_DEMO_ALLOW_REMOTE=true`. Production mode is always rejected.

Emails are normalized exactly like HackMatch registration: trim and lowercase only. Plus-address tags are retained. Application/database uniqueness therefore permits distinct plus aliases when Firebase and the email provider also treat them as distinct; the CLI still fails closed if any six resolved addresses collide in Firebase or PostgreSQL. Confirm that the chosen mailbox provider delivers each alias before a live demo.

## Commands

Read-only validation and reconciliation plan:

```bash
npm run demo:seed -- --check --scenario recruitment-v1
```

Apply and verify:

```bash
npm run demo:seed -- --apply --scenario recruitment-v1
```

Rotate existing demo passwords only when explicitly requested:

```bash
npm run demo:seed -- --apply --scenario recruitment-v1 --rotate-password
```

Remove the scenario but keep the six Firebase/PostgreSQL accounts:

```bash
npm run demo:reset -- --scenario-only --apply --scenario recruitment-v1 --confirm hm-demo-v1
```

Remove the scenario, exact PostgreSQL accounts, and exact Firebase UIDs:

```bash
npm run demo:reset -- --all --apply --scenario recruitment-v1 --confirm hm-demo-v1
```

No seed writes occur without `--apply`. Reset additionally requires an exact `--confirm hm-demo-v1`. `--check` reads current Firebase/PostgreSQL state but performs no writes and does not create a runtime index.

## Accounts and scenario

| Account | Role | Demonstration purpose |
|---|---|---|
| Admin Ops | ADMIN | Account enforcement and authorization |
| Admin Safety | ADMIN | Moderation and second-admin behavior |
| Avery | PART / contextual Team Lead | Owns the open Civic Signal team |
| Blake | PART | Confirmed on locked Campus Compass, manually LFT-enabled, and invited to Civic Signal |
| Casey | PART | LFT-enabled AI/ML candidate with a pending Civic Signal application |
| Drew | PART / contextual Team Lead | Owns locked Campus Compass |

`Civic Signal` has three open vacancies: Backend has Blake’s pending invitation, AI/ML has Casey’s pending application, and UI/UX has no request. `Campus Compass` is locked at the minimum two-member boundary with Drew and Blake confirmed. Capacity is four.

Each team has a deterministic, Published backend shadow event with minimum size 2, maximum size 4, and a stable future end date. These rows exist only because current PostgreSQL constraints/RPCs still require `event_id`; they are not user-facing hackathons and are omitted from the copy/paste JSON.

## Firebase, roles, and MFA

Firebase reconciliation looks up both exact deterministic UID and normalized email, refuses split ownership, creates missing users, preserves unrelated custom claims, and reconciles only the `role` claim. Existing passwords are unchanged unless `--rotate-password` is supplied. Refresh tokens are revoked after role changes, password rotation, or re-enabling a disabled owned account.

Seeded accounts are pre-verified in Firebase and PostgreSQL, but actual HackMatch sign-in still requires the normal email OTP/MFA flow. The seed never creates an OTP, OTP hash, token, session, or `mfa_auth_time` claim and does not disable MFA.

## Idempotency and safety

An apply validates targets and manifests, reconciles exact Firebase identities, reconciles exact participant rows, deletes only manifest-owned graph/profile/availability IDs, recreates the deterministic graph, reapplies final platform-wide LFT states after membership triggers, verifies every invariant, prints a redacted summary, and writes the ignored runtime index.

ADMIN rows never receive participant profiles. Only the six deterministic owned accounts may have suspension/deactivation state cleared. A PostgreSQL account failure compensates by deleting Firebase accounts created during that same run only; pre-existing Firebase accounts are never removed as compensation.

Scenario reset uses exact manifest IDs in reverse dependency order. Full reset then deletes exact participant UUIDs and exact Firebase UIDs; it never enumerates Firebase users or deletes by domain, display name, or UID prefix. If unrelated records—such as manually authored chat content—reference a demo participant, PostgreSQL deletion fails safely rather than deleting that unrelated content.

The current participant schema also includes US-030 presence. Reconciliation deliberately preserves an existing demo account’s presence value and relies on the database default for newly inserted accounts because presence is unrelated to the recruitment scenario.

## Verification and tests

```bash
npm run demo:test
npm run demo:typecheck
npm run demo:lint
```

Automated tests use in-memory Firebase/PostgreSQL doubles and never perform external writes. A successful apply additionally verifies roles, verified/active state, profile restrictions, team ownership/state/capacity, membership, vacancies, requests, invitation expiry, and final platform-wide availability.
