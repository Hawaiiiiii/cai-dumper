# Contributing

Thank you for helping improve CAI Dumper. This project follows a GitFlow-inspired process with conventional commits and lightweight CI.

## Branch model
- `main`: production-ready history. Tags for releases land here. If `master` is still the default, treat it as production until `main` is default; once `main` exists, fast-forward `master` from `main` for backward compatibility only.
- `develop`: integration branch for completed work.
- Feature branches: `feature/<slug>` from `develop`.
- Release branches: `release/<version>` from `develop`.
- Hotfix branches: `hotfix/<version>` from `main`.

## Workflow expectations
1. Start from `develop` for new work (`feature/*`), from `develop` for releases (`release/*`), and from `main` for urgent fixes (`hotfix/*`).
2. Prefer merge commits (no fast-forward) when finishing release/hotfix branches so tags point to merge commits on `main`.
3. Update `CHANGELOG.md` and release notes when preparing a release or hotfix.
4. Keep PRs scoped and reference issues when applicable. Target `develop` unless you are finishing a release/hotfix into `main`.
5. Use semantic versioning (MAJOR.MINOR.PATCH) for tags (e.g., `v1.10.0`).

## Commit conventions
Use [Conventional Commits](https://www.conventionalcommits.org/) (lowercase types):
- Format: `<type>(optional scope): <description>`
- Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `build`.
- Example: `feat(ui): add chat export toggle`

## Pull requests
- Ensure branch naming follows the model above.
- Include a brief summary, testing notes, and checklist in the PR template.
- Keep the codeowners reviewer loop engaged (`CODEOWNERS` applies).
- Run `npm ci` then `npm run build` (use `$env:GH_TOKEN="<token>"` in PowerShell if needed for `electron-builder`) before requesting review.

## Branch protection (recommended)
- `main`: require the CI workflow to pass, at least one approving review, and disallow direct pushes. Require branches to be up to date before merging; allow only merge commits.
- `develop`: require the CI workflow to pass and at least one approving review; allow merge commits.

See `docs/gitflow.md` for full step-by-step commands (PowerShell-friendly) for creating and finishing branches.
