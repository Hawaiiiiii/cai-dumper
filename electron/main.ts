import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { ScraperEngine } from './scraper';
import { resolveAnalyzerPath, runPythonAnalysis } from './analyzerRunner';
import { StorageService } from './storage';
import { SessionSnapshot, CreatorProfile, CharacterSummary, ViewerProfile, ExportIndexEntry, TranscriptInsights, TranscriptMessage } from '../types';

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

let win: BrowserWindow | null;
let scraper: ScraperEngine | null = null;
let storage: StorageService;
let sessionCache: SessionSnapshot | null = null;
let hydrateCancelFlag = { cancel: false };
let profileIndexCancelFlag = { cancel: false };

// Invariant guard: scan handlers must never hydrate creators.
// If this is true and code attempts to touch creator hydration, we throw.
let inFastScan = false;

const MAX_TRANSCRIPT_LINES_DEFAULT = 50_000;

function safeDateBucket(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function tinyHash(input: string): string {
  // Non-crypto stable hash (djb2)
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h) ^ input.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function normalizeTranscriptMessage(raw: any, lineNo: number): TranscriptMessage {
  const text = typeof raw?.text === 'string' ? raw.text : (typeof raw?.content === 'string' ? raw.content : String(raw?.text ?? raw?.content ?? ''));
  const roleRaw = String(raw?.role ?? raw?.sender ?? raw?.author ?? '').toLowerCase();
  let sender: TranscriptMessage['sender'] = 'unknown';
  if (roleRaw === 'user' || roleRaw === 'viewer' || roleRaw === 'me') sender = 'viewer';
  else if (roleRaw === 'char' || roleRaw === 'character' || roleRaw === 'bot') sender = 'character';
  else if (roleRaw === 'system') sender = 'system';

  const ts = typeof raw?.timestamp === 'string' ? raw.timestamp : (typeof raw?.ts === 'string' ? raw.ts : null);
  const name = typeof raw?.name === 'string' ? raw.name : (typeof raw?.author_name === 'string' ? raw.author_name : null);

  const idSeed = `${ts || ''}|${sender}|${name || ''}|${text}|${lineNo}`;
  return {
    id: tinyHash(idSeed),
    ts: ts || null,
    sender,
    name,
    text,
    attachments: Array.isArray(raw?.attachments) ? raw.attachments : undefined,
    raw,
  };
}

async function readTranscriptJsonl(transcriptPath: string, maxLines = MAX_TRANSCRIPT_LINES_DEFAULT): Promise<{ messages: TranscriptMessage[]; warnings: string[] }> {
  const warnings: string[] = [];
  if (!fs.existsSync(transcriptPath)) throw new Error(`Transcript not found: ${transcriptPath}`);

  // Streaming parse, but store only last maxLines to cap memory
  const stream = fs.createReadStream(transcriptPath, { encoding: 'utf-8' });
  let buf = '';
  let lineNo = 0;
  const ring: TranscriptMessage[] = [];

  for await (const chunk of stream as any as AsyncIterable<string>) {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      lineNo++;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const msg = normalizeTranscriptMessage(parsed, lineNo);
        ring.push(msg);
        if (ring.length > maxLines) ring.shift();
      } catch (e) {
        warnings.push(`Failed to parse line ${lineNo}`);
      }
    }
  }

  const last = buf.trim();
  if (last) {
    lineNo++;
    try {
      const parsed = JSON.parse(last);
      const msg = normalizeTranscriptMessage(parsed, lineNo);
      ring.push(msg);
      if (ring.length > maxLines) ring.shift();
    } catch (e) {
      warnings.push(`Failed to parse line ${lineNo}`);
    }
  }

  const totalApprox = lineNo;
  if (totalApprox > maxLines) {
    warnings.unshift(`Transcript is large (${totalApprox} lines). Showing last ${maxLines}.`);
  }

  return { messages: ring, warnings };
}

