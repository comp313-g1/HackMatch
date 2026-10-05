# Task List: Sprint 1 Task S1-P0-01 (Scaffolding & CI/CD)

This list corresponds to the implementation plan located at `docs/05_sprint_1/temp_s1_p0_01_plan.md`.

## Phase 1: Foundations
- [ ] **Task 1: Gitflow Baseline, Workspace & Pre-commit Hooks**
- [ ] **Task 2: Node.js/Express Server Initialization & Integration Stubs**

### Checkpoint: Foundations (Tasks 1 & 2)
- [ ] `npm run lint`, `npm run typecheck`, and `npm run build` pass for the server; `GET /api/health` responds with HTTP 200.
- [ ] `husky` actively blocks commits violating conventional formatting; `develop` exists on `origin`.

## Phase 2: Core Skeleton & Verification
- [ ] **Task 3: React (Vite) + Tailwind CSS Client Initialization**
- [ ] **Task 4: Unified Vitest & Quality Test Harness**

### Checkpoint: Full-Stack Integration (Tasks 3 & 4)
- [ ] Client reaches `/api/health` through the Vite proxy (manual check in browser devtools). Accessibility linting passes on the shell and fails on a seeded violation.
- [ ] All Vitest tests pass offline (no `.env`, no network) on the developer machine.

## Phase 3: Pipeline & Delivery
- [ ] **Task 5: GitHub Actions CI/CD Pipeline Configuration**
- [ ] **Task 6: Developer Bootstrap Guide & Pull Request Template**

### Checkpoint: Release & Rubric Readiness (Tasks 5 & 6)
- [ ] CI workflow passes on Linux in GitHub Actions with zero repository secrets configured.
- [ ] Pull request `feature/S1-P0-01-scaffolding-cicd` into `develop` is open with test output, CI screenshot, and prototype screenshot attached.
- [ ] Fresh-clone bootstrap verified by a second developer (not only the author) on a different OS where possible.
