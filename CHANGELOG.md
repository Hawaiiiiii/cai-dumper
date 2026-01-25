# Changelog

## 1.0.0-overhaul (unreleased)
- **UI/UX overhaul**: new Settings panel, Chat list, sidebar tweaks, character grid/card updates, and a cleaner app layout.
- **Diagnostics & QA**: live QA monitor, real-time reports, scroll test, overlay highlighting, force-scroll probe, and snapshot export for AI handoff.
- **Scroll & extraction hardening**: smarter scroller detection, can-scroll validation, more resilient selectors, dedupe, and order handling.
- **Automation reliability**: job queue + safer IPC coordination to reduce race conditions and flaky actions.
- **Browser control**: launch helpers, connection checks, and better diagnostics around CDP sessions.
- **Export/metadata flow**: diagnostics output and dev notes polished for visibility.
- **Visual spice (for science)**: snow overlay added for fun, testing, and UI flavor without breaking flow.

## 0.1.0-beta (initial release)
- Added multi-path Python analyzer resolution and minimal analyzer output (`summary.md`).
- Hardened Playwright profile/cache, added env override `CAI_DUMPER_PROFILE_DIR`.
- Improved chat extraction heuristics for new Character.AI UI (container/message selector fallbacks, role inference, dedup, order detection, reverse toggle).
- Added zero-message safeguard (write outputs, skip analysis, warn with debug logs).
- Added "Test Selectors" debug panel and IPC to surface selector counts/samples.
- Outputs per chat: `transcript.jsonl`, `transcript.json`, `transcript.md`, `meta.json`, `summary.md`.
- Packaging via `npm run build` produces NSIS installer (`CAI Dumper Setup 0.1.0-beta.exe`).
