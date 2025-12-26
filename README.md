<div align="center">
   <img width="1200" height="320" alt="CAI Dumper" src="https://community.characterai.io/wndec00.png" />
   <h1>CAI Dumper V1 (Beta)</h1>
   <p>Electron + Vite/React + Playwright + Python — export Character.AI chats to JSONL/MD with basic analysis.</p>
</div>

## Features (beta)
- Persistent Playwright Chromium profile (configurable via <code>CAI_DUMPER_PROFILE_DIR</code>) with cache hardening.
- Sidebar scan to list chats; multi-select export.
- Robust message extraction for the latest CAI UI (container/selector heuristics, role inference, dedup, order detection, reverse toggle).
- Transcript outputs: <code>transcript.jsonl</code>, <code>transcript.json</code>, <code>transcript.md</code>, <code>meta.json</code>.
- Python analyzer writes <code>summary.md</code>; analyzer path auto-resolves across dev/build layouts.
- Zero-message safeguard: outputs still written, analysis skipped with warning + debug logs.
- “Test Selectors” debug panel shows container/selector counts and sample texts.

## Prerequisites
- Node.js 18+
- Python 3.x available on PATH (`python` command)

## Quick start (dev)
```powershell
cd cai-dumper-v1
npm install
npm run dev
```

In the app:
1) **Launch Browser** (log in to Character.AI in the opened window).
2) **Scan Sidebar** to list chats.
3) (Optional) **Test Selectors** to view selector diagnostics.
4) Select chats → optionally toggle **Reverse transcript order** → **Export Selected**.
5) If messages are found, Python analysis runs automatically and writes `summary.md`.
6) If zero messages, outputs are written and analysis is skipped with a warning; check logs and Test Selectors.

## Packaging
```powershell
npm run build
```

## Development workflow
- Branching: `main` (production), `develop` (integration), `feature/<slug>`, `release/<version>`, `hotfix/<version>`.
- Use conventional commits (e.g., `feat(ui): ...`).
- Open feature PRs into `develop`; finish releases with merge commits into `main`, tag `vX.Y.Z`, then merge back to `develop`.
- Update `CHANGELOG.md` for every release/hotfix and include release notes in PRs.
- See `docs/gitflow.md` for PowerShell-ready commands and branch protection guidance.

Quality checks:
```powershell
npm ci
$env:GH_TOKEN="<your_github_token>"
npm run build
```
> Provide a GitHub token when running locally so `electron-builder` can reach the GitHub API; CI injects this automatically.
