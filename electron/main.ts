import { app, BrowserWindow, ipcMain, shell, dialog, BrowserView } from 'electron';
import path from 'path';
import fs from 'fs';
import { ScraperEngine } from './scraper';

// Enable remote debugging for Playwright to connect
app.commandLine.appendSwitch('remote-debugging-port', '9222');

import { StorageService } from './storage';
import { JobQueue } from './jobQueue';
import { resolveAnalyzerPath, runPythonAnalysis } from './analyzerRunner';
import { SessionSnapshot, ViewerProfile, ExportIndexEntry, TranscriptInsights, TranscriptMessage, CharacterSummary, QAReport } from '../types';

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

let win: BrowserWindow | null;
let browserView: BrowserView | null = null;
let scraper: ScraperEngine | null = null;
let qaMonitorTimer: NodeJS.Timeout | null = null;
let qaMonitorBusy = false;
let lastQAReport: QAReport | null = null;
let storage: StorageService;
let sessionCache: SessionSnapshot | null = null;
let hydrateCancelFlag = { cancel: false };
let profileIndexCancelFlag = { cancel: false };
const jobQueue = new JobQueue();
const sessionLogs: string[] = []; // Full history of logs for this session

let inFastScan = false;

const MAX_TRANSCRIPT_LINES_DEFAULT = 50_000;

