import { chromium, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { CharacterSummary, CreatorProfile, ViewerProfile, CharacterIndexEntry, ChatIndexEntry, PersonaSummary, VoiceSummary } from '../types';
import { QAEngine, QAReport, QAContext } from './qa';

export interface ScrapedMessage {
  turn_index: number;
  role: 'user' | 'char';
  text: string;
}

export interface ScraperDiagnostics {
  chosenContainer?: string;
  chosenMessageSelector?: string;
  containerResults?: any[];
  messageCount: number;
  durationMs: number;
}

export class ScraperEngine {
  private browserContext: BrowserContext | null = null;
  private page: Page | null = null;
  private userDataDir: string;
  private cacheDir: string;
  private logCallback: (msg: string) => void;
  private verboseSanitizeLogs: boolean;
  private interceptedMessages: any[] = [];
  private manualScrollHandler: (() => Promise<boolean>) | null = null;
  private qaEngine: QAEngine;

  constructor(userDataDir: string, logCallback: (msg: string) => void, cacheDir?: string) {
    this.userDataDir = userDataDir;
    this.cacheDir = cacheDir || path.join(userDataDir, 'cache');
    this.logCallback = logCallback;
    this.verboseSanitizeLogs = /^(1|true|yes|on)$/i.test(process.env.CAI_DUMPER_VERBOSE_SANITIZE || '');
    this.qaEngine = new QAEngine();
  }

  private buildQAContext(): QAContext {
    return {
      page: this.page,
      interceptedMessagesCount: this.interceptedMessages.length,
      log: (msg: string) => this.log(msg)
    };
  }

  public setManualScrollHandler(handler: () => Promise<boolean>) {
    this.manualScrollHandler = handler;
  }

  public isLaunched(): boolean {
    return this.page !== null;
  }

  private log(msg: string) {
    console.log(`[Scraper] ${msg}`);
    this.logCallback(msg);
  }

  private sanitizeText(raw: unknown, ctx: { field: string; url?: string; maxLen?: number }): string | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string') return null;
    let s = raw.replace(/\r\n/g, '\n').replace(/[\t\f\v]/g, ' ').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const maxLen = ctx.maxLen ?? 300;
    return s.length > maxLen ? s.slice(0, maxLen).trim() : s;
  }

  private isValidHandle(handle: string | null | undefined): handle is string {
    if (!handle) return false;
    // Updated regex to allow hyphens and periods, which are valid in c.ai handles
    return /^@[A-Za-z0-9_.-]{2,64}$/.test(handle.trim());
  }

  private normalizeHandle(handle: string | null | undefined): string | null {
    if (!handle) return null;
    const h = handle.trim();
    return h ? (h.startsWith('@') ? h : `@${h}`) : null;
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

  async launch(cdpEndpoint?: string) {
    this.log("Initializing browser connection...");
    
    if (cdpEndpoint) {
      // Connect to existing browser session (BrowserView) for network interception
      this.log(`Connecting to browser at ${cdpEndpoint}...`);
      try {
        const browser = await chromium.connectOverCDP(cdpEndpoint);
        this.browserContext = browser.contexts()[0] || await browser.newContext();
        const pages = this.browserContext.pages();
        this.page = pages[0] || await this.browserContext.newPage();
        this.setupNetworkInterception(this.page);
        this.log("Connected to existing browser session for interception.");
        return;
      } catch (err: any) {
        this.log(`Failed to connect to existing browser: ${err.message}`);
        // Fall back to launching dedicated browser
      }
    }
    
    // Launch dedicated browser instance for scraping
    this.log("Launching dedicated Chromium instance for scraping...");
    try {
      if (!fs.existsSync(this.userDataDir)) fs.mkdirSync(this.userDataDir, { recursive: true });
      if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });

      this.browserContext = await chromium.launchPersistentContext(this.userDataDir, {
        headless: true, // Run headless for scraping
        viewport: null,
        args: [
          '--disable-blink-features=AutomationControlled',
          `--disk-cache-dir=${this.cacheDir}`,
          '--disable-gpu-cache',
          '--no-sandbox',
          '--disable-dev-shm-usage'
        ],
      });
      
      this.page = await this.browserContext.newPage();
      await this.page.goto('https://character.ai');
      this.setupNetworkInterception(this.page);
      this.log("Dedicated scraping browser ready.");
      
      return;
    } catch (err: any) {
      this.log(`Failed to launch dedicated browser: ${err.message}`);
      throw err;
    }
  }

  private async setupNetworkInterception(page: Page) {
      this.log("Setting up network interception for c.ai API calls...");

      page.on('response', async (response) => {
          const url = response.url();

          // Log ONLY important c.ai API calls, not static assets
          if (url.includes('character.ai') || url.includes('c.ai')) {
              // Skip static assets and common requests
              if (url.includes('/_next/static/') ||
                  url.includes('.woff') ||
                  url.includes('.css') ||
                  url.includes('/chunks/') ||
                  url.includes('/media/') ||
                  url.includes('/ping') ||
                  url.includes('/rum?') ||
                  url.includes('/events.')) {
                  return;
              }

              this.log(`[Network] ${response.status()} ${response.request().method()} ${url.replace('https://', '').replace('http://', '')}`);
          }

          // Intercept Character Details - expanded patterns
          if (url.includes('/chat/character/') || url.includes('/c.ai/character/') ||
              url.includes('/api/trpc/character.info') || url.includes('/character/info') ||
              url.includes('/get_character_info')) {
              try {
                  const json = await response.json();
                  this.log(`[Metadata] Character API response intercepted`);
                  console.log(`[Metadata] Character data:`, json);

                  // Handle different response structures
                  const char = json.character || json?.result?.data?.json?.character || json?.data?.character || json;
                  if (char && (char.name || char.title || char.external_id)) {
                      this.log(`[Metadata] [OK] Character: ${char.name || char.title || 'Unknown'} | Model: ${char.model_type || 'Default'} | Voice: ${char.voice_id || 'None'}`);
                  }
              } catch (e: any) {
                  const msg = e.message || String(e);
                  if (msg.includes('No resource with given identifier') || msg.includes('Network.getResponseBody')) {
                      // Common transient error when request body is collected before we can read it
                      this.log(`[Metadata] [Warn] Could not retrieve response body (timing issue): ${msg.split('\n')[0]}`);
                  } else {
                      this.log(`[Metadata] [FAIL] Failed to parse character response: ${msg}`);
                  }
              }
          }

          // Intercept Chat History
          if (url.includes('/chat/history/msgs/') || url.includes('/turns/') ||
              url.includes('/api/trpc/chat.history') || url.includes('/chat/messages') ||
              url.includes('/chats/recent/')) {
               try {
                  const json = await response.json();
                  this.log(`[Metadata] Chat history API intercepted`);

                  const msgs = json?.messages || json?.turns || json?.result?.data?.json?.messages || json?.data?.messages;
                  if (msgs && Array.isArray(msgs)) {
                      this.log(`[Metadata] [OK] Chat messages: ${msgs.length} found`);
                      this.interceptedMessages.push(...msgs);
                  }
               } catch (e) {
                  this.log(`[Metadata] [FAIL] Failed to parse chat history`);
               }
          }
      });
  }  async close() {
    try {
      if (this.page) await this.page.close().catch(() => {});
      if (this.browserContext) await this.browserContext.close().catch(() => {});
    } catch (e: any) {
      this.log(`Error closing browser: ${(e as Error).message}`);
    } finally {
      this.page = null;
      this.browserContext = null;
    }
  }

  async scanSidebar(): Promise<CharacterSummary[]> {
    if (!this.page) throw new Error("Browser not launched");
    this.log("Scanning sidebar for chats...");

    try {
      await this.page.waitForSelector('a[href*="/chat/"]', { timeout: 5000 });
    } catch (e) {
      this.log("No chat links found immediately. Please ensure sidebar is open.");
      return [];
    }

    const seen = new Map<string, CharacterSummary>();
    
    // Pass 1-3: Scroll and collect
    for (let i = 0; i < 3; i++) {
        const elements = await this.page.$$('a[href*="/chat/"]');
        const batch = await this.page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href*="/chat/"]'));
          return links.map((link) => {
            const el = link as HTMLElement;
            const href = el.getAttribute('href') || '';
            const fullUrl = href.startsWith('http') ? href : `https://character.ai${href}`;
            const chatId = fullUrl.split('/').filter(Boolean).pop() || 'unknown';
            
            // Basic info
            const text = el.innerText || '';
            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            const displayName = lines[0] || 'Unknown Character';
            
            // Handle extraction
            let creatorHandle: string | null = null;
            // Look for @handle in the text
            const handleMatch = text.match(/@([\w\._-]+)/);
            if (handleMatch) creatorHandle = handleMatch[1];
            
            // Avatar
            const avatarEl = el.querySelector('img');
            const avatarUrl = avatarEl ? (avatarEl.getAttribute('src') || avatarEl.getAttribute('data-src')) : null;

            // Stats Extraction
            let interactions = '0';
            let likes = '0';

            // Strategy 1: Look for specific SVGs
            const svgs = Array.from(el.querySelectorAll('svg'));
            for (const svg of svgs) {
                const path = svg.querySelector('path');
                if (!path) continue;
                const d = path.getAttribute('d') || '';
                
                // Interactions Icon (Play button-ish)
                // d="M21.5 12c0-5-3.694-8-9.5-8s-9.5 3-9.5 8..."
                if (d.startsWith('M21.5 12')) {
                    const container = svg.parentElement; // div.flex.items-center
                    if (container) {
                        const textEl = container.querySelector('p') || container;
                        const rawText = textEl.textContent?.trim() || '';
                        // Remove commas, keep k/m
                        // "9,621" -> "9621"
                        // "9.6k" -> "9.6k"
                        interactions = rawText.replace(/,/g, '').replace(/ interactions/i, '').trim();
                    }
                }
                
                // Likes Icon (Thumbs up)
                // d="M7 11H4a1 1 0 0 0-1 1v7..."
                if (d.startsWith('M7 11')) {
                    const container = svg.parentElement;
                    if (container) {
                        const textEl = container.querySelector('p') || container;
                        const rawText = textEl.textContent?.trim() || '';
                        // "1 like" -> "1"
                        likes = rawText.replace(/,/g, '').replace(/ likes?/i, '').trim();
                    }
                }
            }

            // Strategy 2: Fallback Regex if SVGs didn't work (e.g. layout change)
            if (interactions === '0' && likes === '0') {
                 // Look for patterns like "9.6k" or "9,621"
                 // This is risky as it might pick up other numbers, but better than nothing
                 const allText = el.innerText;
                 // Match numbers with optional k/m suffix, allowing commas
                 // e.g. 100, 1,000, 1.5k, 10m
                 const matches = allText.match(/(\d+(?:,\d{3})*(?:\.\d+)?[km]?)/gi);
                 if (matches) {
                     // Filter out small numbers that might be dates or other things if needed
                     // But usually stats are the prominent numbers
                     // Heuristic: Interactions is usually the first large number or number with k/m
                     if (matches.length > 0) interactions = matches[0].replace(/,/g, '');
                     if (matches.length > 1) likes = matches[1].replace(/,/g, '');
                 }
            }

            return {
              characterId: chatId,
              chatId,
              displayName,
              handle: creatorHandle || 'Unknown',
              avatarUrl,
              interactions,
              likes,
              url: fullUrl,
              lastChatDate: 'Recently'
            };
          });
        });

        for (const snap of batch) {
          if (!seen.has(snap.chatId)) {
            const cleanDisplayName = this.sanitizeText(snap.displayName, { field: 'sidebar.displayName', maxLen: 120 }) || snap.displayName;
            
            const summary: CharacterSummary = {
                characterId: snap.characterId,
                chatId: snap.chatId,
                displayName: cleanDisplayName,
                avatarUrl: snap.avatarUrl,
                interactions: snap.interactions,
                likes: snap.likes,
                handle: snap.handle,
                url: snap.url,
                lastChatDate: snap.lastChatDate,
                creator: snap.handle ? { handle: snap.handle } : undefined
            };

            if (summary.creator?.handle && !this.isValidHandle(summary.creator.handle)) {
                summary.creator = null;
            }
            seen.set(snap.chatId, summary);
          }
        }
        
        if (elements.length > 0) {
            await elements[elements.length - 1].scrollIntoViewIfNeeded().catch(() => {});
            await this.page.waitForTimeout(800);
        }
    }

    return Array.from(seen.values());
  }

  async scrapeChat(url: string, options?: { reverseTranscript?: boolean; characterName?: string }): Promise<{ messages: ScrapedMessage[], diagnostics: ScraperDiagnostics }> {
    if (!this.page) throw new Error("Browser not launched");
    const startTime = Date.now();
    this.interceptedMessages = []; // Clear previous session data
    
    // Resource blocking for stability - Critical for large chats
    await this.page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'media'].includes(type)) {
        route.abort().catch(() => {});
      } else {
        route.continue().catch(() => {});
      }
    });

    this.log(`Navigating to ${url}...`);
    try {
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page.waitForTimeout(3000); 
        
        // Wait briefly for message DOM nodes to appear. If none show up, we'll
        // proceed with the scroll-to-top loading sequence which triggers older
        // messages to be fetched and injected.
        this.log("Waiting briefly for message nodes to appear in the DOM...");
        try {
          await this.page.waitForFunction(() => {
            return !!document.querySelector('[data-testid="message-row"], .msg-row, [role="row"], .message, [data-message-id]');
          }, { timeout: 2500 });
          this.log('[OK] Message nodes detected in DOM');
        } catch (e) {
          this.log('No message nodes detected immediately; proceeding with scroll-to-top loading');
        }

        // Skip scroll logic entirely - Character.AI loads all messages via API
        // Character.AI loads messages by scrolling to the TOP of the chat
        this.log("Starting scroll-to-top loading sequence...");

        let lastMessageCount = 0;
        let lastInterceptedCount = 0;
        let noProgressCount = 0;
        const maxCycles = 500; // Increased limit for long chats
        let cycle = 0;

        // Get initial message count
        const initialCount = await this.page!.evaluate(() => {
          const root = document.querySelector('main') || document.body;
          const selectors = [
            '[data-testid="message-row"]',
            '.msg-row',
            '[role="row"]',
            '.message',
            '[data-message-id]',
            '.chat-message',
            '.conversation-message',
            '.turn',
            '.chat-turn',
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

        // CRITICAL FIX: Ensure no modals (like Character Profile) are blocking the view
        // The user often has the profile open, which hijacks the scroll detection
        try {
            this.log(`[Scroll] Clearing UI obstructions (Modals/Overlays)...`);
            // 1. Press Escape to close standard modals
            await this.page!.keyboard.press('Escape');
            await this.page!.waitForTimeout(300);
            await this.page!.keyboard.press('Escape'); // Double tap to be sure
            await this.page!.waitForTimeout(500);

            // 2. Click the "Msg Input" area to force focus back to the main chat
            // This ensures we aren't focused on a hidden element or side panel
            const inputArea = await this.page!.$('textarea, [contenteditable="true"]');
            if (inputArea) {
                await inputArea.click({ force: true });
            } else {
                // Fallback: Click the left side of the screen (typically safe)
                await this.page!.mouse.click(100, window.innerHeight / 2);
            }
        } catch (e) {
            this.log(`[Scroll] UI Clear warning: ${e}`);
        }

        // Try mouse wheel scrolling up to load older messages (more reliable than PageUp)
        this.log(`[Scroll] Using mouse wheel scrolling to load older messages...`);        // Center mouse for wheel actions
        try {
            const viewport = this.page!.viewportSize();
            if (viewport) {
                await this.page!.mouse.move(viewport.width / 2, viewport.height * 0.75);
            }
        } catch (e) { /* ignore */ }
        
        for (let i = 0; i < maxCycles; i++) {
          // Scroll up using Playwright's mouse wheel (more authentic)
          await this.page!.mouse.wheel(0, -3000);
          await this.page!.waitForTimeout(500);
          
          // Also try the element specific dispatch as backup
          await this.page!.evaluate(() => {
            // Helper to find the best scrollable container (Shared logic)
            const findScrollable = () => {
              const canScroll = (el: HTMLElement) => {
                const maxScroll = el.scrollHeight - el.clientHeight;
                if (maxScroll <= 0) return false;
                const prev = el.scrollTop;
                const next = Math.min(prev + 100, maxScroll);
                el.scrollTop = next;
                const changed = el.scrollTop !== prev;
                el.scrollTop = prev;
                return changed;
              };

                // Strategy 1: Center-Point Detection (Most Reliable for "Main Content")
                // We pick the element in the literal center of the viewport and walk up.
                const centerEl = document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.75);
                if (centerEl) {
                    let curr: HTMLElement | null = centerEl as HTMLElement;
                    while (curr && curr !== document.body) {
                  if (curr.scrollHeight > curr.clientHeight + 50 && canScroll(curr)) { // +50 tolerance
                     // @ts-ignore
                     console.log(`[ContentScript] Found via center-point: ${curr.tagName} (h=${curr.scrollHeight})`);
                     return curr;
                        }
                        curr = curr.parentElement;
                    }
                }

                // Strategy 2: Largest Scrollable Area
                const allElements = document.querySelectorAll('*');
                // ...existing logic as fallback...
                const candidates = Array.from(allElements).filter(el => {
                     if (el.clientHeight < 50) return false;
                   return el.scrollHeight > el.clientHeight + 100 && canScroll(el as HTMLElement);
                });

                candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
                
                if (candidates.length > 0) return candidates[0] as HTMLElement;

                // Fallback to body/root
                return document.scrollingElement as HTMLElement || document.body;
            };

            const scrollable = findScrollable();
            // Log the state for debugging
            // @ts-ignore
            console.log(`[ContentScript] Found container: h=${scrollable.scrollHeight}, top=${scrollable.scrollTop}`);

            // Dispatch wheel event
            scrollable.dispatchEvent(new WheelEvent('wheel', {
              deltaY: -2000, 
              bubbles: true,
              cancelable: true
            }));
          });
          
          // Random jitter to appear more natural and allow variable network latency
          const waitTime = 2000 + Math.random() * 1000;
          await this.page!.waitForTimeout(waitTime);          const currentCount = await this.page!.evaluate(() => {
            const root = document.querySelector('main') || document.body;
            const selectors = [
              '[data-testid="message-row"]',
              '.msg-row',
              '[role="row"]',
              '.message',
              '[data-message-id]',
              '.chat-message',
              '.conversation-message',
              '.turn',
              '.chat-turn',
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
            this.log(`[Scroll] [OK] Scroll ${i+1}: DOM ${currentCount} (was ${lastMessageCount}), API ${currentInterceptedCount} (was ${lastInterceptedCount})`);
            lastMessageCount = currentCount;
            lastInterceptedCount = currentInterceptedCount;
            noProgressCount = 0;
          } else {
            noProgressCount++;
            this.log(`[Scroll] Scroll ${i+1}: No progress (${noProgressCount}/5)`);
          }
          
          // Enhanced Fallback Strategy: Direct Scroll Manipulation (No Focus Stealing)
          if (noProgressCount >= 2) {
             this.log(`[Scroll] Standard scrolling stalled. Attempting aggressive DOM manipulation...`);
             try {
                const result = await this.page!.evaluate(async () => {
                    // Logic MUST match findScrollable above
                const canScroll = (el: HTMLElement) => {
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
                    let best: HTMLElement | null = null;
                    
                    if (centerEl) {
                        let curr: HTMLElement | null = centerEl as HTMLElement;
                        while (curr && curr !== document.body) {
                    if (curr.scrollHeight > curr.clientHeight + 50 && canScroll(curr)) { 
                      best = curr;
                      break;
                            }
                            curr = curr.parentElement;
                        }
                    }
                    
                    if (!best) {
                         const allElements = document.querySelectorAll('*');
                         const candidates = Array.from(allElements).filter(el => {
                            if (el.clientHeight < 50) return false;
                           return el.scrollHeight > el.clientHeight + 100 && canScroll(el as HTMLElement);
                         });
                         candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
                         if (candidates.length > 0) best = candidates[0] as HTMLElement;
                    }

                    // Fallback to strict scrollingElement for Neo
                    if (!best) best = document.scrollingElement as HTMLElement;

                    if (best) {
                        const info = `${best.tagName.toLowerCase()}.${best.className.split(' ').join('.').substring(0, 50)}... (h=${best.scrollHeight}, t=${best.scrollTop})`;
                        const startTop = best.scrollTop;
                        
                        // Force scroll to top with a "wiggle" to trigger events
                        
                        // 1. If we are deep down, scroll up in chunks to simulate reading
                        // This helps if the observer needs to see items pass by
                        if (startTop > 2000) {
                             best.scrollTop = 2000;
                             await new Promise(r => setTimeout(r, 100));
                        }

                        // 2. Jump/Move to 50px (near top)
                        best.scrollTop = 50;
                        await new Promise(r => setTimeout(r, 150));
                        
                        // 3. Smooth scroll to 0 to hit the trigger
                        best.scrollTo({ top: 0, behavior: 'smooth' });
                        
                        // 4. Dispatch scroll event manually
                        best.dispatchEvent(new Event('scroll', { bubbles: true }));
                        
                        return { success: true, info, startTop };
                    }
                    return { success: false, info: 'No container found' };
                });

                if (result && result.success) {
                    this.log(`[Scroll] Manipulated ${result.info}. Moved from ${result.startTop} to 0.`);
                    // Give it PLENTY of time to load data
                    await this.page!.waitForTimeout(3500); 
                } else {
                    this.log(`[Scroll] Could not find scrollable container to manipulate.`);
                }
             } catch (err) {
                this.log(`[Scroll] Direct manipulation failed: ${err}`);
             }
          }

          if (noProgressCount >= 5) { // Increased tolerance before manual intervention
            if (this.manualScrollHandler) {
                this.log(`[Scroll] Automatic scrolling stalled. Requesting manual intervention...`);
                const shouldContinue = await this.manualScrollHandler();
                if (shouldContinue) {
                    this.log(`[Scroll] Resuming after manual intervention...`);
                    noProgressCount = 0; // Reset counter to give it another chance
                } else {
                    this.log(`[Scroll] User requested to stop scrolling.`);
                    break;
                }
            } else {
                this.log(`[Scroll] Stopping - no progress after ${i+1} scroll attempts`);
                break;
            }
          }
        }

        // Fallback: try scrolling to the first message element if it exists
        if (lastMessageCount === initialCount) {
          this.log(`[Scroll] Mouse wheel didn't work, trying scrollIntoView on first message...`);
          try {
            await this.page!.evaluate(() => {
              const firstMsg = document.querySelector('[data-testid="message-row"], .msg-row, [role="row"]');
              if (firstMsg) {
                (firstMsg as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            });
            await this.page!.waitForTimeout(2000);
            
            const finalCount = await this.page!.evaluate(() => {
              const root = document.querySelector('main') || document.body;
              const selectors = [
                '[data-testid="message-row"]',
                '.msg-row',
                '[role="row"]',
                '.message',
                '[data-message-id]',
                '.chat-message',
                '.conversation-message',
                '.turn',
                '.chat-turn'
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
    
    // If we have very few API messages, offer manual scrolling
    if (this.interceptedMessages.length < 20) {
        this.log(`[Scroll] Only ${this.interceptedMessages.length} API messages captured. Offering manual scrolling option...`);
        
        // For now, just log that manual scrolling would be offered
        // In a full implementation, this would show a dialog to the user
        this.log(`[Manual] To load more messages manually:`);
        this.log(`[Manual] 1. Use PageUp, Home, or scroll wheel to scroll to the top of the chat`);
        this.log(`[Manual] 2. Wait for older messages to load`);
        this.log(`[Manual] 3. The scraper will detect the new API calls automatically`);
        this.log(`[Manual] Waiting 30 seconds for manual scrolling...`);
        
        await this.page!.waitForTimeout(30000); // Give user time to scroll manually
    }
    
    } catch (e: any) {
        // Retry logic for navigation issues
        this.log(`Navigation failed, retrying: ${e.message}`);
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(3000);
    }

    this.log("Extracting message content...");
    
    let result: ScrapedMessage[] = [];
    let extractionSource = 'dom';
    let selectorUsed = 'api-interception'; // Default for Path B

    // PATH B: Use Intercepted API Messages if available
    if (this.interceptedMessages.length > 0) {
        this.log(`[Extraction] Using ${this.interceptedMessages.length} intercepted API messages as primary source.`);
        extractionSource = 'api';
        
        // Deduplicate raw API messages by ID if available to handle overlaps without killing repeats
        const seenIds = new Set<string>();
        const validMsgs: any[] = [];
        
        for (const msg of this.interceptedMessages) {
             // Handle both UUID (old API) and turn_key structure (Neo API)
             const id = msg.uuid || msg.id || msg.message_id || msg.primary_candidate_id || (msg.turn_key && msg.turn_key.turn_id);
             
             if (id) {
                 if (!seenIds.has(id)) {
                    seenIds.add(id);
                    validMsgs.push(msg);
                 }
             } else {
                 validMsgs.push(msg);
             }
        }

        // Map API messages to ScrapedMessage
        const mapped = validMsgs.map((msg, index) => {
             if (index === 0) {
                 this.log(`[API Debug] Full structure of first message: ${JSON.stringify(msg, null, 2)}`);
             }

             let text = msg.text || msg.content || msg.raw_content || '';
             
             // Handle "Turn" structure with candidates (Character.AI Neo API)
             if (!text && msg.candidates && Array.isArray(msg.candidates) && msg.candidates.length > 0) {
                 // Try to find the primary candidate if specified
                 let candidate = msg.candidates[0];
                 if (msg.primary_candidate_id) {
                     const primary = msg.candidates.find((c: any) => c.candidate_id === msg.primary_candidate_id);
                     if (primary) candidate = primary;
                 }
                 text = candidate.raw_content || candidate.text || candidate.content || '';
             }

             if (!text) {
                 // Don't log every failure to avoid spam, just the first few
                 if (index < 5) this.log(`[API Debug] No text found in message ${index}`);
                 return null;
             }
             
             let role: 'user' | 'char' = 'char';
             // Check author in main msg or candidate
             const author = msg.author || msg.src || (msg.candidates && msg.candidates[0]?.author);
             
             if (author) {
                 if (author.is_human === true || author.is_human === 'true') role = 'user';
                 else if (author.role === 'USER' || author.role === 'user') role = 'user';
             }
             
             this.log(`[API Debug] Extracted: role=${role}, text length=${text.length}`);
             return { turn_index: 0, role, text };
        }).filter(m => m !== null) as ScrapedMessage[];

        // Consecutive deduplication to clean up any rapid-fire duplicate artifacts
        const unique: ScrapedMessage[] = [];
        let prevKey: string | null = null;
        for (const m of mapped) {
            const key = `${m.role}:${m.text}`;
            if (key !== prevKey) {
                unique.push(m);
                prevKey = key;
            }
        }
        result = unique;
    } else {
        // PATH A: DOM Extraction (Fallback)
        this.log(`[Extraction] No API messages intercepted. Falling back to DOM extraction.`);

        // Extraction: Run in browser, return clean objects. No outerHTML to save memory.
        const extractionResult = await this.page!.evaluate((charName) => {
          const root = document.querySelector('main') || document.body;

          const rowSelector = '[data-testid="message-row"], .msg-row, [role="row"], .turn, [class*="Turn__"], [class*="Message__"]';
          let rows = Array.from(root.querySelectorAll(rowSelector));

          // Fix: Filter out nested elements to avoid duplicates
          rows = rows.filter(el => {
             return !rows.some(parent => parent !== el && parent.contains(el));
          });

          // Fallback: find likely message containers inside main.
          if (rows.length === 0) {
            const divs = Array.from(root.querySelectorAll('div'));
            rows = divs.filter((d) => {
              const el = d as HTMLElement;
              const t = (el.innerText || '').trim();
              if (!t) return false;
              // Accept shorter messages too (e.g., single emoji or short replies)
              if (t.length < 1 || t.length > 10000) return false;
              const r = el.getBoundingClientRect();
              if (r.height < 16 || r.width < 120) return false;
              return true;
            });
            console.log(`[Extract Debug] Fallback found ${rows.length} potential message containers`);
          }

          const messages = rows.map((el, idx) => {
            const rawText = (el as HTMLElement).innerText || '';
            const lines = rawText.split('\n').map((l: string) => l.trim()).filter(Boolean);

            // Role Detection: More lenient - keep all messages that have content
            let role: 'user' | 'char' = 'user';
            const ds = (el as HTMLElement).dataset;

            if (ds.isUser === 'true' || ds.author === 'user') role = 'user';
            else if (ds.isUser === 'false' || ds.author === 'character') role = 'char';
            else {
              // More lenient detection
              const hasCaiLogo = !!el.querySelector('img[src*="c.ai"], svg[aria-label="Character.AI"]');
              const hasCaiText = lines.some((l: string) => l.toLowerCase().includes('c.ai'));
              const startsWithYou = (lines[0] || '').toLowerCase().startsWith('you');
              const hasUserIndicators = lines.some((l: string) => l.toLowerCase().includes('you') || l.toLowerCase().includes('user'));

              if (hasCaiLogo || hasCaiText) role = 'char';
              else if (startsWithYou || hasUserIndicators) role = 'user';
              else role = 'user'; // Default to user if unclear
            }

            // Clean Body - less aggressive filtering
            const cleanLines = lines.filter((line: string, i: number) => {
              if (/^c\.ai$/i.test(line)) return false;
              // Strip timestamps
              if (/^(just now|\d+\s+(m|h|d|w|mo|y)|(minute|hour|day|week|month|year)s?\s+ago)$/i.test(line)) return false;
              // Strip character name header if it matches provided name
              if (charName && line.toLowerCase() === charName.toLowerCase()) return false;
              // Only strip 'You'/'User' if it is the header line
              if (i === 0 && (line === 'You' || line === 'User')) return false;
              return true;
            });

            const text = cleanLines.join('\n').trim();
            // Keep messages that have at least some content, even if short
            if (text.length < 1) return null; // Minimum 1 character

            const top = (el as HTMLElement).getBoundingClientRect().top;

            return { turn_index: idx, role, text, top };
          }).filter(m => m && m.text && m.text.length >= 1); // Keep messages with at least 1 character

          return { messages, selectorUsed: rowSelector, count: messages.length };
        }, options?.characterName);

        this.log(`[Extract Debug] Extraction completed: ${extractionResult.count} messages found`);
        selectorUsed = extractionResult.selectorUsed;
        
        // Deduplicate only consecutive duplicate messages (renderers sometimes produce
        // duplicated adjacent nodes). Keep non-consecutive duplicates as distinct
        const deduped: ScrapedMessage[] = [];
        let prevKey: string | null = null;
        for (const msg of extractionResult.messages) {
          if (!msg) continue; // Skip null messages
          const key = `${msg.role}:${msg.text}`;
          if (key === prevKey) continue; // drop consecutive duplicate
          prevKey = key;
          deduped.push({ turn_index: 0, role: msg.role, text: msg.text }); // Re-index later
        }
        result = deduped;
    }

    result = result.map((m, i) => ({ ...m, turn_index: i }));
    // Auto-detect order: if scraped top-to-bottom, usually chronological.
    // If reverseTranscript option is explicitly set, honor it.
    if (options?.reverseTranscript) {
      result = result.reverse().map((m, i) => ({ ...m, turn_index: i }));
    }

    this.log(`Extracted ${result.length} clean messages.`);
    await this.page.unroute('**/*').catch(() => {});
    
    return {
        messages: result,
        diagnostics: {
            chosenMessageSelector: selectorUsed,
            messageCount: result.length,
            durationMs: Date.now() - startTime
        }
    };
  }

  async scrapeViewerProfile(): Promise<ViewerProfile | null> {
    if (!this.page) throw new Error("Browser not launched");
    
    this.log("Navigating to profile page...");
    await this.page.goto('https://character.ai/profile', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    
    // Wait for key elements to ensure we are on the profile page
    // We try multiple selectors that might appear
    try {
        await Promise.any([
            this.page.waitForSelector('.text-display', { timeout: 8000 }),
            this.page.waitForSelector('div[class*="text-display"]', { timeout: 8000 }),
            this.page.waitForSelector('button', { timeout: 8000 }) // At least some buttons should appear
        ]);
        // Give a small buffer for React to hydrate fully
        await this.page!.waitForTimeout(1000);
    } catch (e: any) {
        this.log("Warning: Timeout waiting for profile selectors. Attempting scrape anyway...");
    }

    const profile = await this.page!.evaluate(() => {
        // Helper to find text content safely
        const getText = (selector: string) => {
            const el = document.querySelector(selector);
            return (el as HTMLElement)?.innerText?.trim() || null;
        };

        // 1. Name & Handle
        // Try specific class first, then fallback to searching by structure
        let displayName = getText('.text-display') || getText('div[class*="text-display"]');
        
        // Fallback: Look for the largest text element in the main container
        if (!displayName) {
             const candidates = Array.from(document.querySelectorAll('div, h1, h2, span'))
                .filter(el => {
                    const style = window.getComputedStyle(el);
                    return parseFloat(style.fontSize) > 20; // Heuristic for name
                });
             if (candidates.length > 0) displayName = (candidates[0] as HTMLElement).innerText?.trim() || null;
        }

        // Handle
        // Look for @ symbol in muted text
        const allMuted = Array.from(document.querySelectorAll('.text-muted-foreground, [class*="text-muted"]'));
        const handleEl = allMuted.find(el => (el as HTMLElement).innerText?.trim().startsWith('@'));
        const handle = (handleEl as HTMLElement)?.innerText?.trim() || null;

        // 2. Avatar
        // Find 90x90 image or largest image in main
        const imgs = Array.from(document.querySelectorAll('main img, img[alt*="Avatar"]'));
        const avatarEl = imgs.find(img => {
            const rect = img.getBoundingClientRect();
            // User HTML has 90x90. We allow some variance.
            return rect.width >= 80 && rect.height >= 80; 
        });
        const avatarUrl = avatarEl?.getAttribute('src') || null;

        // 3. c.ai+ Badge
        const isPlus = !!document.querySelector('.cai-plus-gradient');

        // 4. Stats
        // Search buttons for keywords
        const buttons = Array.from(document.querySelectorAll('button'));
        const followersBtn = buttons.find(b => b.innerText?.toLowerCase().includes('followers'));
        const followingBtn = buttons.find(b => b.innerText?.toLowerCase().includes('following'));
        
        // Interactions often in p tag or div
        // We must ensure we don't grab a parent container.
        // We look for an element whose OWN text is roughly "X Interactions"
        const allElements = Array.from(document.querySelectorAll('p, span, div'));
        const interactionsEl = allElements.find(el => {
            const t = (el as HTMLElement).innerText?.trim() || '';
            // Must contain "Interactions"
            if (!t.toLowerCase().includes('interactions')) return false;
            // Must be short (e.g. "24.9k Interactions") - prevent grabbing parents
            if (t.length > 30) return false; 
            // Ensure it doesn't contain newlines which usually implies multiple children
            if (t.includes('\n')) return false;
            return true;
        });

        const parseStat = (text: string | undefined, keyword: string) => {
            if (!text) return '0';
            // Case insensitive replace
            const regex = new RegExp(keyword, 'gi');
            return text.replace(regex, '').replace(/[|•]/g, '').trim();
        };

        return {
            displayName: displayName || 'User',
            handle: handle,
            avatarUrl: avatarUrl,
            isPlus: isPlus,
            followers: parseStat(followersBtn?.innerText, 'Followers'),
            following: parseStat(followingBtn?.innerText, 'Following'),
            interactions: parseStat((interactionsEl as HTMLElement)?.innerText, 'Interactions')
        };
    });

    this.log(`Scraped Profile: ${JSON.stringify(profile)}`);

    // Fallback for handle if not found in DOM
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
        updatedAt: new Date().toISOString(),
        source: 'dom',
        followers: profile.followers,
        following: profile.following,
        interactions: profile.interactions
    };
  }

  async getCreatorProfile(username: string): Promise<CreatorProfile | null> {
    if (!this.browserContext) throw new Error("Browser not launched");
    const page = await this.browserContext.newPage();
    try {
        await page.goto(`https://character.ai/profile/${username}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const data = await page.evaluate(() => {
            const h1 = document.querySelector('h1');
            const img = document.querySelector('img[alt*="avatar"]');
            return {
                username: (h1 as HTMLElement)?.innerText || null,
                avatarUrl: img?.getAttribute('src') || null
            }
        });
        if (!data.username) return null;
        return {
            username: username,
            avatarUrl: data.avatarUrl,
            fetchedAt: new Date().toISOString(),
            followers: 0, following: 0, interactions: 0
        };
    } catch {
        return null;
    } finally {
        await page.close().catch(()=>{});
    }
  }

  async hydrateChatsMetadata(urls: string[], options?: { limit?: number; signal?: () => boolean }): Promise<Partial<CharacterSummary>[]> {
    if (!this.page) throw new Error('Browser not launched');
    const results: Partial<CharacterSummary>[] = [];
    const limit = options?.limit || 10;
    
    for (let i = 0; i < Math.min(urls.length, limit); i++) {
        if (options?.signal?.()) break;
        try {
            await this.page.goto(urls[i], { waitUntil: 'domcontentloaded', timeout: 10000 });
            const title = await this.page.title();
            results.push({ displayName: title.replace(' | Character.AI', '') });
        } catch {}
    }
    return results;
  }

  async scrapeProfileCharacters(handle: string, sortMode: string): Promise<CharacterIndexEntry[]> { return []; }
  
  async scrapeFollowersList(type: 'followers' | 'following'): Promise<any[]> {
    if (!this.page) throw new Error("Browser not launched");
    this.log(`Scraping ${type} list...`);
    
    // Ensure we are on profile page
    if (!this.page.url().includes('/profile')) {
        await this.page.goto('https://character.ai/profile', { waitUntil: 'domcontentloaded' });
    }

    // Click the button
    const success = await this.page.evaluate(async (targetType) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => b.innerText?.toLowerCase().includes(targetType));
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

    // Wait for modal
    try {
        await this.page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    } catch {
        this.log("Modal did not appear.");
        return [];
    }

    // Scrape list
    // We need to scroll the modal to load all items.
    // For now, we'll just scrape what's visible + a few scrolls.
    const results = await this.page.evaluate(async () => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return [];
        
        // Find the scrollable container inside dialog
        const scrollable = Array.from(dialog.querySelectorAll('div')).find(d => {
            const style = window.getComputedStyle(d);
            return style.overflowY === 'auto' || style.overflowY === 'scroll';
        }) || dialog;

        const items = new Map();
        
        // Scroll a few times
        for (let i = 0; i < 5; i++) {
            scrollable.scrollTop = scrollable.scrollHeight;
            await new Promise(r => setTimeout(r, 500));
            
            const rows = Array.from(dialog.querySelectorAll('a[href*="/profile/"]'));
            rows.forEach(row => {
                const href = row.getAttribute('href');
                const handle = href?.split('/').pop();
                const img = row.querySelector('img');
                const nameEl = row.querySelector('div.font-bold') || row.querySelector('span.font-bold'); // Heuristic
                
                if (handle) {
                    items.set(handle, {
                        handle: '@' + handle,
                        avatarUrl: img?.getAttribute('src'),
                        displayName: (nameEl as HTMLElement)?.innerText || handle
                    });
                }
            });
        }
        return Array.from(items.values());
    });

    // Close modal
    await this.page.keyboard.press('Escape');
    
    return results;
  }

  async indexProfileTab(tab: string, opts: any): Promise<any[]> { return []; }
  async testSelectors(): Promise<any> { return { status: 'Selectors deprecated in V1.0 stable' }; }

  // QA / Diagnostics
    async runDiagnostics(): Promise<QAReport> {
      this.log("[QA] Starting self-diagnostics...");
      return await this.qaEngine.run(this.buildQAContext());
    }

  // Real-time QA Action
    async testScroll(): Promise<boolean> {
     if (!this.page) throw new Error("Browser not launched");
     this.log("[QA] Testing scroll mechanism...");

     // Clear Modals for QA too
     await this.page.keyboard.press('Escape');
     await this.page.waitForTimeout(300);

     const result = await this.qaEngine.runSingle('scroll', this.buildQAContext());
     if (!result) {
       this.log("[QA] [FAIL] Scroll test did not run.");
       return false;
     }

     if (result.status === 'pass') {
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
