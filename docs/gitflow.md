# GitFlow workflow

This repository uses a GitFlow-style model tailored for Character.AI Dumper. Branch names and commands below are valid for Windows PowerShell 5.1. A legacy milestone tag `v1.9-stable` exists on `master` even though `package.json` lists `0.1.0-beta`; initialization commands reference that tag intentionally per the migration requirement.

## Branches
- `main`: production history. Tags for releases point here. If `master` is the upstream default, keep it but mirror `main` from it.
- `develop`: integration branch for completed features.
- `feature/<slug>`: short-lived branches from `develop`.
- `release/<version>`: stabilization branches from `develop`.
- `hotfix/<version>`: urgent fixes from `main`.

## Versioning, tags, and release discipline
- Semantic Versioning: `MAJOR.MINOR.PATCH` (e.g., `v1.0.0`).
- Tags must be annotated (`git tag -a`) and applied to the merge commit that lands on `main`.
- Every release/hotfix updates `CHANGELOG.md` and includes release notes in the PR body.

## Branch protection (recommended)
- `main`:
  - Require status check: **CI** workflow to pass.
  - Require ≥1 approving review.
  - Require branches to be up to date before merge.
  - Allow only merge commits (no squash/rebase) to preserve tag ancestry.
- `develop`:
  - Require status check: **CI** workflow to pass.
  - Require ≥1 approving review.
  - Allow merge commits.

## PowerShell command recipes

### Initialize long-lived branches from `v1.9-stable`
The upstream history includes a milestone tag `v1.9-stable` on `master` (even though the package version is `0.1.0-beta`); use that as the seed tag today. Replace `v1.9-stable` with the current stable tag if the milestone changes or if you apply this workflow elsewhere.
```powershell
git checkout master
git checkout -b main v1.9-stable
git push -u origin main

git checkout -b develop v1.9-stable
git push -u origin develop
```
If `main` already exists, ensure it points at the desired stable commit/tag instead of re-creating it.

### Create a feature branch
```powershell
git checkout develop
git pull
git checkout -b feature/<slug>
git push -u origin feature/<slug>
```

### Create a release branch
```powershell
git checkout develop
git pull
git checkout -b release/<version>
# update CHANGELOG.md, version info, docs
git commit -am "chore(release): prepare <version>"
git push -u origin release/<version>
```

### Finish a release (merge, tag, sync back)
```powershell
git checkout release/<version>
git pull

git checkout main
git pull
git merge --no-ff release/<version> -m "chore(release): <version>"
git tag -a v<version> -m "Release <version>"
git push origin main
git push origin v<version>

git checkout develop
git pull
git merge --no-ff release/<version> -m "chore(release): <version>"
git push origin develop

git branch -d release/<version>
git push origin --delete release/<version>
```

### Create a hotfix branch
```powershell
git checkout main
git pull
git checkout -b hotfix/<version>
git push -u origin hotfix/<version>
```

### Finish a hotfix
```powershell
git checkout hotfix/<version>
git pull

git checkout main
git pull
git merge --no-ff hotfix/<version> -m "fix: apply hotfix <version>"
git tag -a v<version> -m "Hotfix <version>"
git push origin main
git push origin v<version>

git checkout develop
git pull
git merge --no-ff hotfix/<version> -m "fix: backport hotfix <version>"
git push origin develop

git branch -d hotfix/<version>
git push origin --delete hotfix/<version>
```

### Quality gates before merging
- `npm ci`
- `npm run build` (set `$env:GH_TOKEN="<token>"` in PowerShell if required by `electron-builder`)

### Release notes
- Each release/hotfix PR must include a summary of changes, risks, testing notes, and a pointer to updated `CHANGELOG.md`.