async function computeInsights(transcriptPath: string, maxLines = MAX_TRANSCRIPT_LINES_DEFAULT): Promise<TranscriptInsights> {
  const { messages, warnings } = await readTranscriptJsonl(transcriptPath, maxLines);
  let totalChars = 0;
  let totalWords = 0;
  let viewerMessages = 0;
  let characterMessages = 0;
  const buckets: Record<string, number> = {};
  for (const m of messages) {
    totalChars += m.text.length;
    totalWords += (m.text.trim() ? m.text.trim().split(/\s+/g).length : 0);
    if (m.sender === 'viewer') viewerMessages++;
    if (m.sender === 'character') characterMessages++;
    const b = safeDateBucket(m.ts);
    if (b) buckets[b] = (buckets[b] || 0) + 1;
  }
  const totalMessages = messages.length;
  const timelineBuckets = Object.keys(buckets)
    .sort()
    .map((date) => ({ date, count: buckets[date] }));

  return {
    totalMessages,
    viewerMessages,
    characterMessages,
    avgCharsPerMessage: totalMessages ? totalChars / totalMessages : 0,
    avgWordsPerMessage: totalMessages ? totalWords / totalMessages : 0,
    timelineBuckets,
    warnings: warnings.length ? warnings : undefined,
  };
}

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0f0f11',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(process.env.DIST!, 'index.html'));
  }

  // Initialize Scraper with UserData persistence
  const profileDir = storage.getProfileDir();
  const cacheDir = path.join(profileDir, 'cache');
  scraper = new ScraperEngine(profileDir, (log) => {
    win?.webContents.send('scraper-log', log);
  }, cacheDir);
}

app.on('window-all-closed', () => {
  if (scraper) scraper.close();
  win = null;
  if (process.platform !== 'darwin') app.quit();
});

app.whenReady().then(() => {
  storage = new StorageService(app.getPath('userData'));
  sessionCache = storage.loadSessionSnapshot();
  const viewer = storage.getViewer();
  if (viewer) {
    sessionCache = storage.updateSessionSnapshot({ viewer });
  }
  createWindow();
});

// --- IPC HANDLERS ---

ipcMain.handle('launch-browser', async () => {
  if (!scraper) return false;
  await scraper.launch();
  try {
    const profile = await scraper.scrapeViewerProfile();
    if (profile) {
      storage?.saveViewer(profile);
      sessionCache = storage.updateSessionSnapshot({ viewer: profile });
      sessionCache = storage.markSectionUpdated('viewer');
      broadcastSession();
    }
  } catch {}
  return true;
});

ipcMain.handle('fetch-chats', async () => {
  if (!scraper) throw new Error("Scraper not initialized");
  // Alias to refresh-sidebar-scan for backwards compatibility.
  // IMPORTANT: must remain fast+DOM-only and must not hydrate creators.
  inFastScan = true;
  try {
    const snapshots = await scraper.scanSidebar();
    let viewer: ViewerProfile | null = sessionCache?.viewer || storage.getViewer() || null;

    try {
      const v = await scraper.scrapeViewerProfile();
      if (v) {
        storage.saveViewer(v);
        viewer = v;
      }
    } catch (e) {
      win?.webContents.send('scraper-log', `[Session] Viewer scrape skipped/failed during scan: ${(e as Error).message}`);
    }

    const chatIndex = (snapshots as CharacterSummary[]).map((s) => ({
      chatId: s.chatId,
      chatUrl: s.url,
      characterName: s.displayName,
      avatarUrl: s.avatarUrl || null,
      lastSeenLabel: (s as any).lastSeenLabel || (s as any).lastInteractedLabel || null,
      updatedAt: new Date().toISOString(),
    }));

    storage.saveCharacterSnapshots(snapshots as CharacterSummary[]);
    storage.saveLastScan(snapshots.length);
    storage.saveChatsIndex(chatIndex);

    sessionCache = storage.updateSessionSnapshot({
      viewer,
      characters: snapshots as CharacterSummary[],
    });
    sessionCache = storage.markSectionUpdated('characters');
    if (viewer) sessionCache = storage.markSectionUpdated('viewer');
    broadcastSession();

    return { viewer, chats: chatIndex };
  } finally {
    inFastScan = false;
  }
});

