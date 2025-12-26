import { chromium, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { CharacterSummary, CreatorProfile, ViewerProfile, CharacterIndexEntry, ChatIndexEntry, PersonaSummary, VoiceSummary } from '../types';

export interface ScrapedMessage {
  turn_index: number;
  role: 'user' | 'char';
  text: string;
  html: string;
}

export class ScraperEngine {
  private browserContext: BrowserContext | null = null;
  private page: Page | null = null;
  private userDataDir: string;
  private cacheDir: string;
  private logCallback: (msg: string) => void;
  private verboseSanitizeLogs: boolean;

  constructor(userDataDir: string, logCallback: (msg: string) => void, cacheDir?: string) {
    this.userDataDir = userDataDir;
    this.cacheDir = cacheDir || path.join(userDataDir, 'cache');
    this.logCallback = logCallback;
    this.verboseSanitizeLogs = /^(1|true|yes|on)$/i.test(process.env.CAI_DUMPER_VERBOSE_SANITIZE || '');
  }

  private log(msg: string) {
    console.log(`[Scraper] ${msg}`);
    this.logCallback(msg);
  }

  private sanitizeText(
    raw: unknown,
    ctx: {
      field: string;
      url?: string;
      maxLen?: number;
    }
  ): string | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string') {
      if (this.verboseSanitizeLogs) this.log(`[sanitize] drop non-string ${ctx.field} (${typeof raw}) ${ctx.url || ''}`);
      return null;
    }

    let s = raw;
    // Normalize whitespace
    s = s.replace(/\r\n/g, '\n');
    s = s.replace(/[\t\f\v]/g, ' ');
    s = s.replace(/\u00a0/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();

    if (!s) return null;

    // Hard reject common noise we've seen leak in from app shells / toast libraries
    const lowered = s.toLowerCase();
    const noiseMarkers = [
      'toast-container',
      'toastify',
      'react-toastify',
      'css',
      '{',
      '}',
      'style=',
      '<style',
      '</style',
      'animation:',
      '@keyframes',
    ];
    if (noiseMarkers.some((m) => lowered.includes(m))) {
      if (this.verboseSanitizeLogs) this.log(`[sanitize] drop noisy ${ctx.field}: ${JSON.stringify(s.slice(0, 160))} ${ctx.url || ''}`);
      return null;
    }

    const maxLen = ctx.maxLen ?? 300;
    if (s.length > maxLen) {
      const clipped = s.slice(0, maxLen).trim();
      if (this.verboseSanitizeLogs) this.log(`[sanitize] clip ${ctx.field} ${s.length}→${clipped.length} ${ctx.url || ''}`);
      s = clipped;
    }
    return s || null;
  }

  private isValidHandle(handle: string | null | undefined): handle is string {
    if (!handle) return false;
    return /^@[A-Za-z0-9_]{2,32}$/.test(handle.trim());
  }

  private qualityGateText(
    s: string | null,
    ctx: { field: string; url?: string; maxLen?: number }
  ): string | null {
    if (!s) return null;
    const lowered = s.toLowerCase();
    const banned = ['toastify', '@keyframes', ':root', '{', '}'];
    if (banned.some((b) => lowered.includes(b))) {
      if (this.verboseSanitizeLogs) this.log(`[quality] drop banned ${ctx.field}: ${JSON.stringify(s.slice(0, 160))} ${ctx.url || ''}`);
      return null;
    }
    // Reject if >30% are "weird" characters (not letter/digit/space/common punctuation)
    const total = s.length;
    const okChars = s.match(/[A-Za-z0-9\s.,'"!?@#\-_/():;\[\]\\]/g)?.length ?? 0;
    const weirdRatio = total > 0 ? (total - okChars) / total : 0;
    if (weirdRatio > 0.3) {
      if (this.verboseSanitizeLogs) this.log(`[quality] drop weird-ratio ${ctx.field} ${(weirdRatio * 100).toFixed(1)}% ${ctx.url || ''}`);
      return null;
    }
    const maxLen = ctx.maxLen ?? 300;
    if (s.length > maxLen) return s.slice(0, maxLen).trim() || null;
    return s;
  }

  private safeText(raw: unknown, ctx: { field: string; url?: string; maxLen?: number }): string | null {
    return this.qualityGateText(this.sanitizeText(raw, ctx), ctx);
  }

  private parseCompactNumber(raw?: string | null): number | null {
    if (!raw) return null;
    const cleaned = raw.replace(/[\s,]/g, '').toLowerCase();
    const m = cleaned.match(/(-?[0-9]*\.?[0-9]+)(k|m)?/);
    if (!m) return null;
    const base = Number(m[1]);
    if (!isFinite(base)) return null;
    if (m[2] === 'k') return Math.round(base * 1000);
    if (m[2] === 'm') return Math.round(base * 1_000_000);
    return Math.round(base);
  }

  async launch() {
    this.log("Launching persistent Chromium context...");
    try {
      if (!fs.existsSync(this.userDataDir)) fs.mkdirSync(this.userDataDir, { recursive: true });
      if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });

      this.browserContext = await chromium.launchPersistentContext(this.userDataDir, {
        headless: false,
        viewport: null,
        args: [
          '--start-maximized',
          '--disable-blink-features=AutomationControlled',
          `--disk-cache-dir=${this.cacheDir}`,
          '--disable-gpu-cache',
        ],
      });
    } catch (err: any) {
      this.log(`Warning: Failed to create cache/user data dir (${err.message}). Continuing without custom cache.`);
      this.browserContext = await chromium.launchPersistentContext(this.userDataDir, {
        headless: false,
        viewport: null,
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled', '--disable-gpu-cache'],
      });
    }
    
    this.page = await this.browserContext.newPage();
    await this.page.goto('https://character.ai');
    this.log("Browser ready. Please log in manually in the opened window.");
  }

  async close() {
    if (this.browserContext) await this.browserContext.close();
  }

  // Character sidebar scan is DOM-only by design (no backend calls) to respect constraints.
  async scanSidebar(): Promise<CharacterSummary[]> {
    if (!this.page) throw new Error("Browser not launched");
    this.log("Scanning sidebar for chats...");

    // Fallback strategy for Sidebar
    // Look for links that contain "/chat/"
    try {
        await this.page.waitForSelector('a[href*="/chat/"]', { timeout: 5000 });
    } catch (e) {
        this.log("No chat links found immediately. Please ensure sidebar is open.");
        return [];
    }

    // Scroll sidebar (simple heuristic: find the sidebar container)
    // This is tricky as CAI structure changes. We try to find the container of the links.
    // Logic: Find links, find common parent, scroll parent.
    
    // For V1 robustness: We just grab what is visible + a bit of scroll. 
    // Full infinite scroll of sidebar is risky without exact selectors.
    
  const seen = new Map<string, CharacterSummary>();
    
    for (let i = 0; i < 3; i++) { // Try scrolling a few times
        const elements = await this.page.$$('a[href*="/chat/"]');
        this.log(`Found ${elements.length} potential chat links (Pass ${i+1})...`);
        
  const batch = await this.page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href*="/chat/"]')) as HTMLAnchorElement[];

          const parseNumber = (val: string | null | undefined): number | null => {
            if (!val) return null;
            const cleaned = val.replace(/[,\s]/g, '').toLowerCase();
            const match = cleaned.match(/([0-9\.]+)(k|m)?/);
            if (!match) return null;
            const num = parseFloat(match[1]);
            if (isNaN(num)) return null;
            if (match[2] === 'k') return Math.round(num * 1000);
            if (match[2] === 'm') return Math.round(num * 1_000_000);
            return Math.round(num);
          };

          const activityHints = ['today', 'yesterday', 'recent', 'recently', 'minute', 'hour', 'day'];

          const snapshots = links.map((link) => {
            const href = link.getAttribute('href') || '';
            const fullUrl = href.startsWith('http') ? href : `https://character.ai${href}`;
            const chatId = fullUrl.split('/').filter(Boolean).pop() || 'unknown';

            const text = link.innerText || '';
            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            const displayName = lines[0] || 'Unknown Character';
            const preview = lines.find((l, idx) => idx > 0 && l.length > 1) || '';

            const avatarEl = link.querySelector('img');
            const avatarUrl = avatarEl ? (avatarEl.getAttribute('src') || avatarEl.getAttribute('data-src')) : null;

            // Creator inference must be explicit; never guess.
            // Only accept exact "By @handle" (or standalone @handle) within this card.
            let creatorHandle: string | null = null;
            const cardText = link.innerText || '';
            const byMatch = cardText.match(/\bby\s+(@[A-Za-z0-9_]{2,32})\b/i);
            if (byMatch) {
              creatorHandle = byMatch[1];
            } else {
              const standalone = lines.find(l => /^@[A-Za-z0-9_]{2,32}$/.test(l));
              creatorHandle = standalone || null;
            }

            const numbersText = lines.join(' ');
            const interactionCount = parseNumber(numbersText);

            const lastActivityLabel = lines.find(l => activityHints.some(h => l.toLowerCase().includes(h))) || null;

            return {
              characterId: chatId,
              chatId,
              displayName,
              creator: creatorHandle ? { handle: creatorHandle } : null,
              avatarUrl,
              lastSeenLabel: lastActivityLabel,
              interactions: interactionCount,
              url: fullUrl,
              preview,
              tagline: preview,
              updatedAt: new Date().toISOString(),
            } as CharacterSummary;
          });

          // Deduplicate by chatId or url
          const map = new Map<string, CharacterSummary>();
          snapshots.forEach((s) => {
            if (!map.has(s.chatId)) map.set(s.chatId, s);
          });
          return Array.from(map.values());
        });

        // Sanitize text-ish fields (done outside evaluate so we can log)
        for (const snap of batch) {
          snap.displayName = this.safeText(snap.displayName, { field: 'sidebar.displayName', url: snap.url, maxLen: 120 }) || snap.displayName;
          snap.preview = this.safeText(snap.preview, { field: 'sidebar.preview', url: snap.url, maxLen: 200 }) || '';
          snap.tagline = this.safeText(snap.tagline, { field: 'sidebar.tagline', url: snap.url, maxLen: 200 });
          snap.lastSeenLabel = this.safeText(snap.lastSeenLabel, { field: 'sidebar.lastSeenLabel', url: snap.url, maxLen: 40 });

          if (snap.creator?.handle) {
            const c = this.safeText(snap.creator.handle, { field: 'sidebar.creator.handle', url: snap.url, maxLen: 40 });
            if (!c || !this.isValidHandle(c)) {
              if (this.verboseSanitizeLogs) this.log(`[sidebar] dropping invalid creator handle ${JSON.stringify(snap.creator.handle)} for ${snap.chatId}`);
              snap.creator = null;
            } else {
              snap.creator.handle = c;
            }
          }
        }

        for (const snap of batch) {
          if (!seen.has(snap.chatId)) {
            seen.set(snap.chatId, snap);
          }
        }
        
        // Attempt to scroll the last element into view to trigger lazy load
        if (elements.length > 0) {
            await elements[elements.length - 1].scrollIntoViewIfNeeded();
            await this.page.waitForTimeout(1000);
        }
    }

    return Array.from(seen.values());
  }

  async scanSidebarChatsIndex(): Promise<ChatIndexEntry[]> {
    const chars = await this.scanSidebar();
    return chars.map((s) => ({
      chatId: s.chatId,
      chatUrl: s.url,
      characterName: s.displayName,
      avatarUrl: s.avatarUrl || null,
      lastSeenLabel: s.lastSeenLabel || null,
      updatedAt: new Date().toISOString(),
    }));
  }

  private normalizeHandle(handle: string | null | undefined): string | null {
    if (!handle) return null;
    const h = handle.trim();
    if (!h) return null;
    return h.startsWith('@') ? h : `@${h}`;
  }

  async scrapeChatHeader(url: string): Promise<Partial<CharacterSummary>> {
    if (!this.page) throw new Error('Browser not launched');
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await this.page.waitForTimeout(1200);
    } catch (e) {
      this.log(`Chat header navigation failed: ${(e as Error).message}`);
    }

    const details = await this.page!.evaluate(() => {
      const text = (el: Element | null | undefined) => (el?.textContent || '').trim();
      const parseNumber = (raw?: string | null) => {
        if (!raw) return null;
        const cleaned = raw.replace(/[,\s]/g, '').toLowerCase();
        const m = cleaned.match(/([0-9.]+)(k|m)?/);
        if (!m) return null;
        const base = parseFloat(m[1]);
        if (isNaN(base)) return null;
        if (m[2] === 'k') return Math.round(base * 1000);
        if (m[2] === 'm') return Math.round(base * 1_000_000);
        return Math.round(base);
      };

      const titleEl = document.querySelector('[data-testid*="title" i], h1, h2');
      const avatarEl = document.querySelector('img[src*="cdn"], img[alt*="character" i], img[alt*="avatar" i]');
      const taglineEl = document.querySelector('[data-testid*="tagline" i], [class*="tagline" i], [class*="subtitle" i]');
      const creatorNode = Array.from(document.querySelectorAll('*')).find(el => /by\s+@/i.test(el.textContent || '')) || document.querySelector('a[href*="/profile/"]');
      const activityNode = Array.from(document.querySelectorAll('*')).find(el => /(today|yesterday|recent)/i.test(el.textContent || ''));

      let creatorHandle: string | null = null;
      let creatorDisplay: string | null = null;
      let creatorProfileUrl: string | null = null;
      let creatorAvatar: string | null = null;

      if (creatorNode) {
        const txt = text(creatorNode);
        const match = txt.match(/@[^\s•]+/);
        creatorHandle = match ? match[0] : null;
        creatorDisplay = txt.replace(/by\s+/i, '').trim() || creatorHandle;
        if ((creatorNode as HTMLAnchorElement).href) {
          creatorProfileUrl = (creatorNode as HTMLAnchorElement).href;
        }
        const img = creatorNode.querySelector('img');
        if (img) creatorAvatar = img.getAttribute('src') || img.getAttribute('data-src');
      }

      // Avoid scanning the entire body (often includes CSS/toasts); rely on local nodes only.
      const interactions = (() => {
        const candidates = [taglineEl, creatorNode, activityNode, titleEl].filter(Boolean) as Element[];
        const txt = candidates.map(c => c.textContent || '').join(' ');
        return parseNumber(txt || undefined);
      })();
      const chatId = location.pathname.split('/').filter(Boolean).pop() || 'unknown';

      return {
        displayName: text(titleEl) || null,
        avatarUrl: avatarEl ? (avatarEl.getAttribute('src') || avatarEl.getAttribute('data-src')) : null,
        tagline: text(taglineEl) || null,
        creator: creatorHandle ? {
          handle: creatorHandle,
          displayName: creatorDisplay || undefined,
          avatarUrl: creatorAvatar || undefined,
          profileUrl: creatorProfileUrl || undefined,
        } : null,
        lastSeenLabel: activityNode ? text(activityNode) : null,
        interactions,
        chatId,
        url: location.href,
      } as Partial<CharacterSummary>;
    });

    details.displayName = this.sanitizeText(details.displayName, { field: 'chatHeader.displayName', url, maxLen: 140 }) || details.displayName;
    details.tagline = this.sanitizeText(details.tagline, { field: 'chatHeader.tagline', url, maxLen: 220 });
    details.lastSeenLabel = this.sanitizeText(details.lastSeenLabel, { field: 'chatHeader.lastSeenLabel', url, maxLen: 60 });
    if (details.creator) {
      details.creator.handle = this.normalizeHandle(
        this.sanitizeText(details.creator.handle || '', { field: 'chatHeader.creator.handle', url, maxLen: 80 }) || ''
      ) || undefined;
      if (details.creator.displayName) {
        details.creator.displayName = this.sanitizeText(details.creator.displayName, { field: 'chatHeader.creator.displayName', url, maxLen: 120 }) || details.creator.displayName;
      }
      if (details.creator.profileUrl) {
        details.creator.profileUrl = this.sanitizeText(details.creator.profileUrl, { field: 'chatHeader.creator.profileUrl', url, maxLen: 300 }) || details.creator.profileUrl;
      }
    }

    return { ...details, updatedAt: new Date().toISOString() };
  }

  async hydrateCharacterEntries(entries: CharacterSummary[], options?: { limit?: number }): Promise<CharacterSummary[]> {
    const limit = options?.limit ?? entries.length;
    const result: CharacterSummary[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const needsCreator = !entry.creator?.handle;
      const needsAvatar = !entry.avatarUrl;
      const needsTagline = !entry.tagline;
      if (!needsCreator && !needsAvatar && !needsTagline) {
        result.push(entry);
        continue;
      }
      if (i >= limit) {
        result.push(entry);
        continue;
      }
      try {
        const enriched = await this.scrapeChatHeader(entry.url);
        result.push({
          ...entry,
          displayName: enriched.displayName || entry.displayName,
          avatarUrl: enriched.avatarUrl || entry.avatarUrl,
          tagline: enriched.tagline ?? entry.tagline,
          creator: enriched.creator || entry.creator || null,
          lastSeenLabel: enriched.lastSeenLabel ?? entry.lastSeenLabel,
          interactions: enriched.interactions ?? entry.interactions,
          updatedAt: enriched.updatedAt || new Date().toISOString(),
        });
      } catch (e) {
        this.log(`Chat hydration failed for ${entry.url}: ${(e as Error).message}`);
        result.push(entry);
      }
    }
    return result;
  }

  async hydrateChatsMetadata(urls: string[], options?: { limit?: number; signal?: () => boolean }): Promise<Partial<CharacterSummary>[]> {
    if (!this.page) throw new Error('Browser not launched');
    const limit = options?.limit ?? urls.length;
    const results: Partial<CharacterSummary>[] = [];
    for (let i = 0; i < urls.length; i++) {
      if (options?.signal && options.signal()) break;
      if (i >= limit) break;
      const url = urls[i];
      try {
        const enriched = await this.scrapeChatHeader(url);
        results.push({ ...enriched });
      } catch (e) {
        this.log(`Hydrate failed for ${url}: ${(e as Error).message}`);
      }
      await this.page.waitForTimeout(300);
    }
    return results;
  }

  async scrapeProfileCharacters(handle: string, sortMode: 'most_chats' | 'alphabetical' | 'most_likes' = 'most_chats'): Promise<CharacterIndexEntry[]> {
    if (!this.page) throw new Error('Browser not launched');
    const slug = handle.replace(/^@/, '');
    const url = `https://character.ai/profile/${encodeURIComponent(slug)}?tab=characters`;
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await this.page.waitForTimeout(1000);
    } catch (e) {
      this.log(`Profile navigation failed: ${(e as Error).message}`);
    }

    const entries = await this.page.evaluate((mode) => {
      const text = (el: Element | null | undefined) => (el?.textContent || '').trim();
      const parseNumber = (raw?: string | null) => {
        if (!raw) return null;
        const cleaned = raw.replace(/[,\s]/g, '').toLowerCase();
        const m = cleaned.match(/([0-9.]+)(k|m)?/);
        if (!m) return null;
        const base = parseFloat(m[1]);
        if (isNaN(base)) return null;
        if (m[2] === 'k') return Math.round(base * 1000);
        if (m[2] === 'm') return Math.round(base * 1_000_000);
        return Math.round(base);
      };

      // Optional: click sort dropdown
      const sortBtn = Array.from(document.querySelectorAll('button, div')).find(el => (el.textContent || '').toLowerCase().includes('sort')) as HTMLButtonElement | undefined;
      if (sortBtn) sortBtn.click();
      const modeLabel: Record<string, string> = { most_chats: 'Most Chats', alphabetical: 'Alphabetical', most_likes: 'Most Likes' };
      const choice = Array.from(document.querySelectorAll('li, button, div')).find(el => (el.textContent || '').toLowerCase().includes((modeLabel[mode] || '').toLowerCase()));
      if (choice) (choice as HTMLElement).click();

      const cards = Array.from(document.querySelectorAll('[href*="/chat/"]')).filter(a => (a as HTMLAnchorElement).href.includes('/chat/')) as HTMLAnchorElement[];
      const unique = new Map<string, CharacterIndexEntry>();
      cards.forEach((a) => {
        const name = text(a.querySelector('div, span, p')) || 'Unknown';
        const avatar = a.querySelector('img');
        const avatarUrl = avatar ? (avatar.getAttribute('src') || avatar.getAttribute('data-src')) : null;
        const taglineNode = Array.from(a.querySelectorAll('div, span, p')).find(el => (el.textContent || '').length > 30 && (el.textContent || '').length < 180);
        const interactions = parseNumber(a.textContent || undefined);
        const chatId = a.href.split('/').filter(Boolean).pop() || null;
        const entry: CharacterIndexEntry = {
          characterId: chatId,
          name,
          avatarUrl,
          tagline: taglineNode ? text(taglineNode) : null,
          interactions,
          creatorHandle: null,
          profileUrl: a.href,
          updatedAt: new Date().toISOString(),
        };
        if (!unique.has(a.href)) unique.set(a.href, entry);
      });
      return Array.from(unique.values());
    }, sortMode);

    // sanitize any text we store
    return entries.map((e) => ({
      ...e,
      name: this.sanitizeText(e.name, { field: 'profileCharacters.name', url, maxLen: 120 }) || e.name,
      tagline: this.sanitizeText(e.tagline, { field: 'profileCharacters.tagline', url, maxLen: 220 }),
    }));
  }

  private async scrollListUntilStable(opts: { maxRounds?: number; delayMs?: number; signal?: () => boolean }) {
    if (!this.page) throw new Error('Browser not launched');
    const maxRounds = opts.maxRounds ?? 25;
    const delayMs = opts.delayMs ?? 700;

    let lastCount = 0;
    let stagnant = 0;
    for (let round = 0; round < maxRounds; round++) {
      if (opts.signal && opts.signal()) break;

      const res = await this.page.evaluate(() => {
        const pickScrollable = (): HTMLElement | null => {
          const candidates = Array.from(document.querySelectorAll('main *')) as HTMLElement[];
          const scrollables = candidates.filter(el => el.scrollHeight > el.clientHeight + 40);
          scrollables.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
          return scrollables[0] || null;
        };

        const container = pickScrollable();
        const anchorCount = Array.from(document.querySelectorAll('main a[href]')).length;
        const cardCount = Array.from(document.querySelectorAll('main [role="listitem"], main article, main [data-testid*="card" i]')).length;
        const before = container ? container.scrollTop : window.scrollY;
        if (container) {
          container.scrollTop = container.scrollHeight;
        } else {
          window.scrollTo(0, document.body.scrollHeight);
        }
        return { anchorCount, cardCount, before, hasContainer: !!container };
      });

      const count = Math.max(res.anchorCount, res.cardCount);
      if (count <= lastCount) stagnant++;
      else stagnant = 0;
      lastCount = count;

      if (stagnant >= 3) break;
      await this.page.waitForTimeout(delayMs);
    }
  }

  async indexProfileTab(
    tab: 'personas' | 'voices',
    opts?: { maxItems?: number; signal?: () => boolean }
  ): Promise<PersonaSummary[] | VoiceSummary[]> {
    if (!this.page) throw new Error('Browser not launched');
    const viewer = await this.scrapeViewerProfile().catch(() => null);
    if (!viewer?.handle) throw new Error('Viewer handle unknown; refresh viewer first');
    const slug = viewer.handle.replace(/^@/, '');

    // NOTE: The exact tab query can change; we only use GET navigation and DOM scrape.
    const url = `https://character.ai/profile/${encodeURIComponent(slug)}?tab=${encodeURIComponent(tab)}`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await this.page.waitForTimeout(800);

    await this.scrollListUntilStable({ maxRounds: 30, delayMs: 800, signal: opts?.signal });

    const raw = await this.page.evaluate((tabName) => {
      const normalizeWs = (s: string) => s.replace(/\r\n/g, '\n').replace(/[\u00a0\t\f\v]/g, ' ').replace(/\s+/g, ' ').trim();
      const main = document.querySelector('main') || document.body;

      const cards: HTMLElement[] = Array.from(
        main.querySelectorAll('[role="listitem"], article, [data-testid*="card" i], [class*="card" i]')
      ) as HTMLElement[];

      const seen = new Set<string>();
      const entries: any[] = [];

      for (const card of cards) {
        const text = normalizeWs(card.innerText || card.textContent || '');
        if (!text) continue;

        const titleEl = (card.querySelector('h3') || card.querySelector('h2') || card.querySelector('h4')) as HTMLElement | null;
        const title = normalizeWs(titleEl?.textContent || '') || normalizeWs(text.split('\n')[0] || '');
        if (!title) continue;

        let desc: string | null = null;
        const lines = (card.innerText || '').split('\n').map(l => normalizeWs(l)).filter(Boolean);
        if (lines.length > 1) desc = lines.slice(1).join(' • ').slice(0, 240);

        const img = card.querySelector('img') as HTMLImageElement | null;
        const avatarUrl = img ? (img.getAttribute('src') || img.getAttribute('data-src')) : null;

        // A stable-ish id from title+first 32 chars of description (no crypto API usage)
        const id = `${tabName}:${title}:${(desc || '').slice(0, 32)}`;
        if (seen.has(id)) continue;
        seen.add(id);

        if (tabName === 'voices') {
          entries.push({ id, displayName: title, description: desc || null });
        } else {
          entries.push({ id, displayName: title, description: desc || null, avatarUrl: avatarUrl || null });
        }
      }

      return entries;
    }, tab);

    const maxItems = opts?.maxItems ?? 500;
    if (tab === 'personas') {
      const out: PersonaSummary[] = [];
      for (const e of (raw as any[]).slice(0, maxItems)) {
        const displayName = this.safeText(e.displayName, { field: 'personas.displayName', url, maxLen: 120 });
        if (!displayName) continue;
        out.push({
          id: String(e.id || `personas:${displayName}`),
          displayName,
          description: this.safeText(e.description, { field: 'personas.description', url, maxLen: 240 }),
          avatarUrl: this.safeText(e.avatarUrl, { field: 'personas.avatarUrl', url, maxLen: 300 }),
        });
      }
      return out;
    }

    const out: VoiceSummary[] = [];
    for (const e of (raw as any[]).slice(0, maxItems)) {
      const displayName = this.safeText(e.displayName, { field: 'voices.displayName', url, maxLen: 120 });
      if (!displayName) continue;
      out.push({
        id: String(e.id || `voices:${displayName}`),
        displayName,
        description: this.safeText(e.description, { field: 'voices.description', url, maxLen: 240 }),
      });
    }
    return out;
  }

  // DOM-only profile scrape (no API calls) to hydrate the logged-in viewer
  async scrapeViewerProfile(): Promise<ViewerProfile | null> {
    if (!this.page) throw new Error("Browser not launched");
    const page = this.page;

    const debug = (msg: string) => {
      // Use the existing verbose flag as a lightweight debug-level toggle.
      if (this.verboseSanitizeLogs) this.log(msg);
    };

    const strictHandleFromSlug = (slug: string | null | undefined): string | null => {
      if (!slug) return null;
      const s = slug.trim().replace(/^@/, '');
      if (!s) return null;
      const candidate = `@${s}`;
      return this.isValidHandle(candidate) ? candidate : null;
    };

    const slugFromProfileUrl = (u: string | null | undefined): string | null => {
      if (!u) return null;
      const m = u.match(/\/profile\/([^/?#]+)/i);
      return m?.[1] ? decodeURIComponent(m[1]) : null;
    };

    // Phase 1: go to home, but do not use any global creator/profile links.
    await page.goto('https://character.ai/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(600);

    // quick login check (best-effort)
    const loggedIn = await page.evaluate(() => {
      const loginCues = ['log in', 'sign in', 'login'];
      const hasLoginCTA = Array.from(document.querySelectorAll('a,button')).some(el => {
        const txt = (el.textContent || '').toLowerCase();
        return loginCues.some(c => txt.includes(c));
      });
      return !hasLoginCTA;
    });
    if (!loggedIn) {
      this.log('Viewer scrape: appears logged out (login CTA present).');
      return null;
    }

    // Try to discover viewer profile URL from *top navigation area only* (avoid matching creator links in content).
    const navProfileHref = await page.evaluate(() => {
      const candidates = [
        document.querySelector('header') as HTMLElement | null,
        document.querySelector('nav') as HTMLElement | null,
        document.querySelector('[role="banner"]') as HTMLElement | null,
      ].filter(Boolean) as HTMLElement[];

      const root = candidates[0] || document.body;
      const anchors = Array.from(root.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      const profileAnchor = anchors.find(a => {
        const href = a.getAttribute('href') || '';
        return /\/(profile|user)\//i.test(href);
      });

      const href = profileAnchor?.getAttribute('href') || null;
      if (!href) return null;
      return href.startsWith('http') ? href : `https://character.ai${href}`;
    });

    const handleFromNavHref = strictHandleFromSlug(slugFromProfileUrl(navProfileHref));
    if (handleFromNavHref) debug(`[viewer] handle candidate from nav href: ${handleFromNavHref}`);

    // Navigate to profile page if we found it.
    if (navProfileHref) {
      await page.goto(navProfileHref, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(700);
    }

    // Phase 1 (core): profile page header-scoped scrape
    const scraped = await page.evaluate(() => {
      const normalizeWs = (s: string) => s.replace(/\r\n/g, '\n').replace(/[\u00a0\t\f\v]/g, ' ').replace(/\s+/g, ' ').trim();
      const header =
        (document.querySelector('main header') as HTMLElement | null)
        || (document.querySelector('[class*="profile" i][class*="header" i]') as HTMLElement | null)
        || (document.querySelector('header') as HTMLElement | null)
        || (document.querySelector('main') as HTMLElement | null)
        || document.body;

      const headerText = normalizeWs(header.innerText || header.textContent || '');

      const handleMatch = headerText.match(/@[A-Za-z0-9_]{2,32}/);
      const handleFromHeader = handleMatch ? handleMatch[0] : null;

      // Also try to find a profile link in the header/banner area.
      const anchors = Array.from(header.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      const profileHref = anchors.find(a => /\/profile\//i.test(a.getAttribute('href') || ''))?.getAttribute('href') || null;
      const profileUrl = profileHref ? (profileHref.startsWith('http') ? profileHref : `https://character.ai${profileHref}`) : null;

      // Best-effort display name: prefer h1/h2 within header
      const titleEl = (header.querySelector('h1') || header.querySelector('h2')) as HTMLElement | null;
      let displayName = titleEl ? normalizeWs(titleEl.textContent || '') : null;
      if (!displayName) {
        // fallback: first non-handle-ish line
        const lines = (header.innerText || '').split('\n').map(l => normalizeWs(l)).filter(Boolean);
        const firstGood = lines.find(l => !/^@[A-Za-z0-9_]{2,32}$/.test(l) && l.length > 1) || null;
        displayName = firstGood;
      }

      // Avatar: pick first image inside header with a src.
      const imgs = Array.from(header.querySelectorAll('img')) as HTMLImageElement[];
      const avatarEl = imgs.find(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (!src) return false;
        const w = (img as any).naturalWidth || img.width || 0;
        const h = (img as any).naturalHeight || img.height || 0;
        // Don't require size, but prefer non-tiny
        return w === 0 || h === 0 ? true : (w >= 32 && h >= 32);
      }) || null;
      const avatar = avatarEl ? (avatarEl.getAttribute('src') || avatarEl.getAttribute('data-src')) : null;

      // Stats: parse from header text only (no global scanning)
      const parseCompact = (label: string): number | null => {
        const re = new RegExp(`([0-9.,]+\\s*[kKmM]?)\\s*${label}`, 'i');
        const m = headerText.match(re);
        return m ? m[1].trim() as any : null;
      };

      return {
        headerText,
        handleFromHeader,
        displayName,
        avatar,
        followersText: parseCompact('followers?'),
        followingText: parseCompact('following'),
        interactionsText: parseCompact('interactions?'),
        profileUrl,
        url: location.href,
      };
    });

    // Handle extraction precedence (STRICT):
    // 1) canonical slug from current URL if on /profile/<slug>
    // 2) slug from header/profile link href
    // 3) slug from nav/header discovered profile href
    // 4) explicit @handle text in header
    // NEVER derive from displayName.
    const handleFromCurrentUrl = strictHandleFromSlug(page.url().match(/\/profile\/([^/?#]+)/i)?.[1] || null);
    const handleFromHeaderHref = strictHandleFromSlug(slugFromProfileUrl((scraped as any).profileUrl || null));
    const handleFromHeaderText = this.isValidHandle(scraped.handleFromHeader || '') ? (scraped.handleFromHeader as string) : null;

    const handleCandidate = handleFromCurrentUrl || handleFromHeaderHref || handleFromNavHref || handleFromHeaderText;
    if (!handleCandidate) {
      debug(`[viewer] handle rejected. candidates: url=${handleFromCurrentUrl || 'null'} headerHref=${handleFromHeaderHref || 'null'} navHref=${handleFromNavHref || 'null'} headerText=${handleFromHeaderText || 'null'}`);
    } else {
      debug(`[viewer] handle chosen: ${handleCandidate} (url=${handleFromCurrentUrl ? 'Y' : 'N'}, headerHref=${handleFromHeaderHref ? 'Y' : 'N'}, navHref=${handleFromNavHref ? 'Y' : 'N'}, headerText=${handleFromHeaderText ? 'Y' : 'N'})`);
    }

    const handle = handleCandidate && this.isValidHandle(handleCandidate) ? handleCandidate : null;

    if (!handle) {
      this.log('Viewer scrape failed: could not extract a valid @handle from profile header/url');
      return null;
    }

    const displayName = this.safeText(scraped.displayName, { field: 'viewer.displayName', url: scraped.url, maxLen: 120 });
    const avatarUrl = this.safeText(scraped.avatar, { field: 'viewer.avatarUrl', url: scraped.url, maxLen: 300 });

    const followers = this.parseCompactNumber(this.safeText(scraped.followersText, { field: 'viewer.followers', url: scraped.url, maxLen: 30 }));
    const following = this.parseCompactNumber(this.safeText(scraped.followingText, { field: 'viewer.following', url: scraped.url, maxLen: 30 }));
    const interactions = this.parseCompactNumber(this.safeText(scraped.interactionsText, { field: 'viewer.interactions', url: scraped.url, maxLen: 30 }));

    if (!displayName) {
      this.log('Viewer scrape failed: missing displayName in profile header');
      return null;
    }

    const viewer: ViewerProfile = {
      handle,
      displayName,
      avatarUrl: avatarUrl || null,
      followers: followers ?? null,
      following: following ?? null,
      interactions: interactions ?? null,
      profileUrl: scraped.url || page.url(),
      updatedAt: new Date().toISOString(),
      source: 'dom',
    };

    return viewer;
  }

  async getUserProfile(): Promise<ViewerProfile | null> {
    return this.scrapeViewerProfile();
  }

  async getCreatorProfile(username: string): Promise<CreatorProfile | null> {
    if (!this.browserContext) throw new Error("Browser not launched");
    const page = await this.browserContext.newPage();
    try {
      await page.goto(`https://character.ai/profile/${encodeURIComponent(username)}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(500);
      const profile = await page.evaluate(() => {
        const textContent = (el: Element | null | undefined) => (el?.textContent || '').trim();
        const avatarEl = document.querySelector('img[src*="cdn"], img[alt*="avatar" i]');
        const usernameEl = document.querySelector('[data-testid*="username" i], [class*="username" i], h1, h2');
        const username = textContent(usernameEl) || null;

        const numberFromLabel = (label: string) => {
          const el = Array.from(document.querySelectorAll('*')).find(e => (e.textContent || '').toLowerCase().includes(label));
          if (!el) return null;
          const numText = (el.textContent || '').match(/([0-9,.kK]+)\s*/);
          if (!numText) return null;
          const cleaned = numText[1].replace(/[,\s]/g, '').toLowerCase();
          const m = cleaned.match(/([0-9.]+)(k|m)?/);
          if (!m) return null;
          const base = parseFloat(m[1]);
          if (isNaN(base)) return null;
          if (m[2] === 'k') return Math.round(base * 1000);
          if (m[2] === 'm') return Math.round(base * 1_000_000);
          return Math.round(base);
        };

        const followers = numberFromLabel('follower');
        const following = numberFromLabel('following');
        const interactions = numberFromLabel('interaction') || numberFromLabel('message');

        if (!username) return null;
        return {
          username: username.replace(/^@/, ''),
          avatarUrl: avatarEl ? (avatarEl.getAttribute('src') || avatarEl.getAttribute('data-src')) : null,
          followers: followers ?? null,
          following: following ?? null,
          interactions: interactions ?? null,
          fetchedAt: new Date().toISOString(),
        } as CreatorProfile;
      });
      if (!profile) return null;
      // sanitize minimal fields (username is used as a slug)
      const safeUsername = this.sanitizeText(profile.username, { field: 'creatorProfile.username', url: `https://character.ai/profile/${encodeURIComponent(username)}`, maxLen: 80 });
      return {
        ...profile,
        username: (safeUsername || profile.username).replace(/^@/, ''),
      };
    } catch (e) {
      this.log(`Creator profile fetch failed for ${username}: ${(e as Error).message}`);
      return null;
    } finally {
      await page.close().catch(() => {});
    }
  }

  async scrapeChat(url: string, options?: { reverseTranscript?: boolean }): Promise<ScrapedMessage[]> {
    if (!this.page) throw new Error("Browser not launched");
    this.log(`Navigating to ${url}...`);
    await this.page.goto(url);
    await this.page.waitForTimeout(3000); // Wait for app hydration

    this.log("Starting scroll-to-top sequence (fingerprint-based)...");

    const seenFingerprints = new Set<string>();
    let stagnantCycles = 0;
    let cycle = 0;
    const maxCycles = 200; // safety cap

    // Temporary network logger for pagination signals
    let cycleNetworkHit = false;
    const responseHandler = (resp: any) => {
      const url = resp.url();
      if (/graphql|conversation|message/i.test(url)) {
        this.log(`[net] ${resp.status()} ${url}`);
        cycleNetworkHit = true;
      }
    };
    this.page.on('response', responseHandler);

    while (stagnantCycles < 5 && cycle < maxCycles) {
      cycleNetworkHit = false;

      // Focus main chat container and trigger pagination keys
      try {
        await this.page.click('main', { timeout: 1000 });
      } catch (e) {
        // best-effort
      }
      for (let i = 0; i < 3; i++) {
        await this.page.keyboard.press('PageUp');
        await this.page.waitForTimeout(200);
      }

      // Scroll bounce: top then a small down to poke virtualization
      await this.page.evaluate(() => {
        const scrollable = Array.from(document.querySelectorAll('div')).find(d => d.scrollHeight > d.clientHeight + 20);
        if (scrollable) {
          (scrollable as HTMLElement).scrollTop = 0;
          (scrollable as HTMLElement).scrollTop = 40;
        } else {
          window.scrollTo(0, 0);
          window.scrollTo(0, 40);
        }
      });

      // Gather message fingerprints using the same container/message heuristics as extraction
      const fingerprints = await this.page.evaluate(() => {
        const containerCandidates = [
          { name: 'main-role-log', selector: 'main [role="log"]', priority: 3 },
          { name: 'main-role-feed', selector: 'main [role="feed"]', priority: 3 },
          { name: 'main-aria-message', selector: 'main [aria-label*="message" i]', priority: 2 },
          { name: 'main', selector: 'main', priority: 1 },
        ];
        const messageSelectors = [
          { name: 'article', selector: 'article' },
          { name: 'role-article', selector: '[role="article"]' },
          { name: 'role-listitem', selector: '[role="listitem"]' },
          { name: 'div-has-more', selector: 'div:has(button[aria-label*="more" i])' },
        ];

        const cleanText = (text: string) => {
          const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          const junk = /^(Copy|Report|Share|Like|Reply|Menu|More)$/i;
          const kept = lines.filter(l => !junk.test(l) && l.length > 1);
          return kept.join('\n').trim();
        };

        const containerResults = containerCandidates.map(c => {
          const root = document.querySelector(c.selector);
          const messageCounts = messageSelectors.map(ms => {
            const nodes = root ? Array.from(root.querySelectorAll(ms.selector)) : [];
            return { selector: ms.selector, name: ms.name, count: nodes.length };
          });
          const total = messageCounts.reduce((sum, m) => sum + m.count, 0);
          return { container: c.selector, containerName: c.name, priority: c.priority, total };
        });

        const bestContainer = containerResults
          .filter(r => r.total > 0)
          .sort((a, b) => b.priority - a.priority || b.total - a.total)[0] || containerResults[0];

        const root = bestContainer?.container ? document.querySelector(bestContainer.container) : document;
        const bestMessageSelector = messageSelectors
          .map(ms => ({
            selector: ms.selector,
            name: ms.name,
            nodes: root ? Array.from(root.querySelectorAll(ms.selector)) : [],
          }))
          .sort((a, b) => b.nodes.length - a.nodes.length)[0];

        const nodes = bestMessageSelector ? bestMessageSelector.nodes : [];

        const inferRole = (el: Element): 'user' | 'char' => {
          const dataset = (el as HTMLElement).dataset;
          if (dataset['isUser'] === 'true' || dataset['author'] === 'user') return 'user';
          const text = el.textContent || '';
          if (/\bYou\b/i.test(text)) return 'user';
          const style = window.getComputedStyle(el as HTMLElement);
          if (style.textAlign === 'right') return 'user';
          if (style.justifyContent?.includes('flex-end')) return 'user';
          return 'char';
        };

        const fps = nodes.map(el => {
          const text = cleanText((el as HTMLElement).innerText).slice(0, 200);
          const role = inferRole(el);
          return `${role}::${text}`;
        }).filter(Boolean);

        return fps;
      });

      let newThisCycle = 0;
      for (const fp of fingerprints) {
        if (!seenFingerprints.has(fp)) {
          seenFingerprints.add(fp);
          newThisCycle++;
        }
      }

      if (newThisCycle === 0) {
        if (cycleNetworkHit) {
          stagnantCycles = 0; // consider pagination attempt successful due to network activity
        } else {
          stagnantCycles++;
        }
      } else {
        stagnantCycles = 0;
      }

      this.log(`Scroll cycle ${cycle + 1}: totalSeen=${seenFingerprints.size}, newThisCycle=${newThisCycle}, netHit=${cycleNetworkHit}, stagnantCycles=${stagnantCycles}`);

      if (stagnantCycles >= 5) break;

      // Scroll to top and wait
      await this.page.evaluate(() => {
        const scrollable = Array.from(document.querySelectorAll('div')).find(d => d.scrollHeight > d.clientHeight + 20);
        if (scrollable) {
          (scrollable as HTMLElement).scrollTop = 0;
        } else {
          window.scrollTo(0, 0);
        }
      });

      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(1200); // debounce 1000–1500ms

      cycle++;
    }

    this.page.off('response', responseHandler);

    this.log("Extracting message content...");
    
    const extraction = await this.page.evaluate(() => {
      const containerCandidates = [
        { name: 'main-role-log', selector: 'main [role="log"]', priority: 3 },
        { name: 'main-role-feed', selector: 'main [role="feed"]', priority: 3 },
        { name: 'main-aria-message', selector: 'main [aria-label*="message" i]', priority: 2 },
        { name: 'main', selector: 'main', priority: 1 },
      ];

      const messageSelectors = [
        { name: 'article', selector: 'article' },
        { name: 'role-article', selector: '[role="article"]' },
        { name: 'role-listitem', selector: '[role="listitem"]' },
        { name: 'div-has-more', selector: 'div:has(button[aria-label*="more" i])' },
      ];

      const cleanText = (text: string) => {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const junk = /^(Copy|Report|Share|Like|Reply|Menu|More)$/i;
        const kept = lines.filter(l => !junk.test(l) && l.length > 1);
        return kept.join('\n').trim();
      };

      const inferRole = (el: Element): 'user' | 'char' => {
        const dataset = (el as HTMLElement).dataset;
        if (dataset['isUser'] === 'true' || dataset['author'] === 'user') return 'user';
        const text = el.textContent || '';
        if (/\bYou\b/i.test(text)) return 'user';
        const style = window.getComputedStyle(el as HTMLElement);
        if (style.textAlign === 'right') return 'user';
        if (style.justifyContent?.includes('flex-end')) return 'user';
        return 'char';
      };

      const containerResults = containerCandidates.map(c => {
        const root = document.querySelector(c.selector);
        const messageCounts = messageSelectors.map(ms => {
          const nodes = root ? Array.from(root.querySelectorAll(ms.selector)) : [];
          const sampleTexts = nodes.slice(0, 2).map(n => cleanText((n as HTMLElement).innerText)).filter(Boolean);
          return { selector: ms.selector, name: ms.name, count: nodes.length, sampleTexts };
        });
        const total = messageCounts.reduce((sum, m) => sum + m.count, 0);
        return { container: c.selector, containerName: c.name, priority: c.priority, total, messageCounts, outerHTML: root?.outerHTML || '' };
      });

      const bestContainer = containerResults
        .filter(r => r.total > 0)
        .sort((a, b) => b.priority - a.priority || b.total - a.total)[0] || containerResults[0];

      const chosenContainerSelector = bestContainer?.container || null;
      const root = chosenContainerSelector ? document.querySelector(chosenContainerSelector) : document;

      const bestMessageSelector = (bestContainer?.messageCounts || [])
        .slice()
        .sort((a, b) => b.count - a.count)[0];

      const chosenMessageSelector = bestMessageSelector?.selector || messageSelectors[0].selector;
      const nodes = Array.from(root ? root.querySelectorAll(chosenMessageSelector) : []);

      const messages = nodes.map((el, idx) => {
        const textRaw = (el as HTMLElement).innerText;
        const text = cleanText(textRaw);
        return {
          turn_index: idx,
          role: inferRole(el),
          text,
          html: (el as HTMLElement).innerHTML,
          top: (el as HTMLElement).getBoundingClientRect().top,
        };
      }).filter(m => m.text && m.text.trim().length > 1);

      // Deduplicate consecutive duplicates (virtualized reuse)
      const deduped: typeof messages = [];
      for (const msg of messages) {
        const last = deduped[deduped.length - 1];
        if (last && last.text === msg.text && last.role === msg.role) continue;
        deduped.push(msg);
      }

      // Order heuristic: if top coordinate decreases (newest-first), reverse
      let ordered = deduped;
      if (deduped.length >= 2) {
        const firstTop = deduped[0].top;
        const lastTop = deduped[deduped.length - 1].top;
        if (lastTop < firstTop) {
          ordered = [...deduped].reverse();
        }
      }

      const containerSnippet = (bestContainer?.outerHTML || '').slice(0, 500);

      return {
        chosenContainer: chosenContainerSelector,
        chosenMessageSelector,
        containerResults,
        messages: ordered.map((m, i) => ({
          turn_index: i,
          role: m.role,
          text: m.text,
          html: m.html,
        })),
        containerSnippet,
      };
    });

    let messages = extraction.messages as ScrapedMessage[];
    if (options?.reverseTranscript) {
      messages = [...messages].reverse().map((m, idx) => ({ ...m, turn_index: idx }));
    }

    if (messages.length === 0) {
      this.log(`Extracted 0 messages. Container snippet: ${extraction.containerSnippet}`);
      this.log(`Selector counts: ${JSON.stringify(extraction.containerResults?.map((r: any) => ({ container: r.containerName, total: r.total, counts: r.messageCounts.map((m: any) => ({ name: m.name, count: m.count })) })), null, 2)}`);
    } else {
      this.log(`Extracted ${messages.length} messages.`);
    }
    return messages;
  }

  async testSelectors(): Promise<any> {
    if (!this.page) throw new Error("Browser not launched");
    const diagnostics = await this.page.evaluate(() => {
      const url = location.href;
      const containerCandidates = [
        { name: 'main-role-log', selector: 'main [role="log"]', priority: 3 },
        { name: 'main-role-feed', selector: 'main [role="feed"]', priority: 3 },
        { name: 'main-aria-message', selector: 'main [aria-label*="message" i]', priority: 2 },
        { name: 'main', selector: 'main', priority: 1 },
      ];
      const messageSelectors = [
        { name: 'article', selector: 'article' },
        { name: 'role-article', selector: '[role="article"]' },
        { name: 'role-listitem', selector: '[role="listitem"]' },
        { name: 'div-has-more', selector: 'div:has(button[aria-label*="more" i])' },
      ];

      const cleanText = (text: string) => {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const junk = /^(Copy|Report|Share|Like|Reply|Menu|More)$/i;
        const kept = lines.filter(l => !junk.test(l) && l.length > 1);
        return kept.join('\n').trim();
      };

      const results = containerCandidates.map(c => {
        const root = document.querySelector(c.selector);
        const messageCounts = messageSelectors.map(ms => {
          const nodes = root ? Array.from(root.querySelectorAll(ms.selector)) : [];
          const sampleTexts = nodes.slice(0, 2).map(n => cleanText((n as HTMLElement).innerText)).filter(Boolean);
          return { messageSelector: ms.selector, messageName: ms.name, count: nodes.length, sampleTexts };
        });
        const total = messageCounts.reduce((sum, m) => sum + m.count, 0);
        return { container: c.selector, containerName: c.name, total, priority: c.priority, messageCounts };
      });

      const chosen = results.filter(r => r.total > 0).sort((a, b) => b.priority - a.priority || b.total - a.total)[0] || results[0];

      const scrollCandidates = Array.from(document.querySelectorAll('div')).slice(0, 200).map((el, idx) => {
        const rect = el.getBoundingClientRect();
        const scrollable = el.scrollHeight > el.clientHeight + 20;
        return scrollable ? { idx, height: el.scrollHeight, visibleHeight: el.clientHeight } : null;
      }).filter(Boolean);

      const selectedScroll = scrollCandidates.reduce<{ idx: number; height: number; visibleHeight: number } | null>((best, curr: any) => {
        if (!curr) return best;
        if (!best || curr.height > best.height) return curr;
        return best;
      }, null);

      const sidebarLinks = Array.from(document.querySelectorAll('a[href*="/chat/"]')).length;

      return { url, selectorResults: results, chosenContainer: chosen?.container, scrollCandidates, selectedScroll, sidebarLinks };
    });

    this.log(`Selector test: ${JSON.stringify(diagnostics, null, 2)}`);
    return diagnostics;
  }
}
