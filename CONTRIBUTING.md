# HackMatch Contributing Guide

Welcome to the HackMatch development repository. This guide defines how the team works with branches, commits, GitHub issues, time tracking, testing, pull requests, and team communication. Every developer is expected to follow these practices for every User Story and task.

---

## 1. Prerequisites

Before starting development, make sure your local environment matches the project requirements:

- **Node.js:** `22.x LTS` (use `nvm use` to select the version specified in `.nvmrc`)
- **Package Manager:** `npm >= 10.x`
- **Git:** use LF line endings (`.gitattributes` configures this automatically)

Install the committed dependencies with:

```bash
npm ci
```

---

## 2. Branching Workflow — One Shared Branch per User Story

HackMatch uses **one shared feature branch for each User Story**.

> **IMPORTANT:** Do not create a separate branch for each task. All developers assigned to tasks under the same User Story work on the shared User Story branch.

The shared User Story branch is created from the latest `main` branch. Individual task issues remain separate in GitHub for ownership, estimates, time tracking, and traceability, but they do **not** receive separate Git branches.

### Branch naming convention

Use the following format:

```text
feature/US-<number>-<short-description>
```

Rules:

- Use the User Story ID exactly as it appears on GitHub, zero-padded to three digits.
- Use lowercase words separated by hyphens for the short description.
- Keep the description concise and representative of the complete User Story.

Examples:

```text
feature/US-001-participant-registration
feature/US-004-email-otp-login-verification
feature/US-012-team-listing-management
```

### Creating a new User Story branch

Only create the branch if the User Story does not already have a shared branch.

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/US-001-participant-registration
git push -u origin feature/US-001-participant-registration
```

### Joining an existing User Story branch

If another team member already created the User Story branch, do not create another branch for your task. Fetch the repository and switch to the shared branch:

```bash
git fetch --prune origin
git switch feature/US-001-participant-registration
git pull --ff-only origin feature/US-001-participant-registration
```

### Shared-branch collaboration rules

Because several developers may work on the same User Story branch at the same time:

1. Pull the latest shared branch before starting work.
2. Coordinate with teammates before changing files that another task is actively modifying.
3. Keep commits small and focused on your assigned issue.
4. Push regularly so the team can see your progress.
5. Pull again before pushing when other developers may have updated the branch.
6. Resolve merge conflicts carefully and do not overwrite another developer's work.
7. Never commit directly to `main`.

The intended branch structure is:

```text
main
 └── feature/US-001-participant-registration
      ├── commits for task #14
      ├── commits for task #15
      ├── commits for task #16
      └── commits for the remaining US-001 tasks