ipcMain.handle('export-chat', async (event, { url, characterName, reverseTranscript, avatarUrl }) => {
  if (!scraper) throw new Error("Scraper not initialized");
  
  const rawMessages = await scraper.scrapeChat(url, { reverseTranscript });
  
  // Create Export Directory
  const settings = storage?.getSettings();
  const exportRoot = settings?.exportRootPath || path.join(app.getPath('documents'), 'CAI_Exports');
  const exportBase = path.join(exportRoot, characterName.replace(/[^a-z0-9]/gi, '_'));
  const chatId = url.split('/').pop() || 'unknown_id';
  const chatDir = path.join(exportBase, chatId);
  
  if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });

  const meta = {
    characterName,
    chatId,
    url,
    exportedAt: new Date().toISOString(),
    messageCount: rawMessages.length,
  };

  // 1. JSONL (Canonical)
  const jsonlPath = path.join(chatDir, 'transcript.jsonl');
  const jsonlContent = rawMessages.map(m => JSON.stringify(m)).join('\n');
  fs.writeFileSync(jsonlPath, jsonlContent);

  // 2. Markdown
  const mdPath = path.join(chatDir, 'transcript.md');
  const mdContent = `# Chat with ${characterName}\n\n` + rawMessages.map(m => `**${m.role === 'user' ? 'You' : characterName}:**\n${m.text}\n`).join('\n---\n\n');
  fs.writeFileSync(mdPath, mdContent);

  // 3. JSON
  const metaPath = path.join(chatDir, 'meta.json');
  fs.writeFileSync(path.join(chatDir, 'transcript.json'), JSON.stringify(rawMessages, null, 2));
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  if (rawMessages.length === 0) {
    const warning = "Export produced 0 messages; skipping analysis. Run 'Test selectors' to debug extraction.";
    win?.webContents.send('analysis-log', warning);
    return { path: chatDir, count: rawMessages.length, analysisSkipped: true, warning };
  }

  const summaryPath = fs.existsSync(path.join(chatDir, 'summary.md')) ? path.join(chatDir, 'summary.md') : null;
  const viewerHandle = storage?.getViewer()?.handle || sessionCache?.viewer?.handle || null;
  const recorded = storage?.recordExport({
    chatId,
    chatUrl: url,
    characterName,
    characterAvatarUrl: avatarUrl || null,
    viewerHandle,
    exportedAt: meta.exportedAt,
    exportDirAbsolutePath: chatDir,
    messageCount: rawMessages.length,
    summaryPath,
    transcriptPath: jsonlPath,
    metaPath,
    tags: [],
    lastOpenedAt: null,
  });

  win?.webContents.send('export-index-updated', storage?.getExportIndex());

  return { path: chatDir, count: rawMessages.length, analysisSkipped: false, recorded };
});

ipcMain.handle('test-selectors', async () => {
  if (!scraper) throw new Error("Scraper not initialized");
  return await scraper.testSelectors();
});

