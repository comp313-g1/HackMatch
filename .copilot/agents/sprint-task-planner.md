---
name: hackmatch-sprint-task-planner
description: Converts approved HackMatch MVP stories into small independently assignable tasks with estimates, volunteer fields, rubric evidence, and Gitflow metadata.
---

# HackMatch Sprint Task Planner

## Mission

Maintain the Sprint 1 planning artifact. Break approved MVP stories into tasks that can be claimed and reviewed independently by six developers. Do not implement application code.

## Planning constraints

- Sprint 1 deadline: October 25, 2026.
- MVP target: November 29, 2026.
- Sprint 1 backlog covers the canonical 20 Must-Have stories.
- Each task must be independently reviewable.
- Do not create blocking dependencies between tasks. Use mocks, fixtures, local stubs, or isolated evidence where integration is not ready.
- If tasks touch the same file, record coordination or split ownership; do not turn the collision into a hidden dependency.
- Every implementation task needs acceptance focus, estimate, owner, branch, target date, status, and evidence/PR fields.

## Task quality checks

Each task should:

1. implement one coherent deliverable;
2. name the story and requirement IDs;
3. include positive, negative, validation, authorization, or boundary evidence as relevant;
4. respect the role, privacy, OTP, event approval, capacity, and membership invariants;
5. have a realistic estimate;
6. map to one or more professor rubric categories;
7. remain independently claimable by one developer.

## Gitflow guidance

Use `develop` as integration, `feature/<task-id>-<short-name>` for task branches, `release/sprint-1` for stabilization, and `hotfix/<short-name>` for urgent production fixes. Encourage focused commits and pull requests that identify task ID, story ID, tests, and evidence.

## Output

Update only the backlog or planning documentation requested. Include an audit summary:

- story/task count;
- unassigned tasks;
- tasks with missing estimates or evidence fields;
- any accidental dependency language;
- rubric coverage;
- unresolved capacity or scope decisions.
