import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { ScraperEngine } from './scraper';
import { resolveAnalyzerPath, runPythonAnalysis } from './analyzerRunner';

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

let win: BrowserWindow | null;
let scraper: ScraperEngine | null = null;

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
  const userDataDir = process.env.CAI_DUMPER_PROFILE_DIR || path.join(app.getPath('userData'), 'pw-profile');
  const cacheDir = path.join(app.getPath('temp'), 'cai-dumper-cache');
  scraper = new ScraperEngine(userDataDir, (log) => {
    win?.webContents.send('scraper-log', log);
  }, cacheDir);
}

app.on('window-all-closed', () => {
  if (scraper) scraper.close();
  win = null;
  if (process.platform !== 'darwin') app.quit();
});

app.whenReady().then(createWindow);

// --- IPC HANDLERS ---

ipcMain.handle('launch-browser', async () => {
  if (!scraper) return false;
  await scraper.launch();
  return true;
});

ipcMain.handle('fetch-chats', async () => {
  if (!scraper) throw new Error("Scraper not initialized");
  return await scraper.scanSidebar();
});

ipcMain.handle('export-chat', async (event, { url, characterName, reverseTranscript }) => {
  if (!scraper) throw new Error("Scraper not initialized");
  
  const rawMessages = await scraper.scrapeChat(url, { reverseTranscript });
  
  // Create Export Directory
  const exportBase = path.join(app.getPath('documents'), 'CAI_Exports', characterName.replace(/[^a-z0-9]/gi, '_'));
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
  fs.writeFileSync(path.join(chatDir, 'transcript.json'), JSON.stringify(rawMessages, null, 2));
  fs.writeFileSync(path.join(chatDir, 'meta.json'), JSON.stringify(meta, null, 2));

  if (rawMessages.length === 0) {
    const warning = "Export produced 0 messages; skipping analysis. Run 'Test selectors' to debug extraction.";
    win?.webContents.send('analysis-log', warning);
    return { path: chatDir, count: rawMessages.length, analysisSkipped: true, warning };
  }

  return { path: chatDir, count: rawMessages.length, analysisSkipped: false };
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

  return await runPythonAnalysis(scriptPath, jsonlPath, (log) => {
    win?.webContents.send('analysis-log', log);
  });
});

ipcMain.handle('open-folder', (event, p) => {
  shell.openPath(p);
});