function safeDateBucket(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function tinyHash(input: string): string {
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
  if (!fs.existsSync(transcriptPath)) {
    return {
      totalMessages: 0,
      viewerMessages: 0,
      characterMessages: 0,
      avgCharsPerMessage: 0,
      avgWordsPerMessage: 0,
      timelineBuckets: [],
      warnings: ['Transcript file not found'],
    };
  }

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

  // 1. Instrumentation & Debugging
  if (!app.isPackaged) {
    // win.webContents.openDevTools(); // Disabled by user request
    console.log('[Main] Debug: VITE_DEV_SERVER_URL =', VITE_DEV_SERVER_URL);
    console.log('[Main] Debug: DIST =', process.env.DIST);
    console.log('[Main] Debug: __dirname =', __dirname);
  }

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Main] Failed to load: ${validatedURL} (${errorCode}: ${errorDescription})`);
    if (errorCode !== -3) { // Ignore ERR_ABORTED
       dialog.showErrorBox('Load Failed', `Failed to load: ${validatedURL}\nError: ${errorDescription} (${errorCode})`);
    }
  });

  win.webContents.on('render-process-gone', (event, details) => {
    console.error(`[Main] Render process gone: ${details.reason}`);
  });

  win.webContents.on('unresponsive', () => {
    console.error('[Main] Window unresponsive');
  });

  // 2. Robust Loading Logic
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else if (!app.isPackaged) {
    // Fallback for dev if env var is missing (common in some setups)
    console.log('[Main] VITE_DEV_SERVER_URL missing, trying default http://localhost:5173');
    win.loadURL('http://localhost:5173');
  } else {
    // Production: load from dist
    const indexHtml = path.join(process.env.DIST!, 'index.html');
    if (!fs.existsSync(indexHtml)) {
        console.error(`[Main] Production index.html not found at: ${indexHtml}`);
        dialog.showErrorBox('Startup Error', `Could not find index.html at: ${indexHtml}`);
    }
    win.loadFile(indexHtml);
  }

  jobQueue.setWindow(win);

  const profileDir = storage.getProfileDir();
  const cacheDir = path.join(profileDir, 'cache');
  scraper = new ScraperEngine(profileDir, (log) => {
    sessionLogs.push(log); // Buffer log
    win?.webContents.send('scraper-log', log);
  }, cacheDir);

  scraper.setManualScrollHandler(async () => {
    // Pass null/undefined for window to make it non-modal, allowing interaction with the BrowserView
    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Manual Scroll Required (Action Needed)',
      message: 'Automatic scrolling seems to be stuck. Please scroll up manually in the chat view to load more history.',
      detail: 'Keep this dialog open while you scroll. Click "Continue" when you have loaded more messages.',
      buttons: ['Continue Auto-Scroll', 'Stop & Extract'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    return result.response === 0;
  });

  ipcMain.handle('save-logs', async (event, logs: string[]) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const { filePath } = await dialog.showSaveDialog(win!, {
        title: 'Save Application Logs',
        defaultPath: `cai-dumper-logs-${timestamp}.txt`,
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
    });

    if (filePath) {
        try {
            // Use the full session logs buffer instead of what the frontend sent
            const content = sessionLogs.length > 0 ? sessionLogs.join('\n') : logs.join('\n');
            fs.writeFileSync(filePath, content, 'utf-8');
            return { success: true, path: filePath };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }
    return { success: false, error: 'Cancelled' };
  });
  
  // Listen for intercepted data
  // Note: We need to expose an event emitter from ScraperEngine to do this properly
  // For now, the scraper logs directly.

  // Initialize BrowserView immediately for background persistence
  browserView = new BrowserView({
      webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          partition: 'persist:cai'
      }
  });
  
  // Enable debugging on BrowserView for scraper connection
  browserView.webContents.debugger.attach('1.1');
  
  // Live Sync: Monitor navigation
  browserView.webContents.on('did-navigate', (event, url) => {
      if (url.includes('/chat/')) {
          win?.webContents.send('scraper-log', `[Live] Detected navigation to chat: ${url}`);
          // Optional: Trigger auto-scrape if enabled
      }
  });

  // Load immediately so it's ready
  browserView.webContents.loadURL('https://character.ai/profile');
  // We don't attach it yet (or attach and hide)
  // win.setBrowserView(browserView); 
  // browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 });

  // Scraper now launches its own browser instance
  // No need for auto-connect to embedded session
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

// --- BrowserView Management ---
ipcMain.handle('show-browser-view', async (event, rect) => {
    if (!win) return;
    
    // Ensure BrowserView exists
    if (!browserView) {
        browserView = new BrowserView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
            }
        });
        browserView.webContents.loadURL('https://character.ai');
    }
    
    // Only attach if we have valid bounds to apply immediately
    if (rect) {
        // HEADER SAFEGUARD:
        // The header is 64px (h-16). We enforce a minimum Y of 64.
        // We also ensure the height doesn't push it off screen.
        const MIN_Y = 64;
        const safeY = Math.max(rect.y, MIN_Y);
        const safeHeight = rect.height - (safeY - rect.y);

        // Apply bounds BEFORE attaching to prevent flash of full-screen
        browserView.setBounds({
            x: Math.round(rect.x),
            y: Math.round(safeY),
            width: Math.round(rect.width),
            height: Math.round(safeHeight)
        });
        
        // Disable auto-resize to prevent Electron from messing with our manual layout
        browserView.setAutoResize({ width: false, height: false, horizontal: false, vertical: false });
        
        // Use addBrowserView instead of setBrowserView to avoid "fill window" behavior
        // Check if already attached to avoid duplicates
        const attachedViews = win.getBrowserViews();
        if (!attachedViews.includes(browserView)) {
            win.addBrowserView(browserView);
        }
        
        // CRITICAL: Re-apply bounds AFTER attaching. 
        // Some Electron versions reset bounds to full window on attachment.
        const applyBounds = () => {
            if (browserView && !browserView.webContents.isDestroyed()) {
                browserView.setBounds({
                    x: Math.round(rect.x),
                    y: Math.round(safeY),
                    width: Math.round(rect.width),
                    height: Math.round(safeHeight)
                });
            }
        };
        
        applyBounds();
        // Double-tap: Apply again after a short delay to fight race conditions
        setTimeout(applyBounds, 50);
        setTimeout(applyBounds, 200);
        
        // Focus
        browserView.webContents.focus();
    }
});

ipcMain.handle('hide-browser-view', async () => {
    if (!win || !browserView) return;
    win.removeBrowserView(browserView);
});

ipcMain.handle('resize-browser-view', async (event, rect) => {
    if (browserView) {
        // HEADER SAFEGUARD (Same as show-browser-view)
        const MIN_Y = 64;
        const safeY = Math.max(rect.y, MIN_Y);
        const safeHeight = rect.height - (safeY - rect.y);
        
        browserView.setBounds({
            x: Math.round(rect.x),
            y: Math.round(safeY),
            width: Math.round(rect.width),
            height: Math.round(safeHeight)
        });
    }
});

ipcMain.handle('set-always-on-top', async (event, flag) => {
    if (win) {
        win.setAlwaysOnTop(flag);
    }
});

let detachedWindow: BrowserWindow | null = null;

ipcMain.handle('detach-browser', async () => {
    if (!browserView || !win) return;
    
    const url = browserView.webContents.getURL();
    win.removeBrowserView(browserView); // Hide embedded
    
    if (detachedWindow && !detachedWindow.isDestroyed()) {
        detachedWindow.focus();
        return;
    }

    detachedWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: 'persist:cai' // Share session
        }
    });
    
    detachedWindow.loadURL(url);
    
    // Live Sync for Detached Window
    detachedWindow.webContents.on('did-navigate', (event, url) => {
         if (url.includes('/chat/')) {
            win?.webContents.send('scraper-log', `[Live] Detected navigation in detached window: ${url}`);
         }
    });

    detachedWindow.on('closed', () => {
        detachedWindow = null;
        win?.webContents.send('browser-detached-closed');
    });
});

ipcMain.handle('attach-browser', async () => {
    if (detachedWindow && !detachedWindow.isDestroyed()) {
        detachedWindow.close();
    }
    // The frontend will call show-browser-view immediately after this
});

ipcMain.handle('scrape-current-page', async () => {
    if (!browserView) return { success: false, message: "No browser view active" };
    
    try {
        const url = browserView.webContents.getURL();
        
        // Basic extraction script
        const data = await browserView.webContents.executeJavaScript(`
            (() => {
                return {
                    url: window.location.href,
                    title: document.title,
                };
            })()
        `);
        
        win?.webContents.send('scraper-log', `[Live] Captured data from ${data.title}`);
        return { success: true, message: "Scraped successfully", data };
    } catch (e) {
        return { success: false, message: (e as Error).message };
    }
});

    // Launch Browser Only
    ipcMain.handle('launch-browser', async () => {
        if (!scraper) {
            const userDataDir = path.join(app.getPath('userData'), 'scraper-session');
            const logCallback = (msg: string) => {
               if (win && !win.isDestroyed()) {
                  win.webContents.send('scraper-log', msg);
               }
            };
            scraper = new ScraperEngine(userDataDir, logCallback);
        }
        await scraper.init();
        return true; 
    });

    // Check Status
    ipcMain.handle('check-browser-status', async () => {
        if (!scraper) return false;
        // @ts-ignore
        return !!scraper.page && !scraper.page.isClosed();
    });

async function runSidebarScan() {
  return jobQueue.add('scan', async () => {
    if (!scraper) throw new Error("Scraper not initialized");
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
}

ipcMain.handle('fetch-chats', async () => {
  return runSidebarScan();
});

ipcMain.handle('refresh-sidebar-scan', async () => {
    return runSidebarScan();
});

ipcMain.handle('export-chat', async (event, { url, characterName, reverseTranscript, avatarUrl }) => {
  return jobQueue.add('export', async () => {
    if (!scraper) throw new Error("Scraper not initialized");
    
    win?.webContents.send('scraper-log', `[Export] Starting export for ${characterName} from ${url}`);
    
    // Ensure scraper browser is launched
    if (!scraper.isLaunched()) {
      win?.webContents.send('scraper-log', `[Export] Connecting to BrowserView for network interception...`);
      await scraper.launch('http://localhost:9222');
      win?.webContents.send('scraper-log', `[Export] Network interception ready`);
    }

    try {
        // Scrape with optimized settings
        win?.webContents.send('scraper-log', `[Export] Scraping chat data...`);
        const scrapeResult = await scraper.scrapeChat(url, { reverseTranscript, characterName });
        const rawMessages = scrapeResult.messages;
        
        win?.webContents.send('scraper-log', `[Export] Scraped ${rawMessages.length} messages`);
        
        const settings = storage?.getSettings();
        const exportRoot = settings?.exportRootPath || path.join(app.getPath('documents'), 'CAI_Exports');
        const exportBase = path.join(exportRoot, characterName.replace(/[^a-z0-9]/gi, '_'));
        const chatId = url.split('/').pop() || 'unknown_id';
        const chatDir = path.join(exportBase, chatId);
        
        win?.webContents.send('scraper-log', `[Export] Saving to ${chatDir}`);
        
        if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });

        const meta = {
            characterName,
            chatId,
            url,
            exportedAt: new Date().toISOString(),
            messageCount: rawMessages.length,
        };

        const viewerHandle = sessionCache?.viewer?.handle || 'You';
        const charHeader = characterName || 'Character';

        // 1. JSONL (Canonical) - Streamed
        const jsonlPath = path.join(chatDir, 'transcript.jsonl');
        const jsonStream = fs.createWriteStream(jsonlPath, { flags: 'w' });
        for (const msg of rawMessages) {
            jsonStream.write(JSON.stringify(msg) + '\n');
        }
        jsonStream.end();

        // 2. Markdown - Streamed
        const mdPath = path.join(chatDir, 'transcript.md');
        const mdStream = fs.createWriteStream(mdPath, { flags: 'w' });
        mdStream.write(`# Chat with ${characterName}\n\n`);
        for (const msg of rawMessages) {
            // Fix Header Flip: Use scraper's role detection
            const header = msg.role === 'user' ? viewerHandle : charHeader;
            mdStream.write(`**${header}:**\n${msg.text}\n\n---\n\n`);
        }
        mdStream.end();

        // 3. Meta & Diagnostics
        const metaPath = path.join(chatDir, 'meta.json');
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        
        if (scrapeResult.diagnostics) {
            fs.writeFileSync(path.join(chatDir, 'diagnostics.json'), JSON.stringify(scrapeResult.diagnostics, null, 2));
        }

        if (rawMessages.length === 0) {
            const warning = "Export produced 0 messages; skipping analysis. Run 'Test selectors' to debug extraction.";
            win?.webContents.send('analysis-log', warning);
            return { path: chatDir, count: rawMessages.length, analysisSkipped: true, warning };
        }

        const summaryPath = fs.existsSync(path.join(chatDir, 'summary.md')) ? path.join(chatDir, 'summary.md') : null;
        const recorded = storage?.recordExport({
            chatId,
            chatUrl: url,
            characterName,
            characterAvatarUrl: avatarUrl || null,
            viewerHandle: viewerHandle === 'You' ? null : viewerHandle,
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
    } catch (error) {
        win?.webContents.send('scraper-log', `[Export] Error during scraping: ${error}`);
        throw error;
    }
  });
});