```

There are **no separate task branches** under the User Story branch.

---

## 3. Commit Message Standards

Commit messages must satisfy both the repository's Conventional Commits rules and the team's GitHub ticket traceability requirement.

### Format

```text
<type>(<optional scope>): <description> (#<issue-number>)
```

Allowed types:

- `feat`: new feature or User Story capability
- `fix`: bug fix
- `chore`: tooling, configuration, or dependency updates
- `test`: adding or refactoring tests
- `docs`: documentation updates
- `refactor`: code refactoring without behavior change

Examples:

```text
feat(database): add participant account record (#16)
test(database): verify participant account constraints (#16)
fix(auth): prevent duplicate registration submission (#15)
docs(us-001): add registration ER diagram (#16)
```

Commit messages are validated by `husky` and `commitlint`, so follow this format consistently.

### Commit practices

- Make small, focused commits.
- Each commit should relate clearly to one task/ticket whenever possible.
- Push regularly so the team can see your progress.
- Do not combine unrelated changes into a single commit.

---

## 4. Updating the GitHub Ticket After Each Commit

After each meaningful commit, add a comment to the GitHub issue for the task you are working on.

The comment should include:

1. Commit hash and commit message.
2. Shared User Story branch name.
3. Short description of the work completed.
4. Estimated hours for the ticket.
5. Actual hours spent so far or on that completed piece of work.
6. A variance explanation when required by the 30% rule.

### Ticket comment template

```markdown
**Commit:** `a1b2c3d` - feat(database): add participant account record (#16)
**Branch:** `feature/US-001-participant-registration`

**Work done:**
- Added the core participant account persistence changes for Issue #16.
- Added the related validation and database tests.

**Estimated:** 2 h
**Actual:** 2.5 h

**Variance explanation:** Not required because the actual time is within 30% of the estimate.
```

Use `git log --oneline -1` to copy the latest commit hash and message when needed.

---

## 5. Time Tracking Rules

### Hours only

Record all estimates and actual time in **hours only**.

Examples:

```text
0.5
2
4
6.5
```

Do not use days, story points, or minutes.

### Where to enter the estimate

Before starting a task, enter its estimate in the GitHub issue:

```text
Projects -> HackMatch Tickets -> Project fields -> Estimate
```

Enter the number of hours only.

### The 30% variance rule

Compare actual time against the original estimate when updating or closing the ticket.

| Situation | Required action |
|---|---|
| Actual time is **30% or more above** the estimate | Explain why it took longer, such as blockers, underestimated scope, unfamiliar technology, or bugs discovered. |
| Actual time is **30% or more below** the estimate | Explain why it took less time, such as reused code, smaller scope, or overestimation. |
| Actual time is **within 30%** of the estimate | No variance explanation is required. |

Example for a `4 h` estimate:

- `5.2 h` or more: explain the overrun.
- `2.8 h` or less: explain the underrun.
- Between `2.8 h` and `5.2 h`: no explanation required.

These explanations help the team improve future estimates during Sprint planning and retrospectives.

---

## 6. Testing and the Independence Rule

All unit and integration tests must run **offline without hitting live Firebase or Supabase endpoints**.

- Never commit `.env` files.
- Never commit credentials, secrets, API keys, service-role keys, private keys, passwords, OTPs, tokens, or session credentials.
- Use mocks, adapters, stubs, fixtures, or test doubles for external services.
- Keep test data isolated and repeatable.
- Ensure tests do not depend on another developer's unfinished task unless the team has explicitly coordinated that dependency.

Before opening a Pull Request, run:

```bash
npm run lint
npm run typecheck
npm run build
npm run test
```

All commands must complete successfully.

---

## 7. Pull Request Process

A Pull Request is opened **once the User Story is complete and all of its associated tasks are finished or otherwise resolved by the team**.

The PR is opened from the shared User Story branch directly into `main`.

### Before opening the PR

Make sure the shared User Story branch contains the latest `main` changes and resolve any conflicts before requesting review.

```bash
git switch feature/US-001-participant-registration
git fetch --prune origin
git merge origin/main
```

Do not rewrite shared branch history with force pushes unless the entire team explicitly agrees.

### PR target

```text
feature/US-XXX-<description> -> main
```

Example:

```text
feature/US-001-participant-registration -> main
```

### PR title

Use:

```text
US-001: Participant registration and verification
```

### PR description

Complete `.github/pull_request_template.md` and include at minimum:

- User Story ID and link.
- List of completed task/ticket numbers.
- Course rubric categories addressed.
- Total estimated hours vs. total actual hours.
- Summary of the implemented behavior.
- How reviewers can test the changes.
- Terminal logs or screenshots demonstrating test passage where appropriate.
- Relevant diagrams, screenshots, or other evidence when required.

### Review requirements

1. Assign at least one reviewer.
2. Notify the reviewer on Teams or WhatsApp and include the PR link.
3. Do **not** merge your own PR without approval from another team member.
4. Address review comments before merging.
5. Merge only after the required quality checks pass.

---

## 8. Taking More Work

Once your assigned ticket is complete, or your User Story work is waiting for review, you may pick up additional work from the backlog.

Before starting another ticket:

1. Assign yourself to the GitHub issue.
2. Move the issue to the correct status in the project board.
3. Confirm that another developer is not already working on it.
4. Enter the estimate before beginning.
5. If the ticket belongs to a different User Story, switch to that User Story's shared branch rather than creating a task branch.

---

## 9. Communication with the Agile Customer and Team

Keep the Agile Customer and team informed of meaningful changes to the work.

Communicate when:

- you start a new User Story or task;
- scope, estimates, or priorities change;
- you discover a blocker or dependency;
- a Pull Request is opened;
- a Pull Request is merged;
- a design decision affects other developers or User Stories.

Use the team's agreed communication channel, such as Teams or WhatsApp. Keep messages concise and include links to the relevant GitHub issue, User Story, or Pull Request whenever possible.

---

## 10. Shared User Story Branch Safety

Because HackMatch uses one shared branch per User Story, follow these additional rules carefully.

### Before starting work

```bash
git switch feature/US-XXX-<description>
git pull --ff-only origin feature/US-XXX-<description>
```

### Before pushing

Check the branch state:

```bash
git status
git fetch origin
git pull --ff-only origin feature/US-XXX-<description>
```

Then push your commits:

```bash
git push origin feature/US-XXX-<description>
```

If the pull cannot fast-forward because of concurrent work, stop and resolve the situation carefully rather than forcing the push.

### Coordination expectations

- Tell teammates when you are about to modify a high-conflict file.
- Avoid large unrelated refactors while other developers are working on the same User Story.
- Prefer additive, focused changes whenever possible.
- Do not reset, rebase, or force-push shared branch history without explicit team agreement.

---

## 11. Quick Checklist

Before starting a task:

- [ ] Confirm the correct shared User Story branch already exists, or create it from the latest `main` if you are responsible for starting the User Story.
- [ ] **Do not create a separate task branch.**
- [ ] Switch to the shared `feature/US-XXX-<description>` branch and pull the latest changes.
- [ ] Assign yourself to the GitHub task.
- [ ] Move the task to the correct project status.
- [ ] Enter the estimate in hours before starting.

While working:

- [ ] Keep commits small and focused.
- [ ] Use Conventional Commits with the GitHub issue number.
- [ ] Push regularly.
- [ ] Add a GitHub issue comment after each meaningful commit.
- [ ] Track actual hours.
- [ ] Coordinate before modifying files another teammate is actively changing.
- [ ] Keep the Agile Customer/team informed of blockers or scope changes.

Before the User Story PR:

- [ ] All User Story tasks are complete or resolved.
- [ ] Variances of 30% or more are explained.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] `npm run test` passes.
- [ ] PR is opened from the shared User Story branch into `main`.
- [ ] PR description includes story/task traceability, estimates/actuals, testing instructions, and evidence.
- [ ] Reviewer is assigned and notified.
- [ ] Another team member approves before merge.

---

## 12. Workflow Summary

For every User Story, the workflow is:

```text
latest main
    |
    v
feature/US-XXX-<user-story-description>
    |
    |-- all developers assigned to that User Story work here
    |-- each developer commits against their own GitHub task/ticket
    |-- no separate task branches are created
    |
    v
Pull Request
    |
    v
main
```

The GitHub issues provide task-level ownership and traceability. The Git branch represents the complete User Story.
