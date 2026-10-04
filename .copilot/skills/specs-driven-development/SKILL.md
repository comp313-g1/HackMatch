---
name: hackmatch-specs-driven-development
description: Applies a documentation-first specs-driven workflow to HackMatch, preserving confirmed policies, explicit scope, contracts, acceptance scenarios, and human review gates.
---

# HackMatch Specs-Driven Development

## Purpose

Use this skill to turn HackMatch documentation into reviewed, traceable specification artifacts before implementation. It is deliberately documentation-only unless the user explicitly requests application implementation in a separate task.

## Phase 1: Establish the baseline

Read `.copilot\project-context.md`, then the canonical docs in this order:

1. roles and personas;
2. user stories;
3. MVP definition;
4. functional/non-functional requirements;
5. Sprint 1 independent task backlog;
6. generated `specs\` files, if present.

Report missing directories or files. Do not create a fake generated-spec result.

## Phase 2: Separate certainty levels

Label every policy as one of:

- **Confirmed direction:** explicitly agreed in the project documentation.
- **Proposed policy:** retained candidate default requiring team confirmation.
- **Target:** measurable acceptance ambition not yet demonstrated.
- **Out of scope:** excluded from the current release.

Especially distinguish policy-register numbers from professor requirements and measured production results.

## Phase 3: Build the specification set

When the user requests generated specs, use this structure:

```text
specs\
├── specs.md
├── implementation-plan.md
└── contracts\
    ├── interfaces.md
    ├── events.md
    └── domain.md
```

Keep contracts and diagrams in Markdown fenced blocks. Every specification should preserve the existing `US-XXX`, `FR-XXX`, and `NR-XXX` identifiers rather than renumbering them.

`specs.md` should contain:

1. problem statement;
2. scope and non-goals;
3. stakeholders and decision log;
4. user stories;
5. functional requirements;
6. non-functional requirements;
7. business rules and edge cases;
8. acceptance criteria and scenario catalog;
9. architecture and design decisions;
10. system diagrams;
11. operational and failure behavior;
12. engineering guardrails;
13. security and compliance;
14. review gates;
15. work breakdown and traceability map.

## Phase 4: Review gates

Do not mark a specification accepted until:

- every MVP story has testable acceptance criteria;
- every FR/NFR is linked to a story or cross-cutting concern;
- edge cases appear both in requirements and scenario rows;
- role and privacy boundaries are explicit;
- capacity and membership races are described;
- proposed versus confirmed policy is labelled;
- non-goals prevent scope expansion;
- evidence and reviewer ownership are named.

## Phase 5: Implementation handoff

Only after human approval, produce task briefs. Each brief must contain:

- task ID and wave or sprint;
- objective;
- story/requirement/acceptance links;
- authorized files or documentation scope;
- expected outputs;
- definition of done;
- required tests/evidence;
- no hidden dependency assumptions.

The human team remains responsible for accepting specs, reviewing generated output, running tests, and approving commits.
