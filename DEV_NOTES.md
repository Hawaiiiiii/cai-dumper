# CAI Dumper v1.0.0 Dev Notes

## Audit Report & Proof of Fixes

### A) Stability: Memory & Request Blocking
- **Issue**: Large chats crashed due to memory bloat and loading heavy assets.
- **Fix in `scraper.ts`**:
  - **Resource Blocking**:
    ```typescript
    await this.page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) {
        route.abort().catch(() => {});
      } else {
        route.continue().catch(() => {});
      }
    });
    ```
  - **Memory Optimization**: Removed `outerHTML` property from `scrapeChat` return values. The scraper now returns strictly `{ turn_index, role, text }` objects, preventing DOM tree cloning.

### B) Correctness: Header Flip Fix
- **Issue**: "You" vs "Character" labels were inverted.
- **Fix in `scraper.ts` (Role Detection)**:
  ```typescript
  let role: 'user' | 'char' = 'user';
  if (lines.some(l => l.toLowerCase() === 'c.ai')) {
    role = 'char';
  } else {
    // Additional check for "User" label if present
    if (lines.length > 0 && (lines[0] === 'You' || lines[0] === 'User')) role = 'user';
  }
  ```
- **Fix in `main.ts` (Markdown Headers)**:
  ```typescript
  const viewerHandle = sessionCache?.viewer?.handle || 'You';
  const charHeader = characterName || 'Character';
  // ...
  const header = msg.role === 'user' ? viewerHandle : charHeader;
  mdStream.write(`**${header}:**\n${msg.text}\n\n---\n\n`);
  ```

### C) Stability: Job Queue & Concurrency
- **Issue**: Race conditions when multiple IPC calls manipulated Playwright simultaneously.
- **Fix**: Introduced `JobQueue` class.
- **Implementation in `main.ts`**:
  ```typescript
  ipcMain.handle('launch-browser', async () => {
    return jobQueue.add('launch', async () => { ... });
  });
  // Applied to all scraper-touching handlers
  ```

### D) Diagnostics
- **Feature**: `export-diagnostics` IPC handler.
- **Output**: Exports `system_info.json` (app version, indexes, settings) to `Documents/CAI_Exports/diagnostics/`.

### E) Live QA Monitor
- **Feature**: Real-time QA checks that stream to the renderer.
- **Controls**: Settings → Diagnostics & QA → “Start Live QA”.
- **What it checks**: Browser connection, active URL, key UI elements, DOM message count, scroll container, and API interception.
- **IPC**: `start-qa-monitor`, `stop-qa-monitor`, `get-qa-state`, `qa-report`.

### F) Verification Steps
1. Run `npm run dev`.
2. Launch Browser & Login.
3. Select a large chat (>10k msgs if available, or long scroll).
4. Click "Export".
5. Verify `transcript.md` uses correct Headers (Your Handle vs Char Name).
6. Verify no crash.
7. Click "Diagnostics" to verify system dump generation.
8. Click "Start Live QA" and confirm reports stream.
