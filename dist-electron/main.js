"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const playwright = require("playwright");
const child_process = require("child_process");
class ScraperEngine {
  constructor(userDataDir, logCallback, cacheDir) {
    __publicField(this, "browserContext", null);
    __publicField(this, "page", null);
    __publicField(this, "userDataDir");
    __publicField(this, "cacheDir");
    __publicField(this, "logCallback");
    this.userDataDir = userDataDir;
    this.cacheDir = cacheDir || path.join(userDataDir, "cache");
    this.logCallback = logCallback;
  }
  log(msg) {
    console.log(`[Scraper] ${msg}`);
    this.logCallback(msg);
  }
  async launch() {
    this.log("Launching persistent Chromium context...");
    try {
      if (!fs.existsSync(this.userDataDir)) fs.mkdirSync(this.userDataDir, { recursive: true });
      if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });
      this.browserContext = await playwright.chromium.launchPersistentContext(this.userDataDir, {
        headless: false,
        viewport: null,
        args: [
          "--start-maximized",
          "--disable-blink-features=AutomationControlled",
          `--disk-cache-dir=${this.cacheDir}`,
          "--disable-gpu-cache"
        ]
      });
    } catch (err) {
      this.log(`Warning: Failed to create cache/user data dir (${err.message}). Continuing without custom cache.`);
      this.browserContext = await playwright.chromium.launchPersistentContext(this.userDataDir, {
        headless: false,
        viewport: null,
        args: ["--start-maximized", "--disable-blink-features=AutomationControlled", "--disable-gpu-cache"]
      });
    }
    this.page = await this.browserContext.newPage();
    await this.page.goto("https://character.ai");
    this.log("Browser ready. Please log in manually in the opened window.");
  }
  async close() {
    if (this.browserContext) await this.browserContext.close();
  }
  async scanSidebar() {
    if (!this.page) throw new Error("Browser not launched");
    this.log("Scanning sidebar for chats...");
    try {
      await this.page.waitForSelector('a[href*="/chat/"]', { timeout: 5e3 });
    } catch (e) {
      this.log("No chat links found immediately. Please ensure sidebar is open.");
      return [];
    }
    const chats = /* @__PURE__ */ new Map();
    for (let i = 0; i < 3; i++) {
      const elements = await this.page.$$('a[href*="/chat/"]');
      this.log(`Found ${elements.length} potential chat links (Pass ${i + 1})...`);
      for (const el of elements) {
        const href = await el.getAttribute("href");
        if (!href) continue;
        const fullUrl = href.startsWith("http") ? href : `https://character.ai${href}`;
        const text = await el.innerText();
        const lines = text.split("\n").filter((l) => l.trim().length > 0);
        const name = lines[0] || "Unknown Character";
        const preview = lines[1] || "";
        if (!chats.has(fullUrl)) {
          chats.set(fullUrl, { name, url: fullUrl, preview });
        }
      }
      if (elements.length > 0) {
        await elements[elements.length - 1].scrollIntoViewIfNeeded();
        await this.page.waitForTimeout(1e3);
      }
    }
    return Array.from(chats.values());
  }
  async scrapeChat(url, options) {
    var _a;
    if (!this.page) throw new Error("Browser not launched");
    this.log(`Navigating to ${url}...`);
    await this.page.goto(url);
    await this.page.waitForTimeout(3e3);
    this.log("Starting scroll-to-top sequence...");
    this.page.locator('[data-testid="message-row"]').last();
    let noNewMessagesCount = 0;
    let previousMsgCount = 0;
    for (let i = 0; i < 50; i++) {
      const msgCount = await this.page.locator('[data-testid="message-row"]').count();
      if (msgCount > previousMsgCount) {
        this.log(`Loaded ${msgCount} messages...`);
        previousMsgCount = msgCount;
        noNewMessagesCount = 0;
      } else {
        noNewMessagesCount++;
      }
      if (noNewMessagesCount > 3) {
        this.log("No new messages found after 3 scrolls. Assuming top reached.");
        break;
      }
      await this.page.evaluate(() => {
        const allDivs = Array.from(document.querySelectorAll("div"));
        const scrollable = allDivs.find((d) => d.scrollHeight > d.clientHeight && d.scrollTop > 0);
        if (scrollable) {
          scrollable.scrollTop = 0;
        } else {
          window.scrollTo(0, 0);
        }
      });
      await this.page.waitForTimeout(1500);
    }
    this.log("Extracting message content...");
    const extraction = await this.page.evaluate(() => {
      const containerCandidates = [
        { name: "main-role-log", selector: 'main [role="log"]', priority: 3 },
        { name: "main-role-feed", selector: 'main [role="feed"]', priority: 3 },
        { name: "main-aria-message", selector: 'main [aria-label*="message" i]', priority: 2 },
        { name: "main", selector: "main", priority: 1 }
      ];
      const messageSelectors = [
        { name: "article", selector: "article" },
        { name: "role-article", selector: '[role="article"]' },
        { name: "role-listitem", selector: '[role="listitem"]' },
        { name: "div-has-more", selector: 'div:has(button[aria-label*="more" i])' }
      ];
      const cleanText = (text) => {
        const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
        const junk = /^(Copy|Report|Share|Like|Reply|Menu|More)$/i;
        const kept = lines.filter((l) => !junk.test(l) && l.length > 1);
        return kept.join("\n").trim();
      };
      const inferRole = (el) => {
        var _a2;
        const dataset = el.dataset;
        if (dataset["isUser"] === "true" || dataset["author"] === "user") return "user";
        const text = el.textContent || "";
        if (/\bYou\b/i.test(text)) return "user";
        const style = window.getComputedStyle(el);
        if (style.textAlign === "right") return "user";
        if ((_a2 = style.justifyContent) == null ? void 0 : _a2.includes("flex-end")) return "user";
        return "char";
      };
      const containerResults = containerCandidates.map((c) => {
        const root2 = document.querySelector(c.selector);
        const messageCounts = messageSelectors.map((ms) => {
          const nodes2 = root2 ? Array.from(root2.querySelectorAll(ms.selector)) : [];
          const sampleTexts = nodes2.slice(0, 2).map((n) => cleanText(n.innerText)).filter(Boolean);
          return { selector: ms.selector, name: ms.name, count: nodes2.length, sampleTexts };
        });
        const total = messageCounts.reduce((sum, m) => sum + m.count, 0);
        return { container: c.selector, containerName: c.name, priority: c.priority, total, messageCounts, outerHTML: (root2 == null ? void 0 : root2.outerHTML) || "" };
      });
      const bestContainer = containerResults.filter((r) => r.total > 0).sort((a, b) => b.priority - a.priority || b.total - a.total)[0] || containerResults[0];
      const chosenContainerSelector = (bestContainer == null ? void 0 : bestContainer.container) || null;
      const root = chosenContainerSelector ? document.querySelector(chosenContainerSelector) : document;
      const bestMessageSelector = ((bestContainer == null ? void 0 : bestContainer.messageCounts) || []).slice().sort((a, b) => b.count - a.count)[0];
      const chosenMessageSelector = (bestMessageSelector == null ? void 0 : bestMessageSelector.selector) || messageSelectors[0].selector;
      const nodes = Array.from(root ? root.querySelectorAll(chosenMessageSelector) : []);
      const messages2 = nodes.map((el, idx) => {
        const textRaw = el.innerText;
        const text = cleanText(textRaw);
        return {
          turn_index: idx,
          role: inferRole(el),
          text,
          html: el.innerHTML,
          top: el.getBoundingClientRect().top
        };
      }).filter((m) => m.text && m.text.trim().length > 1);
      const deduped = [];
      for (const msg of messages2) {
        const last = deduped[deduped.length - 1];
        if (last && last.text === msg.text && last.role === msg.role) continue;
        deduped.push(msg);
      }
      let ordered = deduped;
      if (deduped.length >= 2) {
        const firstTop = deduped[0].top;
        const lastTop = deduped[deduped.length - 1].top;
        if (lastTop < firstTop) {
          ordered = [...deduped].reverse();
        }
      }
      const containerSnippet = ((bestContainer == null ? void 0 : bestContainer.outerHTML) || "").slice(0, 500);
      return {
        chosenContainer: chosenContainerSelector,
        chosenMessageSelector,
        containerResults,
        messages: ordered.map((m, i) => ({
          turn_index: i,
          role: m.role,
          text: m.text,
          html: m.html
        })),
        containerSnippet
      };
    });
    let messages = extraction.messages;
    if (options == null ? void 0 : options.reverseTranscript) {
      messages = [...messages].reverse().map((m, idx) => ({ ...m, turn_index: idx }));
    }
    if (messages.length === 0) {
      this.log(`Extracted 0 messages. Container snippet: ${extraction.containerSnippet}`);
      this.log(`Selector counts: ${JSON.stringify((_a = extraction.containerResults) == null ? void 0 : _a.map((r) => ({ container: r.containerName, total: r.total, counts: r.messageCounts.map((m) => ({ name: m.name, count: m.count })) })), null, 2)}`);
    } else {
      this.log(`Extracted ${messages.length} messages.`);
    }
    return messages;
  }
  async testSelectors() {
    if (!this.page) throw new Error("Browser not launched");
    const diagnostics = await this.page.evaluate(() => {
      const url = location.href;
      const containerCandidates = [
        { name: "main-role-log", selector: 'main [role="log"]', priority: 3 },
        { name: "main-role-feed", selector: 'main [role="feed"]', priority: 3 },
        { name: "main-aria-message", selector: 'main [aria-label*="message" i]', priority: 2 },
        { name: "main", selector: "main", priority: 1 }
      ];
      const messageSelectors = [
        { name: "article", selector: "article" },
        { name: "role-article", selector: '[role="article"]' },
        { name: "role-listitem", selector: '[role="listitem"]' },
        { name: "div-has-more", selector: 'div:has(button[aria-label*="more" i])' }
      ];
      const cleanText = (text) => {
        const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
        const junk = /^(Copy|Report|Share|Like|Reply|Menu|More)$/i;
        const kept = lines.filter((l) => !junk.test(l) && l.length > 1);
        return kept.join("\n").trim();
      };
      const results = containerCandidates.map((c) => {
        const root = document.querySelector(c.selector);
        const messageCounts = messageSelectors.map((ms) => {
          const nodes = root ? Array.from(root.querySelectorAll(ms.selector)) : [];
          const sampleTexts = nodes.slice(0, 2).map((n) => cleanText(n.innerText)).filter(Boolean);
          return { messageSelector: ms.selector, messageName: ms.name, count: nodes.length, sampleTexts };
        });
        const total = messageCounts.reduce((sum, m) => sum + m.count, 0);
        return { container: c.selector, containerName: c.name, total, priority: c.priority, messageCounts };
      });
      const chosen = results.filter((r) => r.total > 0).sort((a, b) => b.priority - a.priority || b.total - a.total)[0] || results[0];
      const scrollCandidates = Array.from(document.querySelectorAll("div")).slice(0, 200).map((el, idx) => {
        el.getBoundingClientRect();
        const scrollable = el.scrollHeight > el.clientHeight + 20;
        return scrollable ? { idx, height: el.scrollHeight, visibleHeight: el.clientHeight } : null;
      }).filter(Boolean);
      const selectedScroll = scrollCandidates.reduce((best, curr) => {
        if (!curr) return best;
        if (!best || curr.height > best.height) return curr;
        return best;
      }, null);
      const sidebarLinks = Array.from(document.querySelectorAll('a[href*="/chat/"]')).length;
      return { url, selectorResults: results, chosenContainer: chosen == null ? void 0 : chosen.container, scrollCandidates, selectedScroll, sidebarLinks };
    });
    this.log(`Selector test: ${JSON.stringify(diagnostics, null, 2)}`);
    return diagnostics;
  }
}
function resolveAnalyzerPath() {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const appPath = electron.app.getAppPath();
  const candidates = [
    path.join(projectRoot, "python", "analyzer.py"),
    path.join(appPath, "python", "analyzer.py"),
    path.join(process.cwd(), "python", "analyzer.py"),
    path.join(__dirname, "../python", "analyzer.py")
  ];
  const tried = [];
  for (const candidate of candidates) {
    tried.push(candidate);
    if (fs.existsSync(candidate)) {
      return { scriptPath: candidate, tried };
    }
  }
  throw new Error(`Unable to locate analyzer.py. Tried:
${tried.join("\n")}`);
}
function runPythonAnalysis(scriptPath, jsonlPath, onLog) {
  return new Promise((resolve, reject) => {
    onLog(`Starting Python analysis on ${jsonlPath}...`);
    const pythonProcess = child_process.spawn("python", [scriptPath, jsonlPath]);
    let outputData = "";
    pythonProcess.stdout.on("data", (data) => {
      const msg = data.toString();
      onLog(`[Python] ${msg}`);
      outputData += msg;
    });
    pythonProcess.stderr.on("data", (data) => {
      onLog(`[Python ERR] ${data.toString()}`);
    });
    pythonProcess.on("close", (code) => {
      if (code === 0) {
        onLog("Analysis complete.");
        resolve(outputData);
      } else {
        reject(new Error(`Python script exited with code ${code}`));
      }
    });
  });
}
process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_PUBLIC = electron.app.isPackaged ? process.env.DIST : path.join(process.env.DIST, "../public");
let win;
let scraper = null;
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
function createWindow() {
  win = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0f0f11",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(process.env.DIST, "index.html"));
  }
  const userDataDir = process.env.CAI_DUMPER_PROFILE_DIR || path.join(electron.app.getPath("userData"), "pw-profile");
  const cacheDir = path.join(electron.app.getPath("temp"), "cai-dumper-cache");
  scraper = new ScraperEngine(userDataDir, (log) => {
    win == null ? void 0 : win.webContents.send("scraper-log", log);
  }, cacheDir);
}
electron.app.on("window-all-closed", () => {
  if (scraper) scraper.close();
  win = null;
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.whenReady().then(createWindow);
electron.ipcMain.handle("launch-browser", async () => {
  if (!scraper) return false;
  await scraper.launch();
  return true;
});
electron.ipcMain.handle("fetch-chats", async () => {
  if (!scraper) throw new Error("Scraper not initialized");
  return await scraper.scanSidebar();
});
electron.ipcMain.handle("export-chat", async (event, { url, characterName, reverseTranscript }) => {
  if (!scraper) throw new Error("Scraper not initialized");
  const rawMessages = await scraper.scrapeChat(url, { reverseTranscript });
  const exportBase = path.join(electron.app.getPath("documents"), "CAI_Exports", characterName.replace(/[^a-z0-9]/gi, "_"));
  const chatId = url.split("/").pop() || "unknown_id";
  const chatDir = path.join(exportBase, chatId);
  if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
  const meta = {
    characterName,
    chatId,
    url,
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    messageCount: rawMessages.length
  };
  const jsonlPath = path.join(chatDir, "transcript.jsonl");
  const jsonlContent = rawMessages.map((m) => JSON.stringify(m)).join("\n");
  fs.writeFileSync(jsonlPath, jsonlContent);
  const mdPath = path.join(chatDir, "transcript.md");
  const mdContent = `# Chat with ${characterName}

` + rawMessages.map((m) => `**${m.role === "user" ? "You" : characterName}:**
${m.text}
`).join("\n---\n\n");
  fs.writeFileSync(mdPath, mdContent);
  fs.writeFileSync(path.join(chatDir, "transcript.json"), JSON.stringify(rawMessages, null, 2));
  fs.writeFileSync(path.join(chatDir, "meta.json"), JSON.stringify(meta, null, 2));
  if (rawMessages.length === 0) {
    const warning = "Export produced 0 messages; skipping analysis. Run 'Test selectors' to debug extraction.";
    win == null ? void 0 : win.webContents.send("analysis-log", warning);
    return { path: chatDir, count: rawMessages.length, analysisSkipped: true, warning };
  }
  return { path: chatDir, count: rawMessages.length, analysisSkipped: false };
});
electron.ipcMain.handle("test-selectors", async () => {
  if (!scraper) throw new Error("Scraper not initialized");
  return await scraper.testSelectors();
});
electron.ipcMain.handle("run-analysis", async (event, { folderPath }) => {
  const jsonlPath = path.join(folderPath, "transcript.jsonl");
  if (!fs.existsSync(jsonlPath)) throw new Error("transcript.jsonl not found in folder");
  const { scriptPath, tried } = resolveAnalyzerPath();
  win == null ? void 0 : win.webContents.send("analysis-log", `Using analyzer: ${scriptPath}`);
  return await runPythonAnalysis(scriptPath, jsonlPath, (log) => {
    win == null ? void 0 : win.webContents.send("analysis-log", log);
  });
});
electron.ipcMain.handle("open-folder", (event, p) => {
  electron.shell.openPath(p);
});