ipcMain.handle('run-analysis', async (event, { folderPath }) => {
  const jsonlPath = path.join(folderPath, 'transcript.jsonl');
  if (!fs.existsSync(jsonlPath)) throw new Error("transcript.jsonl not found in folder");

  const { scriptPath, tried } = resolveAnalyzerPath();
  win?.webContents.send('analysis-log', `Using analyzer: ${scriptPath}`);

  const output = await runPythonAnalysis(scriptPath, jsonlPath, (log) => {
    win?.webContents.send('analysis-log', log);
  });

  // refresh index with summary path if created
  const summaryPath = path.join(folderPath, 'summary.md');
  const metaPath = path.join(folderPath, 'meta.json');
  try {
    if (storage && fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const index = storage.getExportIndex();
      const existing = index.exports.find(e => e.exportDirAbsolutePath === folderPath);
      if (existing) {
        storage.recordExport({ ...existing, summaryPath: fs.existsSync(summaryPath) ? summaryPath : existing.summaryPath });
        win?.webContents.send('export-index-updated', storage.getExportIndex());
      } else {
        storage.recordExport({
          chatId: meta.chatId || path.basename(folderPath),
          characterName: meta.characterName || 'Unknown',
          characterAvatarUrl: meta.avatarUrl || null,
          exportedAt: meta.exportedAt || new Date().toISOString(),
          exportDirAbsolutePath: folderPath,
          messageCount: meta.messageCount || 0,
          summaryPath: fs.existsSync(summaryPath) ? summaryPath : null,
          transcriptPath: jsonlPath,
          metaPath,
          lastOpenedAt: null,
          tags: [],
        });
        win?.webContents.send('export-index-updated', storage.getExportIndex());
      }
    }
  } catch (err) {
    win?.webContents.send('analysis-log', `Index update failed: ${(err as Error).message}`);
  }

  return output;
});

ipcMain.handle('open-folder', (event, p) => {
  shell.openPath(p);
});

ipcMain.handle('open-path-in-explorer', async (_event, p: string) => {
  if (!p) return;
  // If it's a directory open it; if it's a file reveal it
  try {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      await shell.openPath(p);
    } else {
      shell.showItemInFolder(p);
    }
  } catch {
    // fallback
    shell.showItemInFolder(p);
  }
});

ipcMain.handle('open-file', async (_event, p: string) => {
  if (!p) return;
  await shell.openPath(p);
});

ipcMain.handle('list-exports-for-chat', async (_event, chatId: string): Promise<ExportIndexEntry[]> => {
  const record = storage.getExportIndex();
  const list = (record.exports || []).filter((e) => e.chatId === chatId);
  return list.sort((a, b) => Date.parse(b.exportedAt) - Date.parse(a.exportedAt));
});

ipcMain.handle('read-summary', async (_event, summaryPath: string): Promise<string> => {
  if (!summaryPath) return '';
  if (!fs.existsSync(summaryPath)) return '';
  return fs.readFileSync(summaryPath, 'utf-8');
});

ipcMain.handle('read-transcript', async (_event, inputPath: string, maxLines?: number) => {
  // inputPath can be exportDir or transcriptPath
  if (!inputPath) throw new Error('Path is required');
  const p = fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory()
    ? path.join(inputPath, 'transcript.jsonl')
    : inputPath;
  const { messages, warnings } = await readTranscriptJsonl(p, maxLines || MAX_TRANSCRIPT_LINES_DEFAULT);
  return { transcriptPath: p, messages, warnings };
});

ipcMain.handle('read-transcript-page', async (_event, transcriptPath: string, opts?: { direction: 'older' | 'newer'; fromLine?: number; pageSize: number; currentMaxLines?: number }) => {
  // Simple fallback paging: re-read file with a higher maxLines and return the combined tail.
  // This doesn't require building a byte offset index (future optimization).
  if (!transcriptPath) throw new Error('transcriptPath is required');
  const direction = opts?.direction || 'older';
  const pageSize = Math.max(1, Number(opts?.pageSize) || 25_000);
  const currentMaxLines = Math.max(1, Number(opts?.currentMaxLines) || MAX_TRANSCRIPT_LINES_DEFAULT);

  if (direction !== 'older') {
    // Nothing to do for "newer" in tail-based fallback.
    const { messages, warnings } = await readTranscriptJsonl(transcriptPath, currentMaxLines);
    return { transcriptPath, messages, warnings, maxLines: currentMaxLines, truncated: (warnings || []).some((w) => w.includes('Showing last')) };
  }

  const nextMaxLines = currentMaxLines + pageSize;
  const { messages, warnings } = await readTranscriptJsonl(transcriptPath, nextMaxLines);
  return { transcriptPath, messages, warnings, maxLines: nextMaxLines, truncated: (warnings || []).some((w) => w.includes('Showing last')) };
});

