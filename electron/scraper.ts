import { chromium, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';

export interface ChatItem {
  name: string;
  url: string;
  preview: string;
}

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

  constructor(userDataDir: string, logCallback: (msg: string) => void, cacheDir?: string) {
    this.userDataDir = userDataDir;
    this.cacheDir = cacheDir || path.join(userDataDir, 'cache');
    this.logCallback = logCallback;
  }

  private log(msg: string) {
    console.log(`[Scraper] ${msg}`);
    this.logCallback(msg);
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

  async scanSidebar(): Promise<ChatItem[]> {
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
    
    const chats = new Map<string, ChatItem>();
    
    for (let i = 0; i < 3; i++) { // Try scrolling a few times
        const elements = await this.page.$$('a[href*="/chat/"]');
        this.log(`Found ${elements.length} potential chat links (Pass ${i+1})...`);
        
        for (const el of elements) {
            const href = await el.getAttribute('href');
            if (!href) continue;
            
            const fullUrl = href.startsWith('http') ? href : `https://character.ai${href}`;
            const text = await el.innerText();
            const lines = text.split('\n').filter(l => l.trim().length > 0);
            const name = lines[0] || "Unknown Character";
            const preview = lines[1] || "";
            
            if (!chats.has(fullUrl)) {
                chats.set(fullUrl, { name, url: fullUrl, preview });
            }
        }
        
        // Attempt to scroll the last element into view to trigger lazy load
        if (elements.length > 0) {
            await elements[elements.length - 1].scrollIntoViewIfNeeded();
            await this.page.waitForTimeout(1000);
        }
    }

    return Array.from(chats.values());
  }

  async scrapeChat(url: string, options?: { reverseTranscript?: boolean }): Promise<ScrapedMessage[]> {
    if (!this.page) throw new Error("Browser not launched");
    this.log(`Navigating to ${url}...`);
    await this.page.goto(url);
    await this.page.waitForTimeout(3000); // Wait for app hydration

    this.log("Starting scroll-to-top sequence...");
    
    // SCROLL LOGIC
    // We look for the main message container. Usually has 'overflow-y-auto' or similar.
    // Or we simply use window scroll if it's body-scroll (mobile view emulation).
    // CAI often puts messages in a container.
    
    // Robust strategy: Find the scrollable parent of the last message
    const lastMessage = this.page.locator('[data-testid="message-row"]').last();
    // This is a heuristic. If data-testid fails, we might need manual selector adjustment.
    
    let noNewMessagesCount = 0;
    let previousMsgCount = 0;

    for (let i = 0; i < 50; i++) { // Max 50 scrolls safety cap
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

        // Action: Scroll to top of the message container
        // We try to evaluate the scrolling on the container found by selector
        // CAI class names are hashed. We look for the container holding the rows.
        await this.page.evaluate(() => {
            // Best effort: Try to find the element with scrollbar
            const allDivs = Array.from(document.querySelectorAll('div'));
            // Filter for divs that have scrollable content
            const scrollable = allDivs.find(d => d.scrollHeight > d.clientHeight && d.scrollTop > 0);
            if (scrollable) {
                scrollable.scrollTop = 0;
            } else {
                window.scrollTo(0,0);
            }
        });
        
        await this.page.waitForTimeout(1500); // Wait for network load
    }

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
