# HackMatch Copilot Configuration

This directory contains project-specific Copilot agents and skills for HackMatch's specs-driven development workflow.

## Source of truth

The current documentation baseline is:

1. `docs\01_roles_and_personas\roles_and_personas.md`
2. `docs\02_user_stories\user_stories.md`
3. `docs\03_mvp\mvp_definition.md`
4. `docs\04_requirements\functional_nonfunctional_requirements.md`
5. `docs\05_sprint_1\sprint_1_independent_task_backlog.md`

At the time these agents were created, the repository did not contain a generated `specs\` directory. Agents must report that fact when a task expects generated specs, then work from the documented baseline only. They must not silently invent missing contracts or claim that a generated spec exists.

## Available agents

| Agent | Use |
|---|---|
| `agents/spec-reviewer.md` | Audits specs and documentation for completeness, contradictions, ambiguity, and traceability |
| `agents/user-story-writer.md` | Converts an approved product need into a testable, traceable user story |
| `agents/role-validator.md` | Checks roles, authorization boundaries, privacy visibility, and contextual Team Lead permissions |
| `agents/sprint-task-planner.md` | Breaks approved MVP stories into independently assignable tasks and rubric evidence |

## Available skills

| Skill | Use |
|---|---|
| `skills/specs-driven-development/SKILL.md` | Runs the HackMatch document-to-spec workflow without implementing application code |
| `skills/traceability-audit/SKILL.md` | Checks links among user stories, requirements, acceptance scenarios, tasks, and evidence |
| `skills/sprint-evidence/SKILL.md` | Produces Sprint 1 review evidence and identifies missing proof for the professor's rubric |

## Non-negotiable project rules

- Only `PART` and `ADMIN` are stored account roles.
- `LEAD` is contextual ownership permission for a team; it is not a third account role.
- `VISITOR` is an unauthenticated state, not an account role.
- Every login route, including Google and GitHub, requires email OTP.
- OTP expires after 10 minutes; five incorrect attempts lock login for 15 minutes.
- Event submissions remain private until ADMIN approval.
- Only verified events support recruitment.
- Membership, capacity, and one-team-per-event rules must be checked atomically.
- Visitors receive anonymized views and must not receive private profile/contact data.
- MVP means the 20 Must-Have stories; Should-Haves and May-Haves are not silently pulled into MVP.
- Proposed policy-register numbers are not to be presented as professor mandates or achieved production guarantees.
- Agents may analyze and edit documentation/configuration artifacts, but must not implement application code unless the user explicitly requests a separate implementation task.

## Recommended invocation

Start with the relevant agent, then apply the related skill:

```text
Use .copilot/agents/spec-reviewer.md with .copilot/skills/traceability-audit/SKILL.md.
Review only the referenced documentation and return findings before making edits.
```

Each agent must identify its input files, preserve existing decisions, distinguish confirmed policy from proposed policy, and finish with a concise list of unresolved questions.