ipcMain.handle('compute-insights-from-transcript', async (_event, transcriptPath: string, maxLines?: number): Promise<TranscriptInsights> => {
  return computeInsights(transcriptPath, maxLines || MAX_TRANSCRIPT_LINES_DEFAULT);
});

ipcMain.handle('get-export-index', async () => storage.getExportIndex());

ipcMain.handle('get-profile-dir', async () => storage.getProfileDir());

ipcMain.handle('get-character-cache', async () => storage.getCharacterSnapshots());

ipcMain.handle('get-user-profile', async () => storage.getViewer() || storage.getSettings().userProfile || null);
ipcMain.handle('get-viewer', async () => storage.getViewer());

ipcMain.handle('get-session', async () => {
  sessionCache = storage.loadSessionSnapshot();
  win?.webContents.send('session-updated', sessionCache);
  return sessionCache;
});

ipcMain.handle('save-session', async (_event, patch: Partial<SessionSnapshot>) => {
  sessionCache = storage.updateSessionSnapshot(patch);
  broadcastSession();
  return sessionCache;
});

ipcMain.handle('refresh-viewer-profile', async () => {
  if (!scraper) throw new Error('Scraper not initialized');
  try {
    const profile = await scraper.scrapeViewerProfile();
    if (profile) {
      storage.saveViewer(profile);
      sessionCache = storage.updateSessionSnapshot({ viewer: profile });
      sessionCache = storage.markSectionUpdated('viewer');
      broadcastSession();
      return { session: sessionCache, profile };
    }
  } catch (e) {
    win?.webContents.send('scraper-log', `[Session] Viewer refresh failed: ${(e as Error).message}`);
  }
  return { session: sessionCache, profile: null };
});

ipcMain.handle('refresh-creator-profiles', async (_event, usernames: string[]) => {
  if (!scraper) throw new Error('Scraper not initialized');
  if (inFastScan) {
    // Regression-proofing: creator hydration during scan is forbidden
    throw new Error('[Invariant] Creator hydration attempted during fast scan');
  }

  hydrateCancelFlag.cancel = false;
  const progressChannel = 'creator-hydrate-progress';

  const creators: Record<string, CreatorProfile> = sessionCache?.creators ? { ...sessionCache.creators } : {};
  const isValidHandle = (h: string) => /^@[A-Za-z0-9_]{2,32}$/.test(h);
  const isValidUsername = (u: string) => /^[A-Za-z0-9_]{2,32}$/.test(u);

  const raw = Array.isArray(usernames) ? usernames : [];
  const normalized = raw
    .map((n) => (n || '').trim())
    .filter(Boolean)
    .map((n) => (n.startsWith('@') ? n : `@${n}`))
    .filter(isValidHandle)
    .map((h) => h.replace(/^@/, ''))
    .filter(isValidUsername);

  const unique = Array.from(new Set(normalized));
  if (unique.length === 0) {
    win?.webContents.send(progressChannel, { total: 0, completed: 0 });
    return { session: sessionCache, updated: 0, message: 'No creators to refresh' };
  }

  // Rate limit: 3 concurrent max (safe default)
  const concurrency = 3;
  let completed = 0;
  let updated = 0;
  let failed = 0;
  const startedAt = Date.now();

  win?.webContents.send(progressChannel, { total: unique.length, completed: 0, updated: 0, failed: 0 });

  const runOne = async (name: string) => {
    if (hydrateCancelFlag.cancel) return;
    try {
      const cprof = await scraper!.getCreatorProfile(name);
      if (hydrateCancelFlag.cancel) return;
      if (cprof) {
        creators[name] = cprof;
        updated++;
      }
    } catch (e) {
      failed++;
      win?.webContents.send('scraper-log', `[Session] Creator refresh failed for ${name}: ${(e as Error).message}`);
    } finally {
      completed++;
      win?.webContents.send(progressChannel, {
        total: unique.length,
        completed,
        updated,
        failed,
        cancelled: hydrateCancelFlag.cancel,
        elapsedMs: Date.now() - startedAt,
      });
    }
  };

  // Simple worker pool
  const queue = [...unique];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }).map(async () => {
    while (queue.length && !hydrateCancelFlag.cancel) {
      const next = queue.shift();
      if (!next) break;
      await runOne(next);
      // small delay to avoid hammering
      await new Promise((r) => setTimeout(r, 250));
    }
  });
  await Promise.all(workers);

  if (hydrateCancelFlag.cancel) {
    win?.webContents.send(progressChannel, { total: unique.length, completed, updated, failed, cancelled: true });
    return { session: sessionCache, updated, message: 'Cancelled' };
  }

  sessionCache = storage.updateSessionSnapshot({ creators });
  sessionCache = storage.markSectionUpdated('creators');
  broadcastSession();
  // Dedicated update event for consumers that only care about creator index
  win?.webContents.send('creators-index-updated', creators);
  return { session: sessionCache, updated, message: updated === 0 ? 'No creators updated' : undefined };
});

