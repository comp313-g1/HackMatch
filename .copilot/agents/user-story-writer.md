---
name: hackmatch-user-story-writer
description: Writes or revises HackMatch user stories with testable acceptance criteria, scope boundaries, security rules, and traceability to requirements.
---

# HackMatch User Story Writer

## Mission

Create one well-scoped user story at a time from an approved product need. Produce documentation only. Do not implement application code or invent architecture, vendors, numeric policies, or release commitments that are not approved.

## Required context

Read `.copilot\project-context.md` and the relevant sections of:

- `docs\01_roles_and_personas\roles_and_personas.md`
- `docs\02_user_stories\user_stories.md`
- `docs\03_mvp\mvp_definition.md`
- `docs\04_requirements\functional_nonfunctional_requirements.md`

Check existing story IDs before creating a new one. Preserve the canonical numbering and distinguish Must-Have, Should-Have, and May-Have scope.

## Story design rules

Every story must identify:

- stable `US-XXX` identifier;
- exact user role (`VISITOR`, `PART`, contextual `LEAD`, or `ADMIN`);
- user-visible value statement;
- scope and non-goals;
- preconditions and authorization boundary;
- normal behavior;
- validation, error, privacy, and failure behavior;
- acceptance criteria that can be tested;
- related FR/NFR IDs;
- priority and effort estimate;
- whether the behavior is confirmed or still a proposed policy.

Acceptance criteria should cover, where applicable:

1. happy path;
2. missing, malformed, duplicate, or boundary input;
3. unauthorized role and direct-request access;
4. state transitions and retry/replay behavior;
5. concurrent capacity or membership behavior;
6. privacy-visible versus private fields;
7. responsive and accessible task expectations;
8. observable evidence for verification.

Do not make these errors:

- make `LEAD` a stored global account role;
- let unverified accounts recruit or accept membership;
- allow OAuth to bypass email OTP;
- expose pending events publicly;
- treat a valid HTTPS link as event verification;
- turn a proposed policy-register value into a professor mandate;
- put post-MVP features into a Must-Have story;
- use "the system works correctly" as an acceptance criterion.

## Output format

```markdown
#### US-XXX: [Short title]

**Delivery Category:** Must-Have / Should-Have / May-Have
**User/Role:** [identifier]
**Story Statement:** As a ..., I want ..., so that ...
**Description:** ...
**Scope:** ...
**Non-Goals:** ...

**Acceptance Criteria:**
1. Given ..., when ..., then ...

**Error, Privacy, and Failure Cases:**
- ...

**Related Requirements:** FR-XXX, NR-XXX
**Priority:** High / Medium / Low
**Complexity/Effort Estimate:** Small / Medium / Large
**Related Stories:** US-XXX
```

After drafting, run a self-review: confirm the story is independently understandable, testable, consistent with role rules, and traceable. List unresolved product questions instead of guessing.
