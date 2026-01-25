"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const playwright = require("playwright");
const child_process = require("child_process");
const nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
const buildResult = (partial) => ({
  ...partial,
  timestamp: nowIso()
});
class BrowserConnectedCheck {
  constructor() {
    __publicField(this, "id", "browser");
    __publicField(this, "name", "Browser Connection");
  }
  async run(ctx) {
    if (!ctx.page) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: "fail",
        message: "Browser not connected"
      });
    }
    return buildResult({
      id: this.id,
      name: this.name,
      status: "pass",
      message: "Browser connected"
    });
  }
}
class UrlCheck {
  constructor() {
    __publicField(this, "id", "url");
    __publicField(this, "name", "Active URL");
  }
  async run(ctx) {
    if (!ctx.page) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: "fail",
        message: "No page available"
      });
    }
    const url = ctx.page.url();
    const isChat = url.includes("/chat/");
    return buildResult({
      id: this.id,
      name: this.name,
      status: isChat ? "pass" : "warn",
      message: isChat ? "Chat page detected" : `Unexpected URL: ${url}`,
      details: { url }
    });
  }
}
class ElementCheck {
  constructor(id, name, selector) {
    __publicField(this, "id");
    __publicField(this, "name");
    __publicField(this, "selector");
    this.id = id;
    this.name = name;
    this.selector = selector;
  }
  async run(ctx) {
    if (!ctx.page) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: "fail",
        message: "No page available"
      });
    }
    const found = await ctx.page.$(this.selector);
    return buildResult({
      id: this.id,
      name: this.name,
      status: found ? "pass" : "warn",
      message: found ? `Found ${this.name}` : `Missing ${this.name}`,
      details: { selector: this.selector }
    });
  }
}
class MessageCountCheck {
  constructor() {
    __publicField(this, "id", "message-count");
    __publicField(this, "name", "Message Count (DOM)");
  }
  async run(ctx) {
    if (!ctx.page) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: "fail",
        message: "No page available"
      });
    }
    const result = await ctx.page.evaluate(() => {
      const root = document.querySelector("main") || document.body;
      const selectors = [
        '[data-testid="message-row"]',
        ".msg-row",
        '[role="row"]',
        ".message",
        "[data-message-id]",
        ".chat-message",
        ".conversation-message",
        ".turn",
        ".chat-turn",
        '[class*="Turn__"]',
        '[class*="Message__"]'
      ];
      let best = { selector: "", count: 0 };
      for (const selector of selectors) {
        const count = root.querySelectorAll(selector).length;
        if (count > best.count) {
          best = { selector, count };
        }
      }
      return best;
    });
    if (result.count > 0) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: "pass",
        message: `Detected ${result.count} messages`,
        details: { selector: result.selector, count: result.count }
      });
    }
    return buildResult({
      id: this.id,
      name: this.name,
      status: "warn",
      message: "No message nodes detected",
      details: { selector: result.selector }
    });
  }
}
class ScrollContainerCheck {
  constructor() {
    __publicField(this, "id", "scroll");
    __publicField(this, "name", "Scroll Container");
  }
  async run(ctx) {
    if (!ctx.page) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: "fail",
        message: "No page available"
      });
    }
    const result = await ctx.page.evaluate(() => {
      const canScroll = (el) => {
        const maxScroll2 = el.scrollHeight - el.clientHeight;
        if (maxScroll2 <= 0) return false;
        const prev = el.scrollTop;
        const next = Math.min(prev + 100, maxScroll2);
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
            if (curr.scrollHeight > curr.clientHeight + 50 && canScroll(curr)) {
              return curr;
            }
            curr = curr.parentElement;
          }
        }
        const allElements = document.querySelectorAll("*");
        const candidates = Array.from(allElements).filter((el) => {
          if (el.clientHeight < 50) return false;
          return el.scrollHeight > el.clientHeight + 100 && canScroll(el);
        });
        candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
        if (candidates.length > 0) return candidates[0];
        return document.scrollingElement || document.body;
      };
      const best = findScrollable();
      if (!best) return { found: false };
      const maxScroll = best.scrollHeight - best.clientHeight;
      const startTop = best.scrollTop;
      const target = Math.min(startTop + 200, maxScroll);
      best.scrollTop = target;
      const afterTop = best.scrollTop;
      best.scrollTop = startTop;
      return {
        found: true,
        tag: best.tagName.toLowerCase(),
        className: best.className,
        scrollHeight: best.scrollHeight,
        clientHeight: best.clientHeight,
        startTop,
        afterTop,
        canScroll: afterTop !== startTop
      };
    });
    if (!result.found) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: "fail",
        message: "No scrollable container detected"
      });
    }
    if (!result.canScroll) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: "warn",
        message: "Scrollable container found but scrollTop did not change",
        details: result
      });
    }
    return buildResult({
      id: this.id,
      name: this.name,
      status: "pass",
      message: "Scrollable container identified",
      details: result
    });
  }
}
class NetworkInterceptionCheck {
  constructor() {
    __publicField(this, "id", "network");
    __publicField(this, "name", "Network Interception");
  }
  async run(ctx) {
    if (ctx.interceptedMessagesCount > 0) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: "pass",
        message: `Captured ${ctx.interceptedMessagesCount} API messages`,
        details: { interceptedMessagesCount: ctx.interceptedMessagesCount }
      });
    }
    return buildResult({
      id: this.id,
      name: this.name,
      status: "info",
      message: "No API messages intercepted yet",
      details: { interceptedMessagesCount: ctx.interceptedMessagesCount }
    });
  }
}
class QAEngine {
  constructor(checks) {
    __publicField(this, "checks");
    this.checks = checks ?? [
      new BrowserConnectedCheck(),
      new UrlCheck(),
      new ElementCheck("sidebar", "Sidebar", 'nav, [class*="Sidebar"]'),
      new ElementCheck("chat-input", "Chat Input", 'textarea, [contenteditable="true"]'),
      new ElementCheck("chat-root", "Chat Root", 'main, [role="main"]'),
      new MessageCountCheck(),
      new ScrollContainerCheck(),
      new NetworkInterceptionCheck()
    ];
  }
  async run(ctx) {
    var _a;
    const startedAt = nowIso();
    const checks = [];
    for (const check of this.checks) {
      try {
        const result = await check.run(ctx);
        checks.push(result);
        ctx.log(`[QA] [${result.status.toUpperCase()}] ${result.name}: ${result.message}`);
      } catch (e) {
        const result = buildResult({
          id: check.id,
          name: check.name,
          status: "fail",
          message: (e == null ? void 0 : e.message) || "Unhandled error"
        });
        checks.push(result);
        ctx.log(`[QA] [FAIL] ${check.name}: ${result.message}`);
      }
    }
    const summary = checks.reduce(
      (acc, curr) => {
        acc[curr.status] += 1;
        return acc;
      },
      { pass: 0, warn: 0, fail: 0, info: 0 }
    );
    const finishedAt = nowIso();
    return {
      startedAt,
      finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      url: (_a = ctx.page) == null ? void 0 : _a.url(),
      checks,
      summary
    };
  }
  async runSingle(id, ctx) {
    const check = this.checks.find((c) => c.id === id);
    if (!check) return null;
    return await check.run(ctx);
  }
}
class ScraperEngine {
  constructor(userDataDir, logCallback, cacheDir) {
    __publicField(this, "browserContext", null);
    __publicField(this, "page", null);
    __publicField(this, "userDataDir");
    __publicField(this, "cacheDir");
    __publicField(this, "logCallback");
    __publicField(this, "verboseSanitizeLogs");
    __publicField(this, "interceptedMessages", []);
    __publicField(this, "manualScrollHandler", null);
    __publicField(this, "qaEngine");
    this.userDataDir = userDataDir;
    this.cacheDir = cacheDir || path.join(userDataDir, "cache");
    this.logCallback = logCallback;
    this.verboseSanitizeLogs = /^(1|true|yes|on)$/i.test(process.env.CAI_DUMPER_VERBOSE_SANITIZE || "");
    this.qaEngine = new QAEngine();
  }
  buildQAContext() {
    return {
      page: this.page,
      interceptedMessagesCount: this.interceptedMessages.length,
      log: (msg) => this.log(msg)
    };
  }
  setManualScrollHandler(handler) {
    this.manualScrollHandler = handler;
  }
  isLaunched() {
    return this.page !== null;
  }
  log(msg) {
    console.log(`[Scraper] ${msg}`);
    this.logCallback(msg);
  }
  sanitizeText(raw, ctx) {
    if (raw === null || raw === void 0) return null;
    if (typeof raw !== "string") return null;
    let s = raw.replace(/\r\n/g, "\n").replace(/[\t\f\v]/g, " ").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (!s) return null;
    const maxLen = ctx.maxLen ?? 300;
    return s.length > maxLen ? s.slice(0, maxLen).trim() : s;
  }
  isValidHandle(handle) {
    if (!handle) return false;
    return /^@[A-Za-z0-9_.-]{2,64}$/.test(handle.trim());
  }
  normalizeHandle(handle) {
    if (!handle) return null;
    const h = handle.trim();
    return h ? h.startsWith("@") ? h : `@${h}` : null;
  }
  parseCompactNumber(raw) {
    if (!raw) return null;
    const cleaned = raw.replace(/[\s,]/g, "").toLowerCase();
    const m = cleaned.match(/(-?[0-9]*\.?[0-9]+)(k|m)?/);
    if (!m) return null;
    const base = Number(m[1]);
    if (!isFinite(base)) return null;
    if (m[2] === "k") return Math.round(base * 1e3);
    if (m[2] === "m") return Math.round(base * 1e6);
    return Math.round(base);
  }
  async launch(cdpEndpoint) {
    this.log("Initializing browser connection...");
    if (cdpEndpoint) {
      this.log(`Connecting to browser at ${cdpEndpoint}...`);
      try {
        const browser = await playwright.chromium.connectOverCDP(cdpEndpoint);
        this.browserContext = browser.contexts()[0] || await browser.newContext();
        const pages = this.browserContext.pages();
        this.page = pages[0] || await this.browserContext.newPage();
        this.setupNetworkInterception(this.page);
        this.log("Connected to existing browser session for interception.");
        return;
      } catch (err) {
        this.log(`Failed to connect to existing browser: ${err.message}`);
      }
    }
    this.log("Launching dedicated Chromium instance for scraping...");
    try {
      if (!fs.existsSync(this.userDataDir)) fs.mkdirSync(this.userDataDir, { recursive: true });
      if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });
      this.browserContext = await playwright.chromium.launchPersistentContext(this.userDataDir, {
        headless: true,
        // Run headless for scraping
        viewport: null,
        args: [
          "--disable-blink-features=AutomationControlled",
          `--disk-cache-dir=${this.cacheDir}`,
          "--disable-gpu-cache",
          "--no-sandbox",
          "--disable-dev-shm-usage"
        ]
      });
      this.page = await this.browserContext.newPage();
      await this.page.goto("https://character.ai");
      this.setupNetworkInterception(this.page);
      this.log("Dedicated scraping browser ready.");
      return;
    } catch (err) {
      this.log(`Failed to launch dedicated browser: ${err.message}`);
      throw err;
    }
  }
  async setupNetworkInterception(page) {
    this.log("Setting up network interception for c.ai API calls...");
    page.on("response", async (response) => {
      var _a, _b, _c, _d, _e, _f, _g, _h;
      const url = response.url();
      if (url.includes("character.ai") || url.includes("c.ai")) {
        if (url.includes("/_next/static/") || url.includes(".woff") || url.includes(".css") || url.includes("/chunks/") || url.includes("/media/") || url.includes("/ping") || url.includes("/rum?") || url.includes("/events.")) {
          return;
        }
        this.log(`[Network] ${response.status()} ${response.request().method()} ${url.replace("https://", "").replace("http://", "")}`);
      }
      if (url.includes("/chat/character/") || url.includes("/c.ai/character/") || url.includes("/api/trpc/character.info") || url.includes("/character/info") || url.includes("/get_character_info")) {
        try {
          const json = await response.json();
          this.log(`[Metadata] Character API response intercepted`);
          console.log(`[Metadata] Character data:`, json);
          const char = json.character || ((_c = (_b = (_a = json == null ? void 0 : json.result) == null ? void 0 : _a.data) == null ? void 0 : _b.json) == null ? void 0 : _c.character) || ((_d = json == null ? void 0 : json.data) == null ? void 0 : _d.character) || json;
          if (char && (char.name || char.title || char.external_id)) {
            this.log(`[Metadata] [OK] Character: ${char.name || char.title || "Unknown"} | Model: ${char.model_type || "Default"} | Voice: ${char.voice_id || "None"}`);
          }
        } catch (e) {
          const msg = e.message || String(e);
          if (msg.includes("No resource with given identifier") || msg.includes("Network.getResponseBody")) {
            this.log(`[Metadata] [Warn] Could not retrieve response body (timing issue): ${msg.split("\n")[0]}`);
          } else {
            this.log(`[Metadata] [FAIL] Failed to parse character response: ${msg}`);
          }
        }
      }
      if (url.includes("/chat/history/msgs/") || url.includes("/turns/") || url.includes("/api/trpc/chat.history") || url.includes("/chat/messages") || url.includes("/chats/recent/")) {
        try {
          const json = await response.json();
          this.log(`[Metadata] Chat history API intercepted`);
          const msgs = (json == null ? void 0 : json.messages) || (json == null ? void 0 : json.turns) || ((_g = (_f = (_e = json == null ? void 0 : json.result) == null ? void 0 : _e.data) == null ? void 0 : _f.json) == null ? void 0 : _g.messages) || ((_h = json == null ? void 0 : json.data) == null ? void 0 : _h.messages);
          if (msgs && Array.isArray(msgs)) {
            this.log(`[Metadata] [OK] Chat messages: ${msgs.length} found`);
            this.interceptedMessages.push(...msgs);
          }
        } catch (e) {
          this.log(`[Metadata] [FAIL] Failed to parse chat history`);
        }
      }
    });
  }
  async close() {
    try {
      if (this.page) await this.page.close().catch(() => {
      });
      if (this.browserContext) await this.browserContext.close().catch(() => {
      });
    } catch (e) {
      this.log(`Error closing browser: ${e.message}`);
    } finally {
      this.page = null;
      this.browserContext = null;
    }
  }
  async scanSidebar() {
    var _a;
    if (!this.page) throw new Error("Browser not launched");
    this.log("Scanning sidebar for chats...");
    try {
      await this.page.waitForSelector('a[href*="/chat/"]', { timeout: 5e3 });
    } catch (e) {
      this.log("No chat links found immediately. Please ensure sidebar is open.");
      return [];
    }
    const seen = /* @__PURE__ */ new Map();
    for (let i = 0; i < 3; i++) {
      const elements = await this.page.$$('a[href*="/chat/"]');
      const batch = await this.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/chat/"]'));
        return links.map((link) => {
          var _a2, _b;
          const el = link;
          const href = el.getAttribute("href") || "";
          const fullUrl = href.startsWith("http") ? href : `https://character.ai${href}`;
          const chatId = fullUrl.split("/").filter(Boolean).pop() || "unknown";
          const text = el.innerText || "";
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          const displayName = lines[0] || "Unknown Character";
          let creatorHandle = null;
          const handleMatch = text.match(/@([\w\._-]+)/);
          if (handleMatch) creatorHandle = handleMatch[1];
          const avatarEl = el.querySelector("img");
          const avatarUrl = avatarEl ? avatarEl.getAttribute("src") || avatarEl.getAttribute("data-src") : null;
          let interactions = "0";
          let likes = "0";
          const svgs = Array.from(el.querySelectorAll("svg"));
          for (const svg of svgs) {
            const path2 = svg.querySelector("path");
            if (!path2) continue;
            const d = path2.getAttribute("d") || "";
            if (d.startsWith("M21.5 12")) {
              const container = svg.parentElement;
              if (container) {
                const textEl = container.querySelector("p") || container;
                const rawText = ((_a2 = textEl.textContent) == null ? void 0 : _a2.trim()) || "";
                interactions = rawText.replace(/,/g, "").replace(/ interactions/i, "").trim();
              }
            }
            if (d.startsWith("M7 11")) {
              const container = svg.parentElement;
              if (container) {
                const textEl = container.querySelector("p") || container;
                const rawText = ((_b = textEl.textContent) == null ? void 0 : _b.trim()) || "";
                likes = rawText.replace(/,/g, "").replace(/ likes?/i, "").trim();
              }
            }
          }
          if (interactions === "0" && likes === "0") {
            const allText = el.innerText;
            const matches = allText.match(/(\d+(?:,\d{3})*(?:\.\d+)?[km]?)/gi);
            if (matches) {
              if (matches.length > 0) interactions = matches[0].replace(/,/g, "");
              if (matches.length > 1) likes = matches[1].replace(/,/g, "");
            }
          }
          return {
            characterId: chatId,
            chatId,
            displayName,
            handle: creatorHandle || "Unknown",
            avatarUrl,
            interactions,
            likes,
            url: fullUrl,
            lastChatDate: "Recently"
          };
        });
      });
      for (const snap of batch) {
        if (!seen.has(snap.chatId)) {
          const cleanDisplayName = this.sanitizeText(snap.displayName, { field: "sidebar.displayName", maxLen: 120 }) || snap.displayName;
          const summary = {
            characterId: snap.characterId,
            chatId: snap.chatId,
            displayName: cleanDisplayName,
            avatarUrl: snap.avatarUrl,
            interactions: snap.interactions,
            likes: snap.likes,
            handle: snap.handle,
            url: snap.url,
            lastChatDate: snap.lastChatDate,
            creator: snap.handle ? { handle: snap.handle } : void 0
          };
          if (((_a = summary.creator) == null ? void 0 : _a.handle) && !this.isValidHandle(summary.creator.handle)) {
            summary.creator = null;
          }
          seen.set(snap.chatId, summary);
        }
      }
      if (elements.length > 0) {
        await elements[elements.length - 1].scrollIntoViewIfNeeded().catch(() => {
        });
        await this.page.waitForTimeout(800);
      }
    }
    return Array.from(seen.values());
  }
  async scrapeChat(url, options) {
    if (!this.page) throw new Error("Browser not launched");
    const startTime = Date.now();
    this.interceptedMessages = [];
    await this.page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "media"].includes(type)) {
        route.abort().catch(() => {
        });
      } else {
        route.continue().catch(() => {
        });
      }
    });
    this.log(`Navigating to ${url}...`);
    try {
      await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 3e4 });
      await this.page.waitForTimeout(3e3);
      this.log("Waiting briefly for message nodes to appear in the DOM...");
      try {
        await this.page.waitForFunction(() => {
          return !!document.querySelector('[data-testid="message-row"], .msg-row, [role="row"], .message, [data-message-id]');
        }, { timeout: 2500 });
        this.log("[OK] Message nodes detected in DOM");
      } catch (e) {
        this.log("No message nodes detected immediately; proceeding with scroll-to-top loading");
      }
      this.log("Starting scroll-to-top loading sequence...");
      let lastMessageCount = 0;
      let lastInterceptedCount = 0;
      let noProgressCount = 0;
      const maxCycles = 500;
      let cycle = 0;
      const initialCount = await this.page.evaluate(() => {
        const root = document.querySelector("main") || document.body;
        const selectors = [
          '[data-testid="message-row"]',
          ".msg-row",
          '[role="row"]',
          ".message",
          "[data-message-id]",
          ".chat-message",
          ".conversation-message",
          ".turn",
          ".chat-turn",
          // Neo UI candidates
          '[class*="Turn__"]',
          '[class*="Message__"]'
        ];
        for (const selector of selectors) {
          const messages = Array.from(root.querySelectorAll(selector));
          if (messages.length > 0) {
            return messages.length;
          }
        }
        return 0;
      });
      lastMessageCount = initialCount;
      this.log(`[Scroll] Initial state: ${lastMessageCount} messages visible`);
      try {
        this.log(`[Scroll] Clearing UI obstructions (Modals/Overlays)...`);
        await this.page.keyboard.press("Escape");
        await this.page.waitForTimeout(300);
        await this.page.keyboard.press("Escape");
        await this.page.waitForTimeout(500);
        const inputArea = await this.page.$('textarea, [contenteditable="true"]');
        if (inputArea) {
          await inputArea.click({ force: true });
        } else {
          await this.page.mouse.click(100, window.innerHeight / 2);
        }
      } catch (e) {
        this.log(`[Scroll] UI Clear warning: ${e}`);
      }
      this.log(`[Scroll] Using mouse wheel scrolling to load older messages...`);
      try {
        const viewport = this.page.viewportSize();
        if (viewport) {
          await this.page.mouse.move(viewport.width / 2, viewport.height * 0.75);
        }
      } catch (e) {
      }
      for (let i = 0; i < maxCycles; i++) {
        await this.page.mouse.wheel(0, -3e3);
        await this.page.waitForTimeout(500);
        await this.page.evaluate(() => {
          const findScrollable = () => {
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
            const centerEl = document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.75);
            if (centerEl) {
              let curr = centerEl;
              while (curr && curr !== document.body) {
                if (curr.scrollHeight > curr.clientHeight + 50 && canScroll(curr)) {
                  console.log(`[ContentScript] Found via center-point: ${curr.tagName} (h=${curr.scrollHeight})`);
                  return curr;
                }
                curr = curr.parentElement;
              }
            }
            const allElements = document.querySelectorAll("*");
            const candidates = Array.from(allElements).filter((el) => {
              if (el.clientHeight < 50) return false;
              return el.scrollHeight > el.clientHeight + 100 && canScroll(el);
            });
            candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
            if (candidates.length > 0) return candidates[0];
            return document.scrollingElement || document.body;
          };
          const scrollable = findScrollable();
          console.log(`[ContentScript] Found container: h=${scrollable.scrollHeight}, top=${scrollable.scrollTop}`);
          scrollable.dispatchEvent(new WheelEvent("wheel", {
            deltaY: -2e3,
            bubbles: true,
            cancelable: true
          }));
        });
        const waitTime = 2e3 + Math.random() * 1e3;
        await this.page.waitForTimeout(waitTime);
        const currentCount = await this.page.evaluate(() => {
          const root = document.querySelector("main") || document.body;
          const selectors = [
            '[data-testid="message-row"]',
            ".msg-row",
            '[role="row"]',
            ".message",
            "[data-message-id]",
            ".chat-message",
            ".conversation-message",
            ".turn",
            ".chat-turn",
            // Neo UI candidates
            '[class*="Turn__"]',
            '[class*="Message__"]'
          ];
          for (const selector of selectors) {
            const messages = Array.from(root.querySelectorAll(selector));
            if (messages.length > 0) {
              return messages.length;
            }
          }
          return 0;
        });
        const currentInterceptedCount = this.interceptedMessages.length;
        if (currentCount > lastMessageCount || currentInterceptedCount > lastInterceptedCount) {
          this.log(`[Scroll] [OK] Scroll ${i + 1}: DOM ${currentCount} (was ${lastMessageCount}), API ${currentInterceptedCount} (was ${lastInterceptedCount})`);
          lastMessageCount = currentCount;
          lastInterceptedCount = currentInterceptedCount;
          noProgressCount = 0;
        } else {
          noProgressCount++;
          this.log(`[Scroll] Scroll ${i + 1}: No progress (${noProgressCount}/5)`);
        }
        if (noProgressCount >= 2) {
          this.log(`[Scroll] Standard scrolling stalled. Attempting aggressive DOM manipulation...`);
          try {
            const result2 = await this.page.evaluate(async () => {
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
              const centerEl = document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.75);
              let best = null;
              if (centerEl) {
                let curr = centerEl;
                while (curr && curr !== document.body) {
                  if (curr.scrollHeight > curr.clientHeight + 50 && canScroll(curr)) {
                    best = curr;
                    break;
                  }
                  curr = curr.parentElement;
                }
              }
              if (!best) {
                const allElements = document.querySelectorAll("*");
                const candidates = Array.from(allElements).filter((el) => {
                  if (el.clientHeight < 50) return false;
                  return el.scrollHeight > el.clientHeight + 100 && canScroll(el);
                });
                candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
                if (candidates.length > 0) best = candidates[0];
              }
              if (!best) best = document.scrollingElement;
              if (best) {
                const info = `${best.tagName.toLowerCase()}.${best.className.split(" ").join(".").substring(0, 50)}... (h=${best.scrollHeight}, t=${best.scrollTop})`;
                const startTop = best.scrollTop;
                if (startTop > 2e3) {
                  best.scrollTop = 2e3;
                  await new Promise((r) => setTimeout(r, 100));
                }
                best.scrollTop = 50;
                await new Promise((r) => setTimeout(r, 150));
                best.scrollTo({ top: 0, behavior: "smooth" });
                best.dispatchEvent(new Event("scroll", { bubbles: true }));
                return { success: true, info, startTop };
              }
              return { success: false, info: "No container found" };
            });
            if (result2 && result2.success) {
              this.log(`[Scroll] Manipulated ${result2.info}. Moved from ${result2.startTop} to 0.`);
              await this.page.waitForTimeout(3500);
            } else {
              this.log(`[Scroll] Could not find scrollable container to manipulate.`);
            }
          } catch (err) {
            this.log(`[Scroll] Direct manipulation failed: ${err}`);
          }
        }
        if (noProgressCount >= 5) {
          if (this.manualScrollHandler) {
            this.log(`[Scroll] Automatic scrolling stalled. Requesting manual intervention...`);
            const shouldContinue = await this.manualScrollHandler();
            if (shouldContinue) {
              this.log(`[Scroll] Resuming after manual intervention...`);
              noProgressCount = 0;
            } else {
              this.log(`[Scroll] User requested to stop scrolling.`);
              break;
            }
          } else {
            this.log(`[Scroll] Stopping - no progress after ${i + 1} scroll attempts`);
            break;
          }
        }
      }
      if (lastMessageCount === initialCount) {
        this.log(`[Scroll] Mouse wheel didn't work, trying scrollIntoView on first message...`);
        try {
          await this.page.evaluate(() => {
            const firstMsg = document.querySelector('[data-testid="message-row"], .msg-row, [role="row"]');
            if (firstMsg) {
              firstMsg.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          });
          await this.page.waitForTimeout(2e3);
          const finalCount = await this.page.evaluate(() => {
            const root = document.querySelector("main") || document.body;
            const selectors = [
              '[data-testid="message-row"]',
              ".msg-row",
              '[role="row"]',
              ".message",
              "[data-message-id]",
              ".chat-message",
              ".conversation-message",
              ".turn",
              ".chat-turn"
            ];
            for (const selector of selectors) {
              const messages = Array.from(root.querySelectorAll(selector));
              if (messages.length > 0) {
                return messages.length;
              }
            }
            return 0;
          });
          if (finalCount > lastMessageCount) {
            this.log(`[Scroll] scrollIntoView worked: ${finalCount} messages`);
            lastMessageCount = finalCount;
          } else {
            this.log(`[Scroll] scrollIntoView didn't help`);
          }
        } catch (e) {
          this.log(`[Scroll] scrollIntoView failed: ${e}`);
        }
      }
      this.log(`[Scroll] Completed keyboard approach: ${lastMessageCount} total messages, ${this.interceptedMessages.length} API messages`);
      if (this.interceptedMessages.length < 20) {
        this.log(`[Scroll] Only ${this.interceptedMessages.length} API messages captured. Offering manual scrolling option...`);
        this.log(`[Manual] To load more messages manually:`);
        this.log(`[Manual] 1. Use PageUp, Home, or scroll wheel to scroll to the top of the chat`);
        this.log(`[Manual] 2. Wait for older messages to load`);
        this.log(`[Manual] 3. The scraper will detect the new API calls automatically`);
        this.log(`[Manual] Waiting 30 seconds for manual scrolling...`);
        await this.page.waitForTimeout(3e4);
      }
    } catch (e) {
      this.log(`Navigation failed, retrying: ${e.message}`);
      await this.page.reload({ waitUntil: "domcontentloaded" });
      await this.page.waitForTimeout(3e3);
    }
    this.log("Extracting message content...");
    let result = [];
    let selectorUsed = "api-interception";
    if (this.interceptedMessages.length > 0) {
      this.log(`[Extraction] Using ${this.interceptedMessages.length} intercepted API messages as primary source.`);
      const seenIds = /* @__PURE__ */ new Set();
      const validMsgs = [];
      for (const msg of this.interceptedMessages) {
        const id = msg.uuid || msg.id || msg.message_id || msg.primary_candidate_id || msg.turn_key && msg.turn_key.turn_id;
        if (id) {
          if (!seenIds.has(id)) {
            seenIds.add(id);
            validMsgs.push(msg);
          }
        } else {
          validMsgs.push(msg);
        }
      }
      const mapped = validMsgs.map((msg, index) => {
        var _a;
        if (index === 0) {
          this.log(`[API Debug] Full structure of first message: ${JSON.stringify(msg, null, 2)}`);
        }
        let text = msg.text || msg.content || msg.raw_content || "";
        if (!text && msg.candidates && Array.isArray(msg.candidates) && msg.candidates.length > 0) {
          let candidate = msg.candidates[0];
          if (msg.primary_candidate_id) {
            const primary = msg.candidates.find((c) => c.candidate_id === msg.primary_candidate_id);
            if (primary) candidate = primary;
          }
          text = candidate.raw_content || candidate.text || candidate.content || "";
        }
        if (!text) {
          if (index < 5) this.log(`[API Debug] No text found in message ${index}`);
          return null;
        }
        let role = "char";
        const author = msg.author || msg.src || msg.candidates && ((_a = msg.candidates[0]) == null ? void 0 : _a.author);
        if (author) {
          if (author.is_human === true || author.is_human === "true") role = "user";
          else if (author.role === "USER" || author.role === "user") role = "user";
        }
        this.log(`[API Debug] Extracted: role=${role}, text length=${text.length}`);
        return { turn_index: 0, role, text };
      }).filter((m) => m !== null);
      const unique = [];
      let prevKey = null;
      for (const m of mapped) {
        const key = `${m.role}:${m.text}`;
        if (key !== prevKey) {
          unique.push(m);
          prevKey = key;
        }
      }
      result = unique;
    } else {
      this.log(`[Extraction] No API messages intercepted. Falling back to DOM extraction.`);
      const extractionResult = await this.page.evaluate((charName) => {
        const root = document.querySelector("main") || document.body;
        const rowSelector = '[data-testid="message-row"], .msg-row, [role="row"], .turn, [class*="Turn__"], [class*="Message__"]';
        let rows = Array.from(root.querySelectorAll(rowSelector));
        rows = rows.filter((el) => {
          return !rows.some((parent) => parent !== el && parent.contains(el));
        });
        if (rows.length === 0) {
          const divs = Array.from(root.querySelectorAll("div"));
          rows = divs.filter((d) => {
            const el = d;
            const t = (el.innerText || "").trim();
            if (!t) return false;
            if (t.length < 1 || t.length > 1e4) return false;
            const r = el.getBoundingClientRect();
            if (r.height < 16 || r.width < 120) return false;
            return true;
          });
          console.log(`[Extract Debug] Fallback found ${rows.length} potential message containers`);
        }
        const messages = rows.map((el, idx) => {
          const rawText = el.innerText || "";
          const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
          let role = "user";
          const ds = el.dataset;
          if (ds.isUser === "true" || ds.author === "user") role = "user";
          else if (ds.isUser === "false" || ds.author === "character") role = "char";
          else {
            const hasCaiLogo = !!el.querySelector('img[src*="c.ai"], svg[aria-label="Character.AI"]');
            const hasCaiText = lines.some((l) => l.toLowerCase().includes("c.ai"));
            const startsWithYou = (lines[0] || "").toLowerCase().startsWith("you");
            const hasUserIndicators = lines.some((l) => l.toLowerCase().includes("you") || l.toLowerCase().includes("user"));
            if (hasCaiLogo || hasCaiText) role = "char";
            else if (startsWithYou || hasUserIndicators) role = "user";
            else role = "user";
          }
          const cleanLines = lines.filter((line, i) => {
            if (/^c\.ai$/i.test(line)) return false;
            if (/^(just now|\d+\s+(m|h|d|w|mo|y)|(minute|hour|day|week|month|year)s?\s+ago)$/i.test(line)) return false;
            if (charName && line.toLowerCase() === charName.toLowerCase()) return false;
            if (i === 0 && (line === "You" || line === "User")) return false;
            return true;
          });
          const text = cleanLines.join("\n").trim();
          if (text.length < 1) return null;
          const top = el.getBoundingClientRect().top;
          return { turn_index: idx, role, text, top };
        }).filter((m) => m && m.text && m.text.length >= 1);
        return { messages, selectorUsed: rowSelector, count: messages.length };
      }, options == null ? void 0 : options.characterName);
      this.log(`[Extract Debug] Extraction completed: ${extractionResult.count} messages found`);
      selectorUsed = extractionResult.selectorUsed;
      const deduped = [];
      let prevKey = null;
      for (const msg of extractionResult.messages) {
        if (!msg) continue;
        const key = `${msg.role}:${msg.text}`;
        if (key === prevKey) continue;
        prevKey = key;
        deduped.push({ turn_index: 0, role: msg.role, text: msg.text });
      }
      result = deduped;
    }
    result = result.map((m, i) => ({ ...m, turn_index: i }));
    if (options == null ? void 0 : options.reverseTranscript) {
      result = result.reverse().map((m, i) => ({ ...m, turn_index: i }));
    }
    this.log(`Extracted ${result.length} clean messages.`);
    await this.page.unroute("**/*").catch(() => {
    });
    return {
      messages: result,
      diagnostics: {
        chosenMessageSelector: selectorUsed,
        messageCount: result.length,
        durationMs: Date.now() - startTime
      }
    };
  }
  async scrapeViewerProfile() {
    if (!this.page) throw new Error("Browser not launched");
    this.log("Navigating to profile page...");
    await this.page.goto("https://character.ai/profile", { waitUntil: "domcontentloaded", timeout: 15e3 }).catch(() => {
    });
    try {
      await Promise.any([
        this.page.waitForSelector(".text-display", { timeout: 8e3 }),
        this.page.waitForSelector('div[class*="text-display"]', { timeout: 8e3 }),
        this.page.waitForSelector("button", { timeout: 8e3 })
        // At least some buttons should appear
      ]);
      await this.page.waitForTimeout(1e3);
    } catch (e) {
      this.log("Warning: Timeout waiting for profile selectors. Attempting scrape anyway...");
    }
    const profile = await this.page.evaluate(() => {
      var _a, _b;
      const getText = (selector) => {
        var _a2;
        const el = document.querySelector(selector);
        return ((_a2 = el == null ? void 0 : el.innerText) == null ? void 0 : _a2.trim()) || null;
      };
      let displayName = getText(".text-display") || getText('div[class*="text-display"]');
      if (!displayName) {
        const candidates = Array.from(document.querySelectorAll("div, h1, h2, span")).filter((el) => {
          const style = window.getComputedStyle(el);
          return parseFloat(style.fontSize) > 20;
        });
        if (candidates.length > 0) displayName = ((_a = candidates[0].innerText) == null ? void 0 : _a.trim()) || null;
      }
      const allMuted = Array.from(document.querySelectorAll('.text-muted-foreground, [class*="text-muted"]'));
      const handleEl = allMuted.find((el) => {
        var _a2;
        return (_a2 = el.innerText) == null ? void 0 : _a2.trim().startsWith("@");
      });
      const handle = ((_b = handleEl == null ? void 0 : handleEl.innerText) == null ? void 0 : _b.trim()) || null;
      const imgs = Array.from(document.querySelectorAll('main img, img[alt*="Avatar"]'));
      const avatarEl = imgs.find((img) => {
        const rect = img.getBoundingClientRect();
        return rect.width >= 80 && rect.height >= 80;
      });
      const avatarUrl = (avatarEl == null ? void 0 : avatarEl.getAttribute("src")) || null;
      const isPlus = !!document.querySelector(".cai-plus-gradient");
      const buttons = Array.from(document.querySelectorAll("button"));
      const followersBtn = buttons.find((b) => {
        var _a2;
        return (_a2 = b.innerText) == null ? void 0 : _a2.toLowerCase().includes("followers");
      });
      const followingBtn = buttons.find((b) => {
        var _a2;
        return (_a2 = b.innerText) == null ? void 0 : _a2.toLowerCase().includes("following");
      });
      const allElements = Array.from(document.querySelectorAll("p, span, div"));
      const interactionsEl = allElements.find((el) => {
        var _a2;
        const t = ((_a2 = el.innerText) == null ? void 0 : _a2.trim()) || "";
        if (!t.toLowerCase().includes("interactions")) return false;
        if (t.length > 30) return false;
        if (t.includes("\n")) return false;
        return true;
      });
      const parseStat = (text, keyword) => {
        if (!text) return "0";
        const regex = new RegExp(keyword, "gi");
        return text.replace(regex, "").replace(/[|•]/g, "").trim();
      };
      return {
        displayName: displayName || "User",
        handle,
        avatarUrl,
        isPlus,
        followers: parseStat(followersBtn == null ? void 0 : followersBtn.innerText, "Followers"),
        following: parseStat(followingBtn == null ? void 0 : followingBtn.innerText, "Following"),
        interactions: parseStat(interactionsEl == null ? void 0 : interactionsEl.innerText, "Interactions")
      };
    });
    this.log(`Scraped Profile: ${JSON.stringify(profile)}`);
    if (!profile.handle) {
      const bodyText = await this.page.evaluate(() => document.body.innerText);
      const match = bodyText.match(/@[A-Za-z0-9_]+/);
      if (match) profile.handle = match[0];
    }
    if (!profile.handle || !this.isValidHandle(profile.handle)) return null;
    return {
      handle: profile.handle,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      isPlus: profile.isPlus,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: "dom",
      followers: profile.followers,
      following: profile.following,
      interactions: profile.interactions
    };
  }
  async getCreatorProfile(username) {
    if (!this.browserContext) throw new Error("Browser not launched");
    const page = await this.browserContext.newPage();
    try {
      await page.goto(`https://character.ai/profile/${username}`, { waitUntil: "domcontentloaded", timeout: 15e3 });
      const data = await page.evaluate(() => {
        const h1 = document.querySelector("h1");
        const img = document.querySelector('img[alt*="avatar"]');
        return {
          username: (h1 == null ? void 0 : h1.innerText) || null,
          avatarUrl: (img == null ? void 0 : img.getAttribute("src")) || null
        };
      });
      if (!data.username) return null;
      return {
        username,
        avatarUrl: data.avatarUrl,
        fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
        followers: 0,
        following: 0,
        interactions: 0
      };
    } catch {
      return null;
    } finally {
      await page.close().catch(() => {
      });
    }
  }
  async hydrateChatsMetadata(urls, options) {
    var _a;
    if (!this.page) throw new Error("Browser not launched");
    const results = [];
    const limit = (options == null ? void 0 : options.limit) || 10;
    for (let i = 0; i < Math.min(urls.length, limit); i++) {
      if ((_a = options == null ? void 0 : options.signal) == null ? void 0 : _a.call(options)) break;
      try {
        await this.page.goto(urls[i], { waitUntil: "domcontentloaded", timeout: 1e4 });
        const title = await this.page.title();
        results.push({ displayName: title.replace(" | Character.AI", "") });
      } catch {
      }
    }
    return results;
  }
  async scrapeProfileCharacters(handle, sortMode) {
    return [];
  }
  async scrapeFollowersList(type) {
    if (!this.page) throw new Error("Browser not launched");
    this.log(`Scraping ${type} list...`);
    if (!this.page.url().includes("/profile")) {
      await this.page.goto("https://character.ai/profile", { waitUntil: "domcontentloaded" });
    }
    const success = await this.page.evaluate(async (targetType) => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const btn = buttons.find((b) => {
        var _a;
        return (_a = b.innerText) == null ? void 0 : _a.toLowerCase().includes(targetType);
      });
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }, type);
    if (!success) {
      this.log(`Could not find ${type} button.`);
      return [];
    }
    try {
      await this.page.waitForSelector('[role="dialog"]', { timeout: 5e3 });
    } catch {
      this.log("Modal did not appear.");
      return [];
    }
    const results = await this.page.evaluate(async () => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return [];
      const scrollable = Array.from(dialog.querySelectorAll("div")).find((d) => {
        const style = window.getComputedStyle(d);
        return style.overflowY === "auto" || style.overflowY === "scroll";
      }) || dialog;
      const items = /* @__PURE__ */ new Map();
      for (let i = 0; i < 5; i++) {
        scrollable.scrollTop = scrollable.scrollHeight;
        await new Promise((r) => setTimeout(r, 500));
        const rows = Array.from(dialog.querySelectorAll('a[href*="/profile/"]'));
        rows.forEach((row) => {
          const href = row.getAttribute("href");
          const handle = href == null ? void 0 : href.split("/").pop();
          const img = row.querySelector("img");
          const nameEl = row.querySelector("div.font-bold") || row.querySelector("span.font-bold");
          if (handle) {
            items.set(handle, {
              handle: "@" + handle,
              avatarUrl: img == null ? void 0 : img.getAttribute("src"),
              displayName: (nameEl == null ? void 0 : nameEl.innerText) || handle
            });
          }
        });
      }
      return Array.from(items.values());
    });
    await this.page.keyboard.press("Escape");
    return results;
  }
  async indexProfileTab(tab, opts) {
    return [];
  }
  async testSelectors() {
    return { status: "Selectors deprecated in V1.0 stable" };
  }
  // QA / Diagnostics
  async runDiagnostics() {
    this.log("[QA] Starting self-diagnostics...");
    return await this.qaEngine.run(this.buildQAContext());
  }
  // Real-time QA Action
  async testScroll() {
    if (!this.page) throw new Error("Browser not launched");
    this.log("[QA] Testing scroll mechanism...");
    await this.page.keyboard.press("Escape");
    await this.page.waitForTimeout(300);
    const result = await this.qaEngine.runSingle("scroll", this.buildQAContext());
    if (!result) {
      this.log("[QA] [FAIL] Scroll test did not run.");
      return false;
    }
    if (result.status === "pass") {
      this.log("[QA] [PASS] Scrollable container found and manipulated.");
      return true;
    }
    this.log(`[QA] [FAIL] ${result.message}`);
    return false;
  }
  async init() {
    return this.launch();
  }
}
const DEFAULT_SETTINGS = () => ({
  exportRootPath: path.join(electron.app.getPath("documents"), "CAI_Exports"),
  lastAccountProfileUrl: null,
  ui: { theme: "dark", accent: "amber", wallpaper: null },
  verboseLogs: false,
  lastScan: null,
  userProfile: null
});
class StorageService {
  constructor(baseDir) {
    __publicField(this, "baseDir");
    __publicField(this, "storageDir");
    __publicField(this, "indexPath");
    __publicField(this, "settingsPath");
    __publicField(this, "profileDir");
    __publicField(this, "characterCachePath");
    __publicField(this, "sessionPath");
    __publicField(this, "viewerPath");
    __publicField(this, "chatsIndexPath");
    __publicField(this, "charactersIndexPath");
    __publicField(this, "personasIndexPath");
    __publicField(this, "voicesIndexPath");
    this.baseDir = baseDir;
    this.storageDir = path.join(baseDir, "storage");
    this.indexPath = path.join(this.storageDir, "exports-index.json");
    this.settingsPath = path.join(this.storageDir, "settings.json");
    this.profileDir = process.env.CAI_DUMPER_PROFILE_DIR || path.join(baseDir, "pw-profile");
    this.characterCachePath = path.join(this.storageDir, "character-cache.json");
    this.sessionPath = path.join(this.storageDir, "session.json");
    this.viewerPath = path.join(this.storageDir, "viewer.json");
    this.chatsIndexPath = path.join(this.storageDir, "chats-index.json");
    this.charactersIndexPath = path.join(this.storageDir, "characters-index.json");
    this.personasIndexPath = path.join(this.storageDir, "personas-index.json");
    this.voicesIndexPath = path.join(this.storageDir, "voices-index.json");
    this.ensureDirs();
  }
  getProfileDir() {
    this.ensureDirs();
    return this.profileDir;
  }
  resetProfileDir() {
    if (fs.existsSync(this.profileDir)) {
      fs.rmSync(this.profileDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.profileDir, { recursive: true });
    return this.profileDir;
  }
  getSettings() {
    const { data, changed } = this.readJson(this.settingsPath, DEFAULT_SETTINGS());
    if (changed) this.writeJson(this.settingsPath, data);
    return data;
  }
  saveSettings(partial) {
    const current = this.getSettings();
    const merged = {
      ...DEFAULT_SETTINGS(),
      ...current,
      ...partial,
      ui: { ...DEFAULT_SETTINGS().ui, ...current.ui || {}, ...partial.ui || {} }
    };
    this.writeJson(this.settingsPath, merged);
    return merged;
  }
  saveUserProfile(profile) {
    const current = this.getSettings();
    const updated = { ...current, userProfile: profile };
    this.writeJson(this.settingsPath, updated);
    return updated;
  }
  // Viewer persistence
  getViewer() {
    const { data } = this.readJson(this.viewerPath, null);
    return data || null;
  }
  saveViewer(viewer) {
    this.writeJson(this.viewerPath, viewer);
    const current = this.getSettings();
    this.writeJson(this.settingsPath, { ...current, userProfile: viewer });
    return viewer;
  }
  saveLastScan(count) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const settings = this.getSettings();
    const updated = { ...settings, lastScan: { at: now, count } };
    this.writeJson(this.settingsPath, updated);
    return updated;
  }
  getExportIndex() {
    const { data, changed } = this.readJson(this.indexPath, { exports: [] });
    const rawExports = Array.isArray(data.exports) ? data.exports : [];
    const validated = rawExports.map((e) => this.validateExportEntry(e)).filter((e) => !!e);
    const withStatus = validated.map((entry) => {
      const missing = [];
      if (!fs.existsSync(entry.exportDirAbsolutePath)) missing.push("exportDir");
      if (!fs.existsSync(entry.transcriptPath)) missing.push("transcript");
      if (!fs.existsSync(entry.metaPath)) missing.push("meta");
      if (entry.summaryPath && !fs.existsSync(entry.summaryPath)) missing.push("summary");
      return { ...entry, broken: missing.length ? missing : void 0 };
    });
    const record = { exports: withStatus };
    if (changed || withStatus.length !== data.exports.length) {
      this.writeJson(this.indexPath, record);
    }
    return record;
  }
  recordExport(entry) {
    const record = this.getExportIndex();
    const id = entry.id || `${entry.chatId}-${Date.parse(entry.exportedAt) || Date.now()}`;
    const nextEntry = {
      ...entry,
      id,
      lastOpenedAt: entry.lastOpenedAt || null,
      broken: void 0
    };
    const filtered = record.exports.filter((e) => e.id !== nextEntry.id && e.exportDirAbsolutePath !== nextEntry.exportDirAbsolutePath);
    const updated = { exports: [nextEntry, ...filtered].sort((a, b) => Date.parse(b.exportedAt) - Date.parse(a.exportedAt)) };
    this.writeJson(this.indexPath, updated);
    return nextEntry;
  }
  markOpened(id) {
    const record = this.getExportIndex();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const updated = record.exports.map((e) => e.id === id ? { ...e, lastOpenedAt: now } : e);
    this.writeJson(this.indexPath, { exports: updated });
  }
  removeEntry(id) {
    const record = this.getExportIndex();
    const updated = record.exports.filter((e) => e.id !== id);
    this.writeJson(this.indexPath, { exports: updated });
  }
  saveCharacterSnapshots(snapshots) {
    this.writeJson(this.characterCachePath, { snapshots, savedAt: (/* @__PURE__ */ new Date()).toISOString() });
  }
  getCharacterSnapshots() {
    const { data } = this.readJson(this.characterCachePath, { snapshots: [] });
    return Array.isArray(data.snapshots) ? data.snapshots : [];
  }
  saveChatsIndex(entries) {
    this.writeJson(this.chatsIndexPath, { entries, savedAt: (/* @__PURE__ */ new Date()).toISOString() });
  }
  getChatsIndex() {
    const { data } = this.readJson(this.chatsIndexPath, { entries: [] });
    return Array.isArray(data.entries) ? data.entries : [];
  }
  saveCharactersIndex(entries) {
    this.writeJson(this.charactersIndexPath, { entries, savedAt: (/* @__PURE__ */ new Date()).toISOString() });
  }
  getCharactersIndex() {
    const { data } = this.readJson(this.charactersIndexPath, { entries: [] });
    return Array.isArray(data.entries) ? data.entries : [];
  }
  savePersonasIndex(entries) {
    this.writeJson(this.personasIndexPath, { entries, savedAt: (/* @__PURE__ */ new Date()).toISOString() });
  }
  getPersonasIndex() {
    const { data } = this.readJson(this.personasIndexPath, { entries: [] });
    return Array.isArray(data.entries) ? data.entries : [];
  }
  saveVoicesIndex(entries) {
    this.writeJson(this.voicesIndexPath, { entries, savedAt: (/* @__PURE__ */ new Date()).toISOString() });
  }
  getVoicesIndex() {
    const { data } = this.readJson(this.voicesIndexPath, { entries: [] });
    return Array.isArray(data.entries) ? data.entries : [];
  }
  clearCaches() {
    try {
      if (fs.existsSync(this.characterCachePath)) fs.rmSync(this.characterCachePath, { force: true });
    } catch {
    }
    const settings = this.getSettings();
    this.writeJson(this.settingsPath, { ...settings, userProfile: null });
    try {
      if (fs.existsSync(this.sessionPath)) fs.rmSync(this.sessionPath, { force: true });
    } catch {
    }
    try {
      if (fs.existsSync(this.viewerPath)) fs.rmSync(this.viewerPath, { force: true });
    } catch {
    }
  }
  // --- Session snapshot helpers ---
  loadSessionSnapshot() {
    const fallback = this.defaultSession();
    const { data, changed } = this.readJson(this.sessionPath, fallback);
    const validated = this.validateSnapshot(data || fallback);
    if (changed) this.writeJson(this.sessionPath, validated);
    return validated;
  }
  saveSessionSnapshot(snapshot) {
    const sanitized = this.validateSnapshot(snapshot);
    this.writeJson(this.sessionPath, sanitized);
    return sanitized;
  }
  updateSessionSnapshot(patch) {
    const current = this.loadSessionSnapshot() || this.defaultSession();
    const merged = {
      ...current,
      ...patch,
      viewer: patch.viewer !== void 0 ? patch.viewer : current.viewer,
      characters: patch.characters !== void 0 ? patch.characters : current.characters,
      creators: patch.creators !== void 0 ? patch.creators : current.creators,
      personas: patch.personas !== void 0 ? patch.personas : current.personas,
      voices: patch.voices !== void 0 ? patch.voices : current.voices,
      chats: patch.chats !== void 0 ? patch.chats : current.chats,
      freshness: this.mergeFreshness(current.freshness, patch.freshness)
    };
    return this.saveSessionSnapshot(merged);
  }
  markSectionUpdated(section, timestamp) {
    const ts = timestamp || (/* @__PURE__ */ new Date()).toISOString();
    const current = this.loadSessionSnapshot() || this.defaultSession();
    const nextFreshness = {
      lastUpdated: ts,
      sections: { ...current.freshness.sections || {}, [section]: ts }
    };
    return this.saveSessionSnapshot({ ...current, freshness: nextFreshness });
  }
  validateSnapshot(raw) {
    const safe = raw || this.defaultSession();
    return {
      viewer: safe.viewer || null,
      characters: Array.isArray(safe.characters) ? safe.characters : [],
      creators: safe.creators && typeof safe.creators === "object" ? safe.creators : {},
      personas: Array.isArray(safe.personas) ? safe.personas : [],
      voices: Array.isArray(safe.voices) ? safe.voices : [],
      chats: Array.isArray(safe.chats) ? safe.chats : [],
      freshness: this.mergeFreshness({ lastUpdated: null, sections: {} }, safe.freshness)
    };
  }
  defaultSession() {
    return {
      viewer: null,
      characters: [],
      creators: {},
      personas: [],
      voices: [],
      chats: [],
      freshness: { lastUpdated: null, sections: {} }
    };
  }
  mergeFreshness(base, incoming) {
    return {
      lastUpdated: (incoming == null ? void 0 : incoming.lastUpdated) ?? base.lastUpdated ?? null,
      sections: { ...base.sections || {}, ...(incoming == null ? void 0 : incoming.sections) || {} }
    };
  }
  validateExportEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const required = ["chatId", "characterName", "exportedAt", "exportDirAbsolutePath", "messageCount", "transcriptPath", "metaPath"];
    for (const key of required) {
      if (!(key in raw)) return null;
    }
    return {
      id: typeof raw.id === "string" ? raw.id : `${raw.chatId}-${Date.parse(raw.exportedAt) || Date.now()}`,
      chatId: String(raw.chatId),
      chatUrl: raw.chatUrl ? String(raw.chatUrl) : null,
      characterName: String(raw.characterName),
      characterAvatarUrl: raw.characterAvatarUrl ?? null,
      viewerHandle: raw.viewerHandle ? String(raw.viewerHandle) : null,
      exportedAt: String(raw.exportedAt),
      createdAt: raw.createdAt ? String(raw.createdAt) : null,
      exportDirAbsolutePath: String(raw.exportDirAbsolutePath),
      messageCount: Number(raw.messageCount) || 0,
      summaryPath: raw.summaryPath || null,
      transcriptPath: String(raw.transcriptPath),
      metaPath: String(raw.metaPath),
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : void 0,
      lastOpenedAt: raw.lastOpenedAt ? String(raw.lastOpenedAt) : null,
      broken: void 0
    };
  }
  ensureDirs() {
    if (!fs.existsSync(this.storageDir)) fs.mkdirSync(this.storageDir, { recursive: true });
    if (!fs.existsSync(this.profileDir)) fs.mkdirSync(this.profileDir, { recursive: true });
  }
  readJson(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) return { data: fallback, changed: true };
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return { data: parsed, changed: false };
    } catch (e) {
      return { data: fallback, changed: true };
    }
  }
  writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }
}
class JobQueue {
  constructor() {
    __publicField(this, "currentJob", null);
    __publicField(this, "win", null);
  }
  setWindow(win2) {
    this.win = win2;
  }
  get isBusy() {
    return !!this.currentJob;
  }
  get currentJobType() {
    var _a;
    return ((_a = this.currentJob) == null ? void 0 : _a.type) || null;
  }
  async add(type, task, cancelFn) {
    if (this.currentJob) {
      throw new Error(`System busy with ${this.currentJob.type}. Please wait.`);
    }
    const id = Math.random().toString(36).substring(7);
    this.currentJob = { id, type, run: task, cancel: cancelFn };
    this.notify();
    try {
      const result = await task();
      return result;
    } finally {
      this.currentJob = null;
      this.notify();
    }
  }
  cancelCurrent() {
    if (this.currentJob && this.currentJob.cancel) {
      this.currentJob.cancel();
    }
  }
  notify() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send("job-status", {
        busy: !!this.currentJob,
        current: this.currentJob ? { type: this.currentJob.type, id: this.currentJob.id } : null
      });
    }
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
electron.app.commandLine.appendSwitch("remote-debugging-port", "9222");
process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_PUBLIC = electron.app.isPackaged ? process.env.DIST : path.join(process.env.DIST, "../public");
let win;
let browserView = null;
let scraper = null;
let qaMonitorTimer = null;
let qaMonitorBusy = false;
let lastQAReport = null;
let storage;
let sessionCache = null;
let hydrateCancelFlag = { cancel: false };
let profileIndexCancelFlag = { cancel: false };
const jobQueue = new JobQueue();
const sessionLogs = [];
let inFastScan = false;
const MAX_TRANSCRIPT_LINES_DEFAULT = 5e4;
function safeDateBucket(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
function tinyHash(input) {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h << 5) + h ^ input.charCodeAt(i);
  return (h >>> 0).toString(16);
}
function normalizeTranscriptMessage(raw, lineNo) {
  const text = typeof (raw == null ? void 0 : raw.text) === "string" ? raw.text : typeof (raw == null ? void 0 : raw.content) === "string" ? raw.content : String((raw == null ? void 0 : raw.text) ?? (raw == null ? void 0 : raw.content) ?? "");
  const roleRaw = String((raw == null ? void 0 : raw.role) ?? (raw == null ? void 0 : raw.sender) ?? (raw == null ? void 0 : raw.author) ?? "").toLowerCase();
  let sender = "unknown";
  if (roleRaw === "user" || roleRaw === "viewer" || roleRaw === "me") sender = "viewer";
  else if (roleRaw === "char" || roleRaw === "character" || roleRaw === "bot") sender = "character";
  else if (roleRaw === "system") sender = "system";
  const ts = typeof (raw == null ? void 0 : raw.timestamp) === "string" ? raw.timestamp : typeof (raw == null ? void 0 : raw.ts) === "string" ? raw.ts : null;
  const name = typeof (raw == null ? void 0 : raw.name) === "string" ? raw.name : typeof (raw == null ? void 0 : raw.author_name) === "string" ? raw.author_name : null;
  const idSeed = `${ts || ""}|${sender}|${name || ""}|${text}|${lineNo}`;
  return {
    id: tinyHash(idSeed),
    ts: ts || null,
    sender,
    name,
    text,
    attachments: Array.isArray(raw == null ? void 0 : raw.attachments) ? raw.attachments : void 0,
    raw
  };
}
async function readTranscriptJsonl(transcriptPath, maxLines = MAX_TRANSCRIPT_LINES_DEFAULT) {
  const warnings = [];
  if (!fs.existsSync(transcriptPath)) throw new Error(`Transcript not found: ${transcriptPath}`);
  const stream = fs.createReadStream(transcriptPath, { encoding: "utf-8" });
  let buf = "";
  let lineNo = 0;
  const ring = [];
  for await (const chunk of stream) {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
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
async function computeInsights(transcriptPath, maxLines = MAX_TRANSCRIPT_LINES_DEFAULT) {
  if (!fs.existsSync(transcriptPath)) {
    return {
      totalMessages: 0,
      viewerMessages: 0,
      characterMessages: 0,
      avgCharsPerMessage: 0,
      avgWordsPerMessage: 0,
      timelineBuckets: [],
      warnings: ["Transcript file not found"]
    };
  }
  const { messages, warnings } = await readTranscriptJsonl(transcriptPath, maxLines);
  let totalChars = 0;
  let totalWords = 0;
  let viewerMessages = 0;
  let characterMessages = 0;
  const buckets = {};
  for (const m of messages) {
    totalChars += m.text.length;
    totalWords += m.text.trim() ? m.text.trim().split(/\s+/g).length : 0;
    if (m.sender === "viewer") viewerMessages++;
    if (m.sender === "character") characterMessages++;
    const b = safeDateBucket(m.ts);
    if (b) buckets[b] = (buckets[b] || 0) + 1;
  }
  const totalMessages = messages.length;
  const timelineBuckets = Object.keys(buckets).sort().map((date) => ({ date, count: buckets[date] }));
  return {
    totalMessages,
    viewerMessages,
    characterMessages,
    avgCharsPerMessage: totalMessages ? totalChars / totalMessages : 0,
    avgWordsPerMessage: totalMessages ? totalWords / totalMessages : 0,
    timelineBuckets,
    warnings: warnings.length ? warnings : void 0
  };
}
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
  if (!electron.app.isPackaged) {
    console.log("[Main] Debug: VITE_DEV_SERVER_URL =", VITE_DEV_SERVER_URL);
    console.log("[Main] Debug: DIST =", process.env.DIST);
    console.log("[Main] Debug: __dirname =", __dirname);
  }
  win.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Main] Failed to load: ${validatedURL} (${errorCode}: ${errorDescription})`);
    if (errorCode !== -3) {
      electron.dialog.showErrorBox("Load Failed", `Failed to load: ${validatedURL}
Error: ${errorDescription} (${errorCode})`);
    }
  });
  win.webContents.on("render-process-gone", (event, details) => {
    console.error(`[Main] Render process gone: ${details.reason}`);
  });
  win.webContents.on("unresponsive", () => {
    console.error("[Main] Window unresponsive");
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else if (!electron.app.isPackaged) {
    console.log("[Main] VITE_DEV_SERVER_URL missing, trying default http://localhost:5173");
    win.loadURL("http://localhost:5173");
  } else {
    const indexHtml = path.join(process.env.DIST, "index.html");
    if (!fs.existsSync(indexHtml)) {
      console.error(`[Main] Production index.html not found at: ${indexHtml}`);
      electron.dialog.showErrorBox("Startup Error", `Could not find index.html at: ${indexHtml}`);
    }
    win.loadFile(indexHtml);
  }
  jobQueue.setWindow(win);
  const profileDir = storage.getProfileDir();
  const cacheDir = path.join(profileDir, "cache");
  scraper = new ScraperEngine(profileDir, (log) => {
    sessionLogs.push(log);
    win == null ? void 0 : win.webContents.send("scraper-log", log);
  }, cacheDir);
  scraper.setManualScrollHandler(async () => {
    const result = await electron.dialog.showMessageBox({
      type: "info",
      title: "Manual Scroll Required (Action Needed)",
      message: "Automatic scrolling seems to be stuck. Please scroll up manually in the chat view to load more history.",
      detail: 'Keep this dialog open while you scroll. Click "Continue" when you have loaded more messages.',
      buttons: ["Continue Auto-Scroll", "Stop & Extract"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    return result.response === 0;
  });
  electron.ipcMain.handle("save-logs", async (event, logs) => {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const { filePath } = await electron.dialog.showSaveDialog(win, {
      title: "Save Application Logs",
      defaultPath: `cai-dumper-logs-${timestamp}.txt`,
      filters: [{ name: "Text Files", extensions: ["txt"] }]
    });
    if (filePath) {
      try {
        const content = sessionLogs.length > 0 ? sessionLogs.join("\n") : logs.join("\n");
        fs.writeFileSync(filePath, content, "utf-8");
        return { success: true, path: filePath };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    return { success: false, error: "Cancelled" };
  });
  browserView = new electron.BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: "persist:cai"
    }
  });
  browserView.webContents.debugger.attach("1.1");
  browserView.webContents.on("did-navigate", (event, url) => {
    if (url.includes("/chat/")) {
      win == null ? void 0 : win.webContents.send("scraper-log", `[Live] Detected navigation to chat: ${url}`);
    }
  });
  browserView.webContents.loadURL("https://character.ai/profile");
}
electron.app.on("window-all-closed", () => {
  if (scraper) scraper.close();
  win = null;
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.whenReady().then(() => {
  storage = new StorageService(electron.app.getPath("userData"));
  sessionCache = storage.loadSessionSnapshot();
  const viewer = storage.getViewer();
  if (viewer) {
    sessionCache = storage.updateSessionSnapshot({ viewer });
  }
  createWindow();
});
electron.ipcMain.handle("show-browser-view", async (event, rect) => {
  if (!win) return;
  if (!browserView) {
    browserView = new electron.BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    browserView.webContents.loadURL("https://character.ai");
  }
  if (rect) {
    const MIN_Y = 64;
    const safeY = Math.max(rect.y, MIN_Y);
    const safeHeight = rect.height - (safeY - rect.y);
    browserView.setBounds({
      x: Math.round(rect.x),
      y: Math.round(safeY),
      width: Math.round(rect.width),
      height: Math.round(safeHeight)
    });
    browserView.setAutoResize({ width: false, height: false, horizontal: false, vertical: false });
    const attachedViews = win.getBrowserViews();
    if (!attachedViews.includes(browserView)) {
      win.addBrowserView(browserView);
    }
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
    setTimeout(applyBounds, 50);
    setTimeout(applyBounds, 200);
    browserView.webContents.focus();
  }
});
electron.ipcMain.handle("hide-browser-view", async () => {
  if (!win || !browserView) return;
  win.removeBrowserView(browserView);
});
electron.ipcMain.handle("resize-browser-view", async (event, rect) => {
  if (browserView) {
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
electron.ipcMain.handle("set-always-on-top", async (event, flag) => {
  if (win) {
    win.setAlwaysOnTop(flag);
  }
});
let detachedWindow = null;
electron.ipcMain.handle("detach-browser", async () => {
  if (!browserView || !win) return;
  const url = browserView.webContents.getURL();
  win.removeBrowserView(browserView);
  if (detachedWindow && !detachedWindow.isDestroyed()) {
    detachedWindow.focus();
    return;
  }
  detachedWindow = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: "persist:cai"
      // Share session
    }
  });
  detachedWindow.loadURL(url);
  detachedWindow.webContents.on("did-navigate", (event, url2) => {
    if (url2.includes("/chat/")) {
      win == null ? void 0 : win.webContents.send("scraper-log", `[Live] Detected navigation in detached window: ${url2}`);
    }
  });
  detachedWindow.on("closed", () => {
    detachedWindow = null;
    win == null ? void 0 : win.webContents.send("browser-detached-closed");
  });
});
electron.ipcMain.handle("attach-browser", async () => {
  if (detachedWindow && !detachedWindow.isDestroyed()) {
    detachedWindow.close();
  }
});
electron.ipcMain.handle("scrape-current-page", async () => {
  if (!browserView) return { success: false, message: "No browser view active" };
  try {
    const url = browserView.webContents.getURL();
    const data = await browserView.webContents.executeJavaScript(`
            (() => {
                return {
                    url: window.location.href,
                    title: document.title,
                };
            })()
        `);
    win == null ? void 0 : win.webContents.send("scraper-log", `[Live] Captured data from ${data.title}`);
    return { success: true, message: "Scraped successfully", data };
  } catch (e) {
    return { success: false, message: e.message };
  }
});
electron.ipcMain.handle("launch-browser", async () => {
  if (!scraper) {
    const userDataDir = path.join(electron.app.getPath("userData"), "scraper-session");
    const logCallback = (msg) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("scraper-log", msg);
      }
    };
    scraper = new ScraperEngine(userDataDir, logCallback);
  }
  await scraper.init();
  return true;
});
electron.ipcMain.handle("check-browser-status", async () => {
  if (!scraper) return false;
  return !!scraper.page && !scraper.page.isClosed();
});
async function runSidebarScan() {
  return jobQueue.add("scan", async () => {
    if (!scraper) throw new Error("Scraper not initialized");
    inFastScan = true;
    try {
      const snapshots = await scraper.scanSidebar();
      let viewer = (sessionCache == null ? void 0 : sessionCache.viewer) || storage.getViewer() || null;
      try {
        const v = await scraper.scrapeViewerProfile();
        if (v) {
          storage.saveViewer(v);
          viewer = v;
        }
      } catch (e) {
        win == null ? void 0 : win.webContents.send("scraper-log", `[Session] Viewer scrape skipped/failed during scan: ${e.message}`);
      }
      const chatIndex = snapshots.map((s) => ({
        chatId: s.chatId,
        chatUrl: s.url,
        characterName: s.displayName,
        avatarUrl: s.avatarUrl || null,
        lastSeenLabel: s.lastSeenLabel || s.lastInteractedLabel || null,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }));
      storage.saveCharacterSnapshots(snapshots);
      storage.saveLastScan(snapshots.length);
      storage.saveChatsIndex(chatIndex);
      sessionCache = storage.updateSessionSnapshot({
        viewer,
        characters: snapshots
      });
      sessionCache = storage.markSectionUpdated("characters");
      if (viewer) sessionCache = storage.markSectionUpdated("viewer");
      broadcastSession();
      return { viewer, chats: chatIndex };
    } finally {
      inFastScan = false;
    }
  });
}
electron.ipcMain.handle("fetch-chats", async () => {
  return runSidebarScan();
});
electron.ipcMain.handle("refresh-sidebar-scan", async () => {
  return runSidebarScan();
});
electron.ipcMain.handle("export-chat", async (event, { url, characterName, reverseTranscript, avatarUrl }) => {
  return jobQueue.add("export", async () => {
    var _a;
    if (!scraper) throw new Error("Scraper not initialized");
    win == null ? void 0 : win.webContents.send("scraper-log", `[Export] Starting export for ${characterName} from ${url}`);
    if (!scraper.isLaunched()) {
      win == null ? void 0 : win.webContents.send("scraper-log", `[Export] Connecting to BrowserView for network interception...`);
      await scraper.launch("http://localhost:9222");
      win == null ? void 0 : win.webContents.send("scraper-log", `[Export] Network interception ready`);
    }
    try {
      win == null ? void 0 : win.webContents.send("scraper-log", `[Export] Scraping chat data...`);
      const scrapeResult = await scraper.scrapeChat(url, { reverseTranscript, characterName });
      const rawMessages = scrapeResult.messages;
      win == null ? void 0 : win.webContents.send("scraper-log", `[Export] Scraped ${rawMessages.length} messages`);
      const settings = storage == null ? void 0 : storage.getSettings();
      const exportRoot = (settings == null ? void 0 : settings.exportRootPath) || path.join(electron.app.getPath("documents"), "CAI_Exports");
      const exportBase = path.join(exportRoot, characterName.replace(/[^a-z0-9]/gi, "_"));
      const chatId = url.split("/").pop() || "unknown_id";
      const chatDir = path.join(exportBase, chatId);
      win == null ? void 0 : win.webContents.send("scraper-log", `[Export] Saving to ${chatDir}`);
      if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
      const meta = {
        characterName,
        chatId,
        url,
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        messageCount: rawMessages.length
      };
      const viewerHandle = ((_a = sessionCache == null ? void 0 : sessionCache.viewer) == null ? void 0 : _a.handle) || "You";
      const charHeader = characterName || "Character";
      const jsonlPath = path.join(chatDir, "transcript.jsonl");
      const jsonStream = fs.createWriteStream(jsonlPath, { flags: "w" });
      for (const msg of rawMessages) {
        jsonStream.write(JSON.stringify(msg) + "\n");
      }
      jsonStream.end();
      const mdPath = path.join(chatDir, "transcript.md");
      const mdStream = fs.createWriteStream(mdPath, { flags: "w" });
      mdStream.write(`# Chat with ${characterName}

`);
      for (const msg of rawMessages) {
        const header = msg.role === "user" ? viewerHandle : charHeader;
        mdStream.write(`**${header}:**
${msg.text}

---

`);
      }
      mdStream.end();
      const metaPath = path.join(chatDir, "meta.json");
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      if (scrapeResult.diagnostics) {
        fs.writeFileSync(path.join(chatDir, "diagnostics.json"), JSON.stringify(scrapeResult.diagnostics, null, 2));
      }
      if (rawMessages.length === 0) {
        const warning = "Export produced 0 messages; skipping analysis. Run 'Test selectors' to debug extraction.";
        win == null ? void 0 : win.webContents.send("analysis-log", warning);
        return { path: chatDir, count: rawMessages.length, analysisSkipped: true, warning };
      }
      const summaryPath = fs.existsSync(path.join(chatDir, "summary.md")) ? path.join(chatDir, "summary.md") : null;
      const recorded = storage == null ? void 0 : storage.recordExport({
        chatId,
        chatUrl: url,
        characterName,
        characterAvatarUrl: avatarUrl || null,
        viewerHandle: viewerHandle === "You" ? null : viewerHandle,
        exportedAt: meta.exportedAt,
        exportDirAbsolutePath: chatDir,
        messageCount: rawMessages.length,
        summaryPath,
        transcriptPath: jsonlPath,
        metaPath,
        tags: [],
        lastOpenedAt: null
      });
      win == null ? void 0 : win.webContents.send("export-index-updated", storage == null ? void 0 : storage.getExportIndex());
      return { path: chatDir, count: rawMessages.length, analysisSkipped: false, recorded };
    } catch (error) {
      win == null ? void 0 : win.webContents.send("scraper-log", `[Export] Error during scraping: ${error}`);
      throw error;
    }
  });
});
electron.ipcMain.handle("test-selectors", async () => {
  if (!scraper) throw new Error("Scraper not initialized");
  return await scraper.testSelectors();
});
electron.ipcMain.handle("run-analysis", async (event, { folderPath }) => {
  return jobQueue.add("analysis", async () => {
    const jsonlPath = path.join(folderPath, "transcript.jsonl");
    if (!fs.existsSync(jsonlPath)) throw new Error("transcript.jsonl not found in folder");
    const { scriptPath, tried } = resolveAnalyzerPath();
    win == null ? void 0 : win.webContents.send("analysis-log", `Using analyzer: ${scriptPath}`);
    const output = await runPythonAnalysis(scriptPath, jsonlPath, (log) => {
      win == null ? void 0 : win.webContents.send("analysis-log", log);
    });
    const summaryPath = path.join(folderPath, "summary.md");
    const metaPath = path.join(folderPath, "meta.json");
    try {
      if (storage && fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        const index = storage.getExportIndex();
        const existing = index.exports.find((e) => e.exportDirAbsolutePath === folderPath);
        if (existing) {
          storage.recordExport({ ...existing, summaryPath: fs.existsSync(summaryPath) ? summaryPath : existing.summaryPath });
          win == null ? void 0 : win.webContents.send("export-index-updated", storage.getExportIndex());
        } else {
          storage.recordExport({
            chatId: meta.chatId || path.basename(folderPath),
            characterName: meta.characterName || "Unknown",
            characterAvatarUrl: meta.avatarUrl || null,
            exportedAt: meta.exportedAt || (/* @__PURE__ */ new Date()).toISOString(),
            exportDirAbsolutePath: folderPath,
            messageCount: meta.messageCount || 0,
            summaryPath: fs.existsSync(summaryPath) ? summaryPath : null,
            transcriptPath: jsonlPath,
            metaPath,
            lastOpenedAt: null,
            tags: []
          });
          win == null ? void 0 : win.webContents.send("export-index-updated", storage.getExportIndex());
        }
      }
    } catch (err) {
      win == null ? void 0 : win.webContents.send("analysis-log", `Index update failed: ${err.message}`);
    }
    return output;
  });
});
electron.ipcMain.handle("export-diagnostics", async () => {
  const diagPath = path.join(electron.app.getPath("documents"), "CAI_Exports", "diagnostics");
  if (!fs.existsSync(diagPath)) fs.mkdirSync(diagPath, { recursive: true });
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const folder = path.join(diagPath, `diag_${timestamp}`);
  fs.mkdirSync(folder);
  const info = {
    appVersion: electron.app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    settings: storage.getSettings(),
    session: sessionCache,
    exportIndex: storage.getExportIndex()
  };
  fs.writeFileSync(path.join(folder, "system_info.json"), JSON.stringify(info, null, 2));
  await electron.shell.openPath(folder);
  return folder;
});
electron.ipcMain.handle("cancel-job", async () => jobQueue.cancelCurrent());
electron.ipcMain.handle("open-folder", (event, p) => {
  electron.shell.openPath(p);
});
electron.ipcMain.handle("open-path-in-explorer", async (_event, p) => {
  if (!p) return;
  try {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      await electron.shell.openPath(p);
    } else {
      electron.shell.showItemInFolder(p);
    }
  } catch {
    electron.shell.showItemInFolder(p);
  }
});
electron.ipcMain.handle("open-file", async (_event, p) => {
  if (!p) return;
  await electron.shell.openPath(p);
});
electron.ipcMain.handle("list-exports-for-chat", async (_event, chatId) => {
  const record = storage.getExportIndex();
  const list = (record.exports || []).filter((e) => e.chatId === chatId);
  return list.sort((a, b) => Date.parse(b.exportedAt) - Date.parse(a.exportedAt));
});
electron.ipcMain.handle("read-summary", async (_event, summaryPath) => {
  if (!summaryPath) return "";
  if (!fs.existsSync(summaryPath)) return "";
  return fs.readFileSync(summaryPath, "utf-8");
});
electron.ipcMain.handle("read-transcript", async (_event, inputPath, maxLines) => {
  if (!inputPath) throw new Error("Path is required");
  let p = inputPath;
  if (fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory() || !inputPath.toLowerCase().endsWith(".jsonl")) {
    p = path.join(inputPath, "transcript.jsonl");
  }
  if (!fs.existsSync(p)) {
    return { transcriptPath: p, messages: [], warnings: ["Transcript file not found. The folder may have been deleted or moved."] };
  }
  const { messages, warnings } = await readTranscriptJsonl(p, maxLines || MAX_TRANSCRIPT_LINES_DEFAULT);
  return { transcriptPath: p, messages, warnings };
});
electron.ipcMain.handle("read-transcript-page", async (_event, transcriptPath, opts) => {
  if (!transcriptPath) throw new Error("transcriptPath is required");
  const direction = (opts == null ? void 0 : opts.direction) || "older";
  const pageSize = Math.max(1, Number(opts == null ? void 0 : opts.pageSize) || 25e3);
  const currentMaxLines = Math.max(1, Number(opts == null ? void 0 : opts.currentMaxLines) || MAX_TRANSCRIPT_LINES_DEFAULT);
  if (direction !== "older") {
    const { messages: messages2, warnings: warnings2 } = await readTranscriptJsonl(transcriptPath, currentMaxLines);
    return { transcriptPath, messages: messages2, warnings: warnings2, maxLines: currentMaxLines, truncated: (warnings2 || []).some((w) => w.includes("Showing last")) };
  }
  const nextMaxLines = currentMaxLines + pageSize;
  const { messages, warnings } = await readTranscriptJsonl(transcriptPath, nextMaxLines);
  return { transcriptPath, messages, warnings, maxLines: nextMaxLines, truncated: (warnings || []).some((w) => w.includes("Showing last")) };
});
electron.ipcMain.handle("compute-insights-from-transcript", async (_event, transcriptPath, maxLines) => {
  return computeInsights(transcriptPath, maxLines || MAX_TRANSCRIPT_LINES_DEFAULT);
});
electron.ipcMain.handle("get-export-index", async () => storage.getExportIndex());
electron.ipcMain.handle("get-profile-dir", async () => storage.getProfileDir());
electron.ipcMain.handle("get-character-cache", async () => storage.getCharacterSnapshots());
electron.ipcMain.handle("get-user-profile", async () => storage.getViewer() || storage.getSettings().userProfile || null);
electron.ipcMain.handle("get-viewer", async () => storage.getViewer());
electron.ipcMain.handle("get-session", async () => {
  sessionCache = storage.loadSessionSnapshot();
  win == null ? void 0 : win.webContents.send("session-updated", sessionCache);
  return sessionCache;
});
electron.ipcMain.handle("save-session", async (_event, patch) => {
  sessionCache = storage.updateSessionSnapshot(patch);
  broadcastSession();
  return sessionCache;
});
electron.ipcMain.handle("refresh-viewer-profile", async () => {
  return jobQueue.add("refresh-viewer", async () => {
    if (!scraper) throw new Error("Scraper not initialized");
    try {
      const profile = await scraper.scrapeViewerProfile();
      if (profile) {
        storage.saveViewer(profile);
        sessionCache = storage.updateSessionSnapshot({ viewer: profile });
        sessionCache = storage.markSectionUpdated("viewer");
        broadcastSession();
        return { session: sessionCache, profile };
      }
    } catch (e) {
      win == null ? void 0 : win.webContents.send("scraper-log", `[Session] Viewer refresh failed: ${e.message}`);
    }
    return { session: sessionCache, profile: null };
  });
});
electron.ipcMain.handle("refresh-creator-profiles", async (_event, usernames) => {
  if (!scraper) throw new Error("Scraper not initialized");
  if (inFastScan) {
    throw new Error("[Invariant] Creator hydration attempted during fast scan");
  }
  hydrateCancelFlag.cancel = false;
  const progressChannel = "creator-hydrate-progress";
  const creators = (sessionCache == null ? void 0 : sessionCache.creators) ? { ...sessionCache.creators } : {};
  const isValidHandle = (h) => /^@[A-Za-z0-9_]{2,32}$/.test(h);
  const isValidUsername = (u) => /^[A-Za-z0-9_]{2,32}$/.test(u);
  const raw = Array.isArray(usernames) ? usernames : [];
  const normalized = raw.map((n) => (n || "").trim()).filter(Boolean).map((n) => n.startsWith("@") ? n : `@${n}`).filter(isValidHandle).map((h) => h.replace(/^@/, "")).filter(isValidUsername);
  const unique = Array.from(new Set(normalized));
  if (unique.length === 0) {
    win == null ? void 0 : win.webContents.send(progressChannel, { total: 0, completed: 0 });
    return { session: sessionCache, updated: 0, message: "No creators to refresh" };
  }
  const concurrency = 3;
  let completed = 0;
  let updated = 0;
  let failed = 0;
  const startedAt = Date.now();
  win == null ? void 0 : win.webContents.send(progressChannel, { total: unique.length, completed: 0, updated: 0, failed: 0 });
  const runOne = async (name) => {
    if (hydrateCancelFlag.cancel) return;
    try {
      const cprof = await scraper.getCreatorProfile(name);
      if (hydrateCancelFlag.cancel) return;
      if (cprof) {
        creators[name] = cprof;
        updated++;
      }
    } catch (e) {
      failed++;
      win == null ? void 0 : win.webContents.send("scraper-log", `[Session] Creator refresh failed for ${name}: ${e.message}`);
    } finally {
      completed++;
      win == null ? void 0 : win.webContents.send(progressChannel, {
        total: unique.length,
        completed,
        updated,
        failed,
        cancelled: hydrateCancelFlag.cancel,
        elapsedMs: Date.now() - startedAt
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
    win == null ? void 0 : win.webContents.send(progressChannel, { total: unique.length, completed, updated, failed, cancelled: true });
    return { session: sessionCache, updated, message: "Cancelled" };
  }
  sessionCache = storage.updateSessionSnapshot({ creators });
  sessionCache = storage.markSectionUpdated("creators");
  broadcastSession();
  win == null ? void 0 : win.webContents.send("creators-index-updated", creators);
  return { session: sessionCache, updated, message: updated === 0 ? "No creators updated" : void 0 };
});
electron.ipcMain.handle("hydrate-chats-metadata", async (_event, urls, limit) => {
  if (!scraper) throw new Error("Scraper not initialized");
  hydrateCancelFlag.cancel = false;
  const progressChannel = "hydrate-progress";
  const metadata = await scraper.hydrateChatsMetadata(urls, { limit, signal: () => hydrateCancelFlag.cancel });
  if (hydrateCancelFlag.cancel) {
    win == null ? void 0 : win.webContents.send(progressChannel, { cancelled: true });
    return { cancelled: true, metadata: [] };
  }
  win == null ? void 0 : win.webContents.send(progressChannel, { completed: metadata.length });
  return { cancelled: false, metadata };
});
electron.ipcMain.handle("cancel-hydrate", async () => {
  hydrateCancelFlag.cancel = true;
  return { cancelled: true };
});
electron.ipcMain.handle("refresh-characters-from-profile", async (_event, sortMode = "most_chats") => {
  if (!scraper) throw new Error("Scraper not initialized");
  const viewer = storage.getViewer() || (sessionCache == null ? void 0 : sessionCache.viewer);
  if (!(viewer == null ? void 0 : viewer.handle)) throw new Error("Viewer handle unknown; refresh viewer first");
  const entries = await scraper.scrapeProfileCharacters(viewer.handle, sortMode).catch((e) => {
    win == null ? void 0 : win.webContents.send("scraper-log", `[Profile] Failed: ${e.message}`);
    return [];
  });
  storage.saveCharactersIndex(entries);
  win == null ? void 0 : win.webContents.send("characters-index-updated", entries);
  return entries;
});
electron.ipcMain.handle("get-personas-index", async () => storage.getPersonasIndex());
electron.ipcMain.handle("get-voices-index", async () => storage.getVoicesIndex());
electron.ipcMain.handle("refresh-personas-index", async (_event, opts) => {
  if (!scraper) throw new Error("Scraper not initialized");
  profileIndexCancelFlag.cancel = false;
  const entries = await scraper.indexProfileTab("personas", { maxItems: opts == null ? void 0 : opts.maxItems, signal: () => profileIndexCancelFlag.cancel });
  if (profileIndexCancelFlag.cancel) return { cancelled: true, entries: [] };
  storage.savePersonasIndex(entries);
  sessionCache = storage.updateSessionSnapshot({ personas: entries });
  sessionCache = storage.markSectionUpdated("personas");
  win == null ? void 0 : win.webContents.send("personas-index-updated", entries);
  broadcastSession();
  return { cancelled: false, entries };
});
electron.ipcMain.handle("refresh-voices-index", async (_event, opts) => {
  if (!scraper) throw new Error("Scraper not initialized");
  profileIndexCancelFlag.cancel = false;
  const entries = await scraper.indexProfileTab("voices", { maxItems: opts == null ? void 0 : opts.maxItems, signal: () => profileIndexCancelFlag.cancel });
  if (profileIndexCancelFlag.cancel) return { cancelled: true, entries: [] };
  storage.saveVoicesIndex(entries);
  sessionCache = storage.updateSessionSnapshot({ voices: entries });
  sessionCache = storage.markSectionUpdated("voices");
  win == null ? void 0 : win.webContents.send("voices-index-updated", entries);
  broadcastSession();
  return { cancelled: false, entries };
});
electron.ipcMain.handle("cancel-profile-index", async () => {
  profileIndexCancelFlag.cancel = true;
  return { cancelled: true };
});
electron.ipcMain.handle("get-characters-index", async () => storage.getCharactersIndex());
electron.ipcMain.handle("scrape-followers-list", async (_, type) => {
  if (!scraper) throw new Error("Scraper not initialized");
  return await scraper.scrapeFollowersList(type);
});
electron.ipcMain.handle("remove-export-entry", async (_event, id) => {
  storage.removeEntry(id);
  return storage.getExportIndex();
});
electron.ipcMain.handle("mark-export-opened", async (_event, id) => {
  storage.markOpened(id);
  return storage.getExportIndex();
});
electron.ipcMain.handle("get-settings", async () => storage.getSettings());
electron.ipcMain.handle("get-chats-index", async () => storage.getChatsIndex());
electron.ipcMain.handle("save-settings", async (_event, partial) => storage.saveSettings(partial));
electron.ipcMain.handle("choose-export-root", async () => {
  if (!win) throw new Error("Window not ready");
  const res = await electron.dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  if (res.canceled || res.filePaths.length === 0) return storage.getSettings();
  const chosen = res.filePaths[0];
  return storage.saveSettings({ exportRootPath: chosen });
});
electron.ipcMain.handle("reset-browser-profile", async () => {
  scraper == null ? void 0 : scraper.close();
  scraper = null;
  const dir = storage.resetProfileDir();
  storage.clearCaches();
  sessionCache = storage.loadSessionSnapshot();
  broadcastSession();
  return { profileDir: dir };
});
electron.ipcMain.handle("run-diagnostics", async () => {
  if (!scraper) {
    const report = buildUnavailableQAReport("Scraper not initialized");
    lastQAReport = report;
    return report;
  }
  try {
    const report = await scraper.runDiagnostics();
    lastQAReport = report;
    return report;
  } catch (e) {
    const report = buildUnavailableQAReport(e.message || "Diagnostics failed");
    lastQAReport = report;
    return report;
  }
});
const buildUnavailableQAReport = (message) => ({
  startedAt: (/* @__PURE__ */ new Date()).toISOString(),
  finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
  durationMs: 0,
  url: void 0,
  checks: [
    {
      id: "browser",
      name: "Browser Connection",
      status: "fail",
      message,
      details: null,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
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
    win.webContents.send("qa-report", report);
  } catch (e) {
    win.webContents.send("qa-report", {
      error: (e == null ? void 0 : e.message) || "QA monitor error"
    });
  } finally {
    qaMonitorBusy = false;
  }
};
electron.ipcMain.handle("start-qa-monitor", async (_event, intervalMs) => {
  if (!scraper) {
    lastQAReport = buildUnavailableQAReport("Scraper not initialized");
    return { active: false, lastReport: lastQAReport };
  }
  if (qaMonitorTimer) return { active: true, lastReport: lastQAReport };
  const interval = typeof intervalMs === "number" && intervalMs >= 1e3 ? intervalMs : 3e3;
  qaMonitorTimer = setInterval(runQAMonitorCycle, interval);
  runQAMonitorCycle();
  return { active: true, lastReport: lastQAReport };
});
electron.ipcMain.handle("stop-qa-monitor", async () => {
  if (qaMonitorTimer) {
    clearInterval(qaMonitorTimer);
    qaMonitorTimer = null;
  }
  return { active: false, lastReport: lastQAReport };
});
electron.ipcMain.handle("get-qa-state", async () => ({
  active: Boolean(qaMonitorTimer),
  lastReport: lastQAReport
}));
const getQAWebContentsTargets = () => {
  const targets = [];
  if (browserView && !browserView.webContents.isDestroyed()) {
    targets.push(browserView.webContents);
  }
  if (detachedWindow && !detachedWindow.isDestroyed()) {
    targets.push(detachedWindow.webContents);
  }
  return targets;
};
electron.ipcMain.handle("qa-overlay", async (_event, enable) => {
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
  const results = [];
  for (const wc of getQAWebContentsTargets()) {
    results.push(await wc.executeJavaScript(script));
  }
  return { results };
});
electron.ipcMain.handle("force-scroll-probe", async () => {
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
  const results = [];
  for (const wc of getQAWebContentsTargets()) {
    results.push(await wc.executeJavaScript(script));
  }
  return { results };
});
electron.ipcMain.handle("save-qa-snapshot", async () => {
  const report = scraper ? await scraper.runDiagnostics() : buildUnavailableQAReport("Scraper not initialized");
  lastQAReport = report;
  const baseDir = path.join(electron.app.getPath("documents"), "CAI_Exports", "diagnostics", "qa_snapshots");
  fs.mkdirSync(baseDir, { recursive: true });
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(baseDir, `qa_snapshot_${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  return { path: filePath };
});
electron.ipcMain.handle("toggle-snow", async (event, enable) => {
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
    if (detachedWindow && !detachedWindow.isDestroyed()) {
      await detachedWindow.webContents.executeJavaScript(snowScript);
    }
  } catch (e) {
    console.error("Failed to toggle snow on views", e);
  }
});
electron.ipcMain.handle("test-scroll", async () => {
  if (!scraper) return { error: "Scraper not initialized" };
  try {
    const success = await scraper.testScroll();
    return { success };
  } catch (e) {
    return { error: e.message };
  }
});
function broadcastSession() {
  if (!win || !sessionCache) return;
  win.webContents.send("session-updated", sessionCache);
  win.webContents.send("scraper-log", `[Session] Saved session snapshot`);
}