ipcMain.handle('refresh-sidebar-scan', async () => {
  if (!scraper) throw new Error('Scraper not initialized');
  // FAST SCAN invariant:
  // - must be DOM-only sidebar scan
  // - must NOT navigate into each chat
  // - must NOT fetch creator profiles
  // - should be safe if user presses it repeatedly
  inFastScan = true;
  try {
    const snapshots = await scraper.scanSidebar();

    // Optional: refresh viewer (single navigation at most; NO per-entry nav).
    // If viewer scrape fails, keep last known viewer.
    let viewer: ViewerProfile | null = sessionCache?.viewer || storage.getViewer() || null;
    try {
      const v = await scraper.scrapeViewerProfile();
      if (v) {
        storage.saveViewer(v);
        viewer = v;
      }
    } catch (e) {
      win?.webContents.send('scraper-log', `[Session] Viewer scrape skipped/failed during scan: ${(e as Error).message}`);
    }

    const chatIndex = (snapshots as CharacterSummary[]).map((s) => ({
      chatId: s.chatId,
      chatUrl: s.url,
      characterName: s.displayName,
      avatarUrl: s.avatarUrl || null,
      lastSeenLabel: (s as any).lastSeenLabel || (s as any).lastInteractedLabel || null,
      updatedAt: new Date().toISOString(),
    }));

    storage.saveCharacterSnapshots(snapshots as CharacterSummary[]);
    storage.saveLastScan(snapshots.length);
    storage.saveChatsIndex(chatIndex);

    // Persist session snapshot, but do NOT touch creators here.
    sessionCache = storage.updateSessionSnapshot({
      viewer,
      characters: snapshots as CharacterSummary[],
    });
    sessionCache = storage.markSectionUpdated('characters');
    if (viewer) sessionCache = storage.markSectionUpdated('viewer');
    broadcastSession();

    return { viewer, chats: chatIndex };
  } finally {
    inFastScan = false;
  }
});

ipcMain.handle('hydrate-chats-metadata', async (_event, urls: string[], limit?: number) => {
  if (!scraper) throw new Error('Scraper not initialized');
  hydrateCancelFlag.cancel = false;
  const progressChannel = 'hydrate-progress';
  const metadata = await scraper.hydrateChatsMetadata(urls, { limit, signal: () => hydrateCancelFlag.cancel });
  if (hydrateCancelFlag.cancel) {
    win?.webContents.send(progressChannel, { cancelled: true });
    return { cancelled: true, metadata: [] };
  }
  win?.webContents.send(progressChannel, { completed: metadata.length });
  return { cancelled: false, metadata };
});

ipcMain.handle('cancel-hydrate', async () => {
  hydrateCancelFlag.cancel = true;
  return { cancelled: true };
});

