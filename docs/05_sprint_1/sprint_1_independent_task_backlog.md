# HackMatch Sprint 1 Independent Task Backlog

**Sprint deadline:** October 25, 2026  
**Team size:** 6 developers  
**Product:** HackMatch responsive web application  
**Backlog scope:** The 20 canonical Must-Have MVP user stories  
**Source documents:** [User Stories](../02_user_stories/user_stories.md), [MVP Definition](../03_mvp/mvp_definition.md), and [Functional/Non-Functional Requirements](../04_requirements/functional_nonfunctional_requirements.md)

## How to use this backlog

This document breaks each MVP user story into small, volunteer-friendly tasks. Each task has one column for each team member. Volunteer for a task by marking your name column with `X`. Enter the actual time after completing the task. Estimated hours are planning estimates, not promises.

### Independence rule

Every task in this table is intentionally marked **No blocking dependency**. Developers may use mocks, fixtures, local stubs, temporary adapters, or test doubles when another part of the system is not ready. A task must not wait for another task to be completed before its own code, tests, and evidence can be produced.

If two tasks would edit the same file, the owners must coordinate before editing, split the file by responsibility, or create a short-lived integration branch. Coordination is allowed; blocking dependencies are not.

### Required workflow for every task

1. Claim the task by adding your name, branch, and expected completion date.
2. Create a Gitflow feature branch from the current integration branch, for example `feature/US-001-registration-form`.
3. Implement only the authorized scope of the task.
4. Add or update positive and negative tests where applicable.
5. Record evidence: test output, screenshot, log, API response, diagram, or review link.
6. Open a pull request with the user story and task IDs in the title.
7. A reviewer verifies the acceptance criteria before the task is marked Done.

## Volunteer instructions

- Mark `X` under your name to volunteer for a task. Only one person should normally mark a task.
- Enter actual hours after completing the task.
- If two people need the same task, discuss ownership before changing the table.
- Every task remains independently assignable; use mocks, fixtures, local stubs, or test doubles instead of waiting for another task.

## Sprint 1 rubric evidence plan

| Rubric area | Backlog evidence |
|---|---|
| Sprint goal and backlog | This document, task owners, estimates, priorities, status, dates, and pull requests |
| User stories and diagrams | Canonical stories plus use-case, architecture, class, ER/database, and flow diagrams linked from task evidence |
| Git repository and history | One focused branch/PR per task where practical, meaningful commits, and identifiable authorship |
| Initial working prototype | Working registration/login, profile, event, recruitment, team, and administration slices demonstrated through the prototype |
| Debugging and testing | Positive/negative test cases, validation tests, error handling, retests, screenshots, logs, and automated test output |
| Sprint demonstration | Demo script linked to completed task IDs, user stories, acceptance criteria, known limitations, and contributor ownership |

## Definition of Done for an implementation task

A task is **Done** only when:

- the implementation or artifact matches the linked user story and requirement IDs;
- valid, invalid, empty, unauthorized, and boundary cases relevant to the task are covered;
- the change does not grant access to the wrong role or expose private data;
- automated tests pass, or manual test evidence is attached when automation is not practical;
- the task has a focused commit and pull request;
- a second team member has reviewed the result;
- the evidence link or file path is recorded in this backlog.

## Cross-cutting independent tasks

These tasks support the assessment rubric and can be assigned in the same format. They do not block any user-story task.

| Task | Who | Estimate (hours) | Actual (hours) |
|---|---|---:|---:|
| Diagram matches the implemented browser, frontend, backend, authentication, and persistence boundaries |  |  |  |
| Visitor, PART, Team Lead, and ADMIN interactions match canonical stories |  |  |  |
| Account, profile, event, team, membership, request, and moderation concepts are consistent |  |  |  |
| Keys, roles, status values, and integrity rules are documented |  |  |  |
| Each MVP story has positive, negative, validation, authorization, and boundary scenarios |  |  |  |
| Each discovered defect has reproduction, cause, fix, and retest evidence |  |  |  |
| Core journeys are checked on desktop, tablet/iPad, and phone portrait/landscape layouts |  |  |  |
| Keyboard access, labels, focus, contrast, and error messaging are checked against the documented target |  |  |  |
| Valid users, roles, events, teams, requests, and moderation cases support isolated development and demos |  |  |  |
| Script covers verified event discovery through team creation, both joining routes, and locked roster |  |  |  |
| Branch naming, PR review, commit style, and merge workflow are documented |  |  |  |
| Screenshots/logs/test output map each completed story to the rubric |  |  |  |

## Gitflow and commit expectations

Use the professor-recommended [Gitflow workflow](https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow) unless the team agrees to a documented variation:

- `main` contains reviewed, demonstrable releases.
- `develop` contains the shared integration state.
- Each task starts from `develop` in a focused `feature/<task-id>-<short-name>` branch.
- Use `release/sprint-1` for final Sprint 1 stabilization and demo preparation.
- Use `hotfix/<short-name>` only for urgent defects in `main`.
- Pull requests should identify the task ID, story ID, acceptance criteria, tests, and evidence.
- Keep commits small and meaningful, such as `feat(US-001): add registration validation` or `test(US-004): cover OTP lockout`.
- Do not use one final bulk upload to hide individual contributions.

## Sprint completion gate

Before the October 25 demonstration, the team should review:

- all claimed tasks and their actual status;
- completed acceptance criteria for every demonstrated story;
- positive, negative, validation, authorization, and boundary test evidence;
- architecture and database diagrams against the implementation;
- the working prototype on the agreed browsers and device layouts;
- defect fixes and retest results;
- meaningful Git history and identifiable contributions;
- incomplete tasks and known limitations for the presentation.

The backlog is a planning and evidence artifact. The canonical user stories and requirements remain the source of truth for product behavior.
