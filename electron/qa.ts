import { Page } from 'playwright';

export type QAStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface QACheckResult {
  id: string;
  name: string;
  status: QAStatus;
  message: string;
  details?: Record<string, unknown> | null;
  timestamp: string;
}

export interface QAReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  url?: string;
  checks: QACheckResult[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    info: number;
  };
}

export interface QAContext {
  page: Page | null;
  interceptedMessagesCount: number;
  log: (msg: string) => void;
}

export interface QACheck {
  id: string;
  name: string;
  run: (ctx: QAContext) => Promise<QACheckResult>;
}

const nowIso = () => new Date().toISOString();

const buildResult = (partial: Omit<QACheckResult, 'timestamp'>): QACheckResult => ({
  ...partial,
  timestamp: nowIso()
});

class BrowserConnectedCheck implements QACheck {
  id = 'browser';
  name = 'Browser Connection';

  async run(ctx: QAContext): Promise<QACheckResult> {
    if (!ctx.page) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: 'fail',
        message: 'Browser not connected'
      });
    }

    return buildResult({
      id: this.id,
      name: this.name,
      status: 'pass',
      message: 'Browser connected'
    });
  }
}

class UrlCheck implements QACheck {
  id = 'url';
  name = 'Active URL';

  async run(ctx: QAContext): Promise<QACheckResult> {
    if (!ctx.page) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: 'fail',
        message: 'No page available'
      });
    }

    const url = ctx.page.url();
    const isChat = url.includes('/chat/');

    return buildResult({
      id: this.id,
      name: this.name,
      status: isChat ? 'pass' : 'warn',
      message: isChat ? 'Chat page detected' : `Unexpected URL: ${url}`,
      details: { url }
    });
  }
}

class ElementCheck implements QACheck {
  id: string;
  name: string;
  private selector: string;

  constructor(id: string, name: string, selector: string) {
    this.id = id;
    this.name = name;
    this.selector = selector;
  }

  async run(ctx: QAContext): Promise<QACheckResult> {
    if (!ctx.page) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: 'fail',
        message: 'No page available'
      });
    }

    const found = await ctx.page.$(this.selector);
    return buildResult({
      id: this.id,
      name: this.name,
      status: found ? 'pass' : 'warn',
      message: found ? `Found ${this.name}` : `Missing ${this.name}`,
      details: { selector: this.selector }
    });
  }
}

class MessageCountCheck implements QACheck {
  id = 'message-count';
  name = 'Message Count (DOM)';

  async run(ctx: QAContext): Promise<QACheckResult> {
    if (!ctx.page) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: 'fail',
        message: 'No page available'
      });
    }

    const result = await ctx.page.evaluate(() => {
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
        '[class*="Turn__"]',
        '[class*="Message__"]'
      ];

      let best = { selector: '', count: 0 };
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
        status: 'pass',
        message: `Detected ${result.count} messages`,
        details: { selector: result.selector, count: result.count }
      });
    }

    return buildResult({
      id: this.id,
      name: this.name,
      status: 'warn',
      message: 'No message nodes detected',
      details: { selector: result.selector }
    });
  }
}

class ScrollContainerCheck implements QACheck {
  id = 'scroll';
  name = 'Scroll Container';

  async run(ctx: QAContext): Promise<QACheckResult> {
    if (!ctx.page) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: 'fail',
        message: 'No page available'
      });
    }

    const result = await ctx.page.evaluate(() => {
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

      const findScrollable = () => {
        const centerEl = document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.75);
        if (centerEl) {
          let curr: HTMLElement | null = centerEl as HTMLElement;
          while (curr && curr !== document.body) {
            if (curr.scrollHeight > curr.clientHeight + 50 && canScroll(curr)) {
              return curr;
            }
            curr = curr.parentElement;
          }
        }

        const allElements = document.querySelectorAll('*');
        const candidates = Array.from(allElements).filter(el => {
          if (el.clientHeight < 50) return false;
          return el.scrollHeight > el.clientHeight + 100 && canScroll(el as HTMLElement);
        });
        candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
        if (candidates.length > 0) return candidates[0] as HTMLElement;

        return document.scrollingElement as HTMLElement || document.body;
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
        status: 'fail',
        message: 'No scrollable container detected'
      });
    }

    if (!result.canScroll) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: 'warn',
        message: 'Scrollable container found but scrollTop did not change',
        details: result as Record<string, unknown>
      });
    }

    return buildResult({
      id: this.id,
      name: this.name,
      status: 'pass',
      message: 'Scrollable container identified',
      details: result as Record<string, unknown>
    });
  }
}

class NetworkInterceptionCheck implements QACheck {
  id = 'network';
  name = 'Network Interception';

  async run(ctx: QAContext): Promise<QACheckResult> {
    if (ctx.interceptedMessagesCount > 0) {
      return buildResult({
        id: this.id,
        name: this.name,
        status: 'pass',
        message: `Captured ${ctx.interceptedMessagesCount} API messages`,
        details: { interceptedMessagesCount: ctx.interceptedMessagesCount }
      });
    }

    return buildResult({
      id: this.id,
      name: this.name,
      status: 'info',
      message: 'No API messages intercepted yet',
      details: { interceptedMessagesCount: ctx.interceptedMessagesCount }
    });
  }
}

export class QAEngine {
  private checks: QACheck[];

  constructor(checks?: QACheck[]) {
    this.checks = checks ?? [
      new BrowserConnectedCheck(),
      new UrlCheck(),
      new ElementCheck('sidebar', 'Sidebar', 'nav, [class*="Sidebar"]'),
      new ElementCheck('chat-input', 'Chat Input', 'textarea, [contenteditable="true"]'),
      new ElementCheck('chat-root', 'Chat Root', 'main, [role="main"]'),
      new MessageCountCheck(),
      new ScrollContainerCheck(),
      new NetworkInterceptionCheck()
    ];
  }

  async run(ctx: QAContext): Promise<QAReport> {
    const startedAt = nowIso();
    const checks: QACheckResult[] = [];

    for (const check of this.checks) {
      try {
        const result = await check.run(ctx);
        checks.push(result);
        ctx.log(`[QA] [${result.status.toUpperCase()}] ${result.name}: ${result.message}`);
      } catch (e: any) {
        const result = buildResult({
          id: check.id,
          name: check.name,
          status: 'fail',
          message: e?.message || 'Unhandled error'
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
      url: ctx.page?.url(),
      checks,
      summary
    };
  }

  async runSingle(id: string, ctx: QAContext): Promise<QACheckResult | null> {
    const check = this.checks.find(c => c.id === id);
    if (!check) return null;
    return await check.run(ctx);
  }
}
