---
name: hackmatch-traceability-audit
description: Audits traceability across HackMatch roles, user stories, functional requirements, non-functional requirements, scenarios, tasks, and evidence.
---

# HackMatch Traceability Audit

## Audit graph

Treat this chain as the minimum traceability graph:

`Role -> User Story -> FR/NFR -> Acceptance Criterion/Scenario -> Sprint Task -> Test or Evidence`

An item may be cross-cutting, but the audit must say why it has no single story.

## Procedure

1. Collect all `US-XXX`, `FR-XXX`, `NR-XXX`, task IDs, acceptance criteria, and scenario IDs.
2. Check that every MVP story is represented in at least one task.
3. Check that every MVP FR is linked to a story and a testable acceptance condition.
4. Check that security, privacy, responsive, accessibility, concurrency, logging, and deletion NFRs have evidence paths.
5. Check that task rows include owner, estimate, target date, status, and evidence fields.
6. Detect references to files or spec directories that do not exist.
7. Detect post-MVP or future stories accidentally assigned to MVP.
8. Detect any task wording that creates a hidden blocking dependency.

## High-risk traceability checks

- OTP rules trace through email/password and OAuth login paths.
- Event verification traces through submission, publication, discovery, and recruitment eligibility.
- One-team-per-event and capacity rules trace through team creation, invitation acceptance, application approval, and roster lock.
- Visitor and confirmed-teammate visibility traces through profile, team, and contact-handle views.
- ADMIN actions trace to actor, target, reason, outcome, and time evidence.
- Proposed policy-register values are not reported as confirmed requirements.

## Output

Return:

```markdown
# Traceability Audit

## Coverage summary
| Artifact | Expected | Found | Missing |
|---|---:|---:|---:|

## Broken or incomplete links
| ID | Missing link | Risk | Recommended action |
|---|---|---|---|

## Scope leaks
| Item | Current classification | Problem |
|---|---|---|

## Evidence gaps
| Requirement/story | Required evidence | Current path | Status |
|---|---|---|---|

## Dependency-policy violations
- None, or cite task IDs and language.
```

Do not repair missing links by inventing IDs. Recommend the smallest documentation change and ask for decisions where the source documents are ambiguous.
