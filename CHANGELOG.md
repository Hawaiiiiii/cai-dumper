# Changelog

## 1.0.0-overhaul (unreleased)
- Live QA suite: continuous diagnostics, scroll test, and real-time QA reports.
- QA overlay + force-scroll probe to identify the true chat scroller.
- QA snapshot export to disk for AI handoff/debugging.
- Browser launch helpers and connection checks for CDP sessions.
- Scroll engine hardening: center-point detection, can-scroll validation, aggressive fallback.
- DOM extraction resilience: improved selectors, deduping, and order handling.
- IPC reliability: job queue and safer multi-call coordination.
- UI additions: Diagnostics panel upgrades and new controls.
- Build/dev improvements: updated notes and diagnostics output.

## 0.1.0-beta (initial release)
- Added multi-path Python analyzer resolution and minimal analyzer output (`summary.md`).
- Hardened Playwright profile/cache, added env override `CAI_DUMPER_PROFILE_DIR`.
- Improved chat extraction heuristics for new Character.AI UI (container/message selector fallbacks, role inference, dedup, order detection, reverse toggle).
- Added zero-message safeguard (write outputs, skip analysis, warn with debug logs).
- Added "Test Selectors" debug panel and IPC to surface selector counts/samples.
- Outputs per chat: `transcript.jsonl`, `transcript.json`, `transcript.md`, `meta.json`, `summary.md`.
- Packaging via `npm run build` produces NSIS installer (`CAI Dumper Setup 0.1.0-beta.exe`).
