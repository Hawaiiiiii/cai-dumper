# Changelog

## 0.1.0-beta (initial release)
- Added multi-path Python analyzer resolution and minimal analyzer output (`summary.md`).
- Hardened Playwright profile/cache, added env override `CAI_DUMPER_PROFILE_DIR`.
- Improved chat extraction heuristics for new Character.AI UI (container/message selector fallbacks, role inference, dedup, order detection, reverse toggle).
- Added zero-message safeguard (write outputs, skip analysis, warn with debug logs).
- Added "Test Selectors" debug panel and IPC to surface selector counts/samples.
- Outputs per chat: `transcript.jsonl`, `transcript.json`, `transcript.md`, `meta.json`, `summary.md`.
- Packaging via `npm run build` produces NSIS installer (`CAI Dumper Setup 0.1.0-beta.exe`).