ipcMain.handle('test-selectors', async () => {
  if (!scraper) throw new Error("Scraper not initialized");
  return await scraper.testSelectors();
});

ipcMain.handle('run-analysis', async (event, { folderPath }) => {
  return jobQueue.add('analysis', async () => {
    const jsonlPath = path.join(folderPath, 'transcript.jsonl');
    if (!fs.existsSync(jsonlPath)) throw new Error("transcript.jsonl not found in folder");

    const { scriptPath, tried } = resolveAnalyzerPath();
    win?.webContents.send('analysis-log', `Using analyzer: ${scriptPath}`);

    const output = await runPythonAnalysis(scriptPath, jsonlPath, (log) => {
        win?.webContents.send('analysis-log', log);
    });

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
});

ipcMain.handle('export-diagnostics', async () => {
    const diagPath = path.join(app.getPath('documents'), 'CAI_Exports', 'diagnostics');
    if (!fs.existsSync(diagPath)) fs.mkdirSync(diagPath, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folder = path.join(diagPath, `diag_${timestamp}`);
    fs.mkdirSync(folder);

    const info = {
        appVersion: app.getVersion(),
        electron: process.versions.electron,
        node: process.versions.node,
        platform: process.platform,
        settings: storage.getSettings(),
        session: sessionCache,
        exportIndex: storage.getExportIndex()
    };

    fs.writeFileSync(path.join(folder, 'system_info.json'), JSON.stringify(info, null, 2));
    await shell.openPath(folder);
    return folder;
});

ipcMain.handle('cancel-job', async () => jobQueue.cancelCurrent());

ipcMain.handle('open-folder', (event, p) => {
  shell.openPath(p);
});

ipcMain.handle('open-path-in-explorer', async (_event, p: string) => {
  if (!p) return;
  try {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      await shell.openPath(p);
    } else {
      shell.showItemInFolder(p);
    }
  } catch {
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
  if (!inputPath) throw new Error('Path is required');
  
  let p = inputPath;
  // If it is a directory, or doesn't look like a jsonl file, assume it's a folder path
  if ((fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory()) || !inputPath.toLowerCase().endsWith('.jsonl')) {
    p = path.join(inputPath, 'transcript.jsonl');
  }

  if (!fs.existsSync(p)) {
    return { transcriptPath: p, messages: [], warnings: ['Transcript file not found. The folder may have been deleted or moved.'] };
  }

  const { messages, warnings } = await readTranscriptJsonl(p, maxLines || MAX_TRANSCRIPT_LINES_DEFAULT);
  return { transcriptPath: p, messages, warnings };
});

ipcMain.handle('read-transcript-page', async (_event, transcriptPath: string, opts?: { direction: 'older' | 'newer'; fromLine?: number; pageSize: number; currentMaxLines?: number }) => {
  if (!transcriptPath) throw new Error('transcriptPath is required');
  const direction = opts?.direction || 'older';
  const pageSize = Math.max(1, Number(opts?.pageSize) || 25_000);
  const currentMaxLines = Math.max(1, Number(opts?.currentMaxLines) || MAX_TRANSCRIPT_LINES_DEFAULT);

  if (direction !== 'older') {
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
  return jobQueue.add('refresh-viewer', async () => {
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
});

ipcMain.handle('refresh-creator-profiles', async (_event, usernames: string[]) => {
  if (!scraper) throw new Error('Scraper not initialized');
  if (inFastScan) {
    throw new Error('[Invariant] Creator hydration attempted during fast scan');
  }

  hydrateCancelFlag.cancel = false;
  const progressChannel = 'creator-hydrate-progress';

  const creators: Record<string, any> = sessionCache?.creators ? { ...sessionCache.creators } : {};
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

  const queue = [...unique];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }).map(async () => {
    while (queue.length && !hydrateCancelFlag.cancel) {
      const next = queue.shift();
      if (!next) break;
      await runOne(next);
      await new Promise((r) => setTimeout(r, 250));
    }
  });
  await Promise.all(workers);

  if (hydrateCancelFlag.cancel) {
    win?.webContents.send(progressChannel, { total: unique.length, completed, updated, failed, cancelled: true });
    return { session: sessionCache, updated, message: 'Cancelled' };
  }

  sessionCache = storage.updateSessionSnapshot({ creators: creators as any });
  sessionCache = storage.markSectionUpdated('creators');
  broadcastSession();
  win?.webContents.send('creators-index-updated', creators);
  return { session: sessionCache, updated, message: updated === 0 ? 'No creators updated' : undefined };
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
  const entries = await scraper.scrapeProfileCharacters(viewer.handle, sortMode).catch((e: any) => {
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

ipcMain.handle('scrape-followers-list', async (_, type: 'followers' | 'following') => {
  if (!scraper) throw new Error("Scraper not initialized");
  return await scraper.scrapeFollowersList(type);
});

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

ipcMain.handle('run-diagnostics', async () => {
  if (!scraper) {
    const report = buildUnavailableQAReport('Scraper not initialized');
    lastQAReport = report;
    return report;
  }
    try {
        const report = await scraper.runDiagnostics();
        lastQAReport = report;
        return report;
    } catch (e: any) {
    const report = buildUnavailableQAReport(e.message || 'Diagnostics failed');
    lastQAReport = report;
    return report;
    }
  });

const buildUnavailableQAReport = (message: string): QAReport => ({
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  durationMs: 0,
  url: undefined,
  checks: [
    {
      id: 'browser',
      name: 'Browser Connection',
      status: 'fail',
      message,
      details: null,
      timestamp: new Date().toISOString()
    }
  ],
  summary: { pass: 0, warn: 0, fail: 1, info: 0 }
});

const runQAMonitorCycle = async () => {
  if (!scraper || !win) return;
  if (qaMonitorBusy) return;
  qaMonitorBusy = true;
  try {
    const report = await scraper.runDiagnostics();
    lastQAReport = report;
    win.webContents.send('qa-report', report);
  } catch (e: any) {
    win.webContents.send('qa-report', {
      error: e?.message || 'QA monitor error'
    });
  } finally {
    qaMonitorBusy = false;
  }
};

ipcMain.handle('start-qa-monitor', async (_event, intervalMs?: number) => {
  if (!scraper) {
    lastQAReport = buildUnavailableQAReport('Scraper not initialized');
    return { active: false, lastReport: lastQAReport };
  }
  if (qaMonitorTimer) return { active: true, lastReport: lastQAReport };
  const interval = typeof intervalMs === 'number' && intervalMs >= 1000 ? intervalMs : 3000;
  qaMonitorTimer = setInterval(runQAMonitorCycle, interval);
  runQAMonitorCycle();
  return { active: true, lastReport: lastQAReport };
});

ipcMain.handle('stop-qa-monitor', async () => {
  if (qaMonitorTimer) {
    clearInterval(qaMonitorTimer);
    qaMonitorTimer = null;
  }
  return { active: false, lastReport: lastQAReport };
});

ipcMain.handle('get-qa-state', async () => ({
  active: Boolean(qaMonitorTimer),
  lastReport: lastQAReport
}));

const getQAWebContentsTargets = () => {
  const targets: any[] = [];
  if (browserView && !browserView.webContents.isDestroyed()) {
    targets.push(browserView.webContents);
  }
  if (detachedWindow && !detachedWindow.isDestroyed()) {
    targets.push(detachedWindow.webContents);
  }
  return targets;
};

ipcMain.handle('qa-overlay', async (_event, enable: boolean) => {
  const script = `
    (function() {
      const ID = 'cai-qa-overlay';
      const LABEL = 'cai-qa-overlay-label';
      const existing = document.getElementById(ID);
      const existingLabel = document.getElementById(LABEL);
      if (!${enable}) {
        if (existing) existing.remove();
        if (existingLabel) existingLabel.remove();
        return { enabled: false };
      }

      const canScroll = (el) => {
        const maxScroll = el.scrollHeight - el.clientHeight;
        if (maxScroll <= 0) return false;
        const prev = el.scrollTop;
        const next = Math.min(prev + 100, maxScroll);
        el.scrollTop = next;
        const changed = el.scrollTop !== prev;
        el.scrollTop = prev;
        return changed;
      };

      const findScrollable = () => {
        const centerEl = document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.75);
        if (centerEl) {
          let curr = centerEl;
          while (curr && curr !== document.body) {
            if (curr.scrollHeight > curr.clientHeight + 50 && canScroll(curr)) return curr;
            curr = curr.parentElement;
          }
        }
        const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
          if (el.clientHeight < 50) return false;
          return el.scrollHeight > el.clientHeight + 100 && canScroll(el);
        });
        candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
        return candidates[0] || document.scrollingElement || document.body;
      };

      const target = findScrollable();
      if (!target) return { enabled: true, found: false };

      const rect = target.getBoundingClientRect();
      let overlay = existing;
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = ID;
        overlay.style.position = 'fixed';
        overlay.style.pointerEvents = 'none';
        overlay.style.border = '2px solid #f97316';
        overlay.style.background = 'rgba(249, 115, 22, 0.08)';
        overlay.style.zIndex = '2147483647';
        document.body.appendChild(overlay);
      }

      overlay.style.left = rect.left + 'px';
      overlay.style.top = rect.top + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';

      let label = existingLabel;
      if (!label) {
        label = document.createElement('div');
        label.id = LABEL;
        label.style.position = 'fixed';
        label.style.pointerEvents = 'none';
        label.style.background = 'rgba(15, 23, 42, 0.9)';
        label.style.color = '#e2e8f0';
        label.style.fontSize = '12px';
        label.style.padding = '4px 6px';
        label.style.borderRadius = '6px';
        label.style.zIndex = '2147483647';
        document.body.appendChild(label);
      }

      label.textContent = target.tagName.toLowerCase() + '.' + (target.className || '').toString().split(' ').slice(0, 2).join('.') + ' (scroll)';
      label.style.left = Math.max(8, rect.left) + 'px';
      label.style.top = Math.max(8, rect.top - 26) + 'px';

      return {
        enabled: true,
        found: true,
        tag: target.tagName.toLowerCase(),
        className: target.className,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      };
    })();
  `;

  const results = [] as any[];
  for (const wc of getQAWebContentsTargets()) {
    results.push(await wc.executeJavaScript(script));
  }
  return { results };
});

ipcMain.handle('force-scroll-probe', async () => {
  const script = `
    (function() {
      const canScroll = (el) => {
        const maxScroll = el.scrollHeight - el.clientHeight;
        if (maxScroll <= 0) return false;
        const prev = el.scrollTop;
        const next = Math.min(prev + 100, maxScroll);
        el.scrollTop = next;
        const changed = el.scrollTop !== prev;
        el.scrollTop = prev;
        return changed;
      };

      const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
        if (el.clientHeight < 80) return false;
        return el.scrollHeight > el.clientHeight + 100 && canScroll(el);
      }).map(el => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          className: el.className,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          scrollTop: el.scrollTop,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      });

      candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
      return candidates.slice(0, 10);
    })();
  `;

  const results = [] as any[];
  for (const wc of getQAWebContentsTargets()) {
    results.push(await wc.executeJavaScript(script));
  }
  return { results };
});

ipcMain.handle('save-qa-snapshot', async () => {
  const report = scraper ? await scraper.runDiagnostics() : buildUnavailableQAReport('Scraper not initialized');
  lastQAReport = report;

  const baseDir = path.join(app.getPath('documents'), 'CAI_Exports', 'diagnostics', 'qa_snapshots');
  fs.mkdirSync(baseDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(baseDir, `qa_snapshot_${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));

  return { path: filePath };
});

  ipcMain.handle('toggle-snow', async (event, enable: boolean) => {
    // Vanilla JS Snow Logic to be injected
    const snowScript = `
        (function() {
            const ID = 'cai-dumper-snow-canvas';
            const existing = document.getElementById(ID);
            
            if (!${enable}) {
                if (existing) existing.remove();
                window.caiSnowActive = false;
                return;
            }
            
            if (existing) return; // Already running
            window.caiSnowActive = true;

            const canvas = document.createElement('canvas');
            canvas.id = ID;
            Object.assign(canvas.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100vw',
                height: '100vh',
                pointerEvents: 'none',
                zIndex: '2147483647' // Max z-index
            });
            document.body.appendChild(canvas);

            const ctx = canvas.getContext('2d');
            let w = window.innerWidth;
            let h = window.innerHeight;
            canvas.width = w;
            canvas.height = h;

            const particles = [];
            const count = 100;
            for(let i=0; i<count; i++) {
                particles.push({
                    x: Math.random() * w,
                    y: Math.random() * h,
                    r: Math.random() * 3 + 1, // radius 1-4
                    d: Math.random() * count, // density factor
                    xv: (Math.random() - 0.5) * 1, // x velocity
                    yv: Math.random() * 2 + 1      // y velocity (speed)
                });
            }

            function animate() {
                if (!document.getElementById(ID)) return;
                ctx.clearRect(0, 0, w, h);
                ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
                ctx.beginPath();
                for (let i = 0; i < count; i++) {
                    const p = particles[i];
                    ctx.moveTo(p.x, p.y);
                    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2, true);
                }
                ctx.fill();
                update();
                requestAnimationFrame(animate);
            }

            let angle = 0;
            function update() {
                angle += 0.01;
                for (let i = 0; i < count; i++) {
                    const p = particles[i];
                    // Updating coordinates
                    p.y += p.yv; // Gravity
                    p.x += Math.sin(angle + p.d) + p.xv; // Sway

                    // Sending flakes back from the top
                    if (p.x > w+5 || p.x < -5 || p.y > h) {
                        if (i % 3 > 0) { // 66% of the flakes
                            particles[i] = { x: Math.random() * w, y: -10, r: p.r, d: p.d, xv: p.xv, yv: p.yv };
                        } else {
                            // If the flake is exitting from the right
                            if (Math.sin(angle) > 0) {
                                // Enter from the left
                                particles[i] = { x: -5, y: Math.random() * h, r: p.r, d: p.d, xv: p.xv, yv: p.yv };
                            } else {
                                // Enter from the right
                                particles[i] = { x: w + 5, y: Math.random() * h, r: p.r, d: p.d, xv: p.xv, yv: p.yv };
                            }
                        }
                    }
                }
            }
            
            window.addEventListener('resize', () => {
                w = window.innerWidth;
                h = window.innerHeight;
                canvas.width = w;
                canvas.height = h;
            });

            animate();
        })();
    `;

    try {
        if (browserView && !browserView.webContents.isDestroyed()) {
             await browserView.webContents.executeJavaScript(snowScript);
        }
        
        // Also toggle for detached window if exists
        if (detachedWindow && !detachedWindow.isDestroyed()) {
             await detachedWindow.webContents.executeJavaScript(snowScript);
        }
    } catch (e) {
        console.error('Failed to toggle snow on views', e);
    }
});

ipcMain.handle('test-scroll', async () => {
    if (!scraper) return { error: 'Scraper not initialized' };
    try {
        const success = await scraper.testScroll();
        return { success };
    } catch (e: any) {
        return { error: e.message };
    }
  });

function broadcastSession() {
  if (!win || !sessionCache) return;
  win.webContents.send('session-updated', sessionCache);
  win.webContents.send('scraper-log', `[Session] Saved session snapshot`);
}

//# sourceMappingURL=main.js.map