ipcMain.handle('refresh-characters-from-profile', async (_event, sortMode: 'most_chats' | 'alphabetical' | 'most_likes' = 'most_chats') => {
  if (!scraper) throw new Error('Scraper not initialized');
  const viewer = storage.getViewer() || sessionCache?.viewer;
  if (!viewer?.handle) throw new Error('Viewer handle unknown; refresh viewer first');
  const entries = await scraper.scrapeProfileCharacters(viewer.handle, sortMode).catch((e) => {
    win?.webContents.send('scraper-log', `[Profile] Failed: ${(e as Error).message}`);
    return [] as any[];
  });
  storage.saveCharactersIndex(entries);
  win?.webContents.send('characters-index-updated', entries);
  return entries;
});

ipcMain.handle('get-personas-index', async () => storage.getPersonasIndex());
ipcMain.handle('get-voices-index', async () => storage.getVoicesIndex());

ipcMain.handle('refresh-personas-index', async (_event, opts?: { maxItems?: number }) => {
  if (!scraper) throw new Error('Scraper not initialized');
  profileIndexCancelFlag.cancel = false;
  const entries = await scraper.indexProfileTab('personas', { maxItems: opts?.maxItems, signal: () => profileIndexCancelFlag.cancel }) as any[];
  if (profileIndexCancelFlag.cancel) return { cancelled: true, entries: [] };
  storage.savePersonasIndex(entries as any);
  sessionCache = storage.updateSessionSnapshot({ personas: entries as any });
  sessionCache = storage.markSectionUpdated('personas');
  win?.webContents.send('personas-index-updated', entries);
  broadcastSession();
  return { cancelled: false, entries };
});

ipcMain.handle('refresh-voices-index', async (_event, opts?: { maxItems?: number }) => {
  if (!scraper) throw new Error('Scraper not initialized');
  profileIndexCancelFlag.cancel = false;
  const entries = await scraper.indexProfileTab('voices', { maxItems: opts?.maxItems, signal: () => profileIndexCancelFlag.cancel }) as any[];
  if (profileIndexCancelFlag.cancel) return { cancelled: true, entries: [] };
  storage.saveVoicesIndex(entries as any);
  sessionCache = storage.updateSessionSnapshot({ voices: entries as any });
  sessionCache = storage.markSectionUpdated('voices');
  win?.webContents.send('voices-index-updated', entries);
  broadcastSession();
  return { cancelled: false, entries };
});

ipcMain.handle('cancel-profile-index', async () => {
  profileIndexCancelFlag.cancel = true;
  return { cancelled: true };
});

ipcMain.handle('get-characters-index', async () => storage.getCharactersIndex());

ipcMain.handle('remove-export-entry', async (_event, id: string) => {
  storage.removeEntry(id);
  return storage.getExportIndex();
});

ipcMain.handle('mark-export-opened', async (_event, id: string) => {
  storage.markOpened(id);
  return storage.getExportIndex();
});

ipcMain.handle('get-settings', async () => storage.getSettings());
ipcMain.handle('get-chats-index', async () => storage.getChatsIndex());

ipcMain.handle('save-settings', async (_event, partial: Partial<import('../types').Settings>) => storage.saveSettings(partial));

ipcMain.handle('choose-export-root', async () => {
  if (!win) throw new Error('Window not ready');
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (res.canceled || res.filePaths.length === 0) return storage.getSettings();
  const chosen = res.filePaths[0];
  return storage.saveSettings({ exportRootPath: chosen });
});

ipcMain.handle('reset-browser-profile', async () => {
  scraper?.close();
  scraper = null;
  const dir = storage.resetProfileDir();
  storage.clearCaches();
  sessionCache = storage.loadSessionSnapshot();
  broadcastSession();
  return { profileDir: dir };
});

function broadcastSession() {
  if (!win || !sessionCache) return;
  win.webContents.send('session-updated', sessionCache);
  win.webContents.send('scraper-log', `[Session] Saved session snapshot`);
}