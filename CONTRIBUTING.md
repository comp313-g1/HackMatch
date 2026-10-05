# HackMatch Contributing Guide

Welcome to the HackMatch development repository. To ensure high code quality, smooth collaboration among all 6 developers, and compliance with course evaluation rubrics, please follow these guidelines.

---

## 1. Prerequisites

- **Node.js:** `22.x LTS` (Use `nvm use` to select version specified in `.nvmrc`)
- **Package Manager:** `npm >= 10.x`
- **Git:** Version control with LF line endings (`.gitattributes` will configure this automatically)

---

## 2. Gitflow & Branch Naming

All feature work branches off `develop` and merges back into `develop` via pull requests. Never commit directly to `main` or `develop`.

Branch naming format:
- Feature tasks: `feature/<task-id>-<short-description>` (e.g. `feature/S1-P0-02-participant-profile-record`)
- Bug fixes: `fix/<task-id>-<short-description>`
- Sprint releases: `release/sprint-1`

---

## 3. Commit Message Standards

Commit messages are automatically validated by `husky` and `commitlint` according to the [Conventional Commits specification](https://www.conventionalcommits.org/):

Format: `<type>(<optional scope>): <description>`

Allowed types:
- `feat`: New feature or user story capability
- `fix`: Bug fix
- `chore`: Tooling, configuration, or dependency updates
- `test`: Adding or refactoring tests
- `docs`: Documentation updates
- `refactor`: Code refactoring without behavior change

Example:
```bash
git commit -m "feat(server): add request-id middleware per NR-021"
```

---

## 4. Testing & The Independence Rule

Per project governance, all unit and integration tests **must run completely offline without hitting live Firebase or Supabase endpoints**.

- Never check in `.env` files.
- Always use mock adapters, stubs, or test doubles in unit tests.
- Ensure `npm run test` exits with code 0 before opening a pull request.

---

## 5. Pull Request Process

1. Verify local quality checks pass:
   ```bash
   npm run lint
   npm run typecheck
   npm run build
   npm run test
   ```
2. Push your branch to GitHub.
3. Open a Pull Request targeting `develop`.
4. Fill out `.github/pull_request_template.md` with:
   - Associated Task ID and User Story ID.
   - Course Rubric categories addressed.
   - Terminal logs or screenshots demonstrating test passage.
