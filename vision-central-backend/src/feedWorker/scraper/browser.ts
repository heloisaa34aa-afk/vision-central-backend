import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { SCRAPER_CONFIG } from './config';
import { logger } from '../logger';
import { ProxyConfig } from './proxyManager';
import { InstagramSession, SessionManager } from './sessionManager';

export class BrowserManager {
  private static instance: BrowserManager;
  private browser: Browser | null = null;
  private idleCloseTimer: NodeJS.Timeout | null = null;
  public activeContexts = 0;
  public activePages = 0;

  private constructor() {}

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) BrowserManager.instance = new BrowserManager();
    return BrowserManager.instance;
  }

  async getBrowser(): Promise<Browser> {
    if (this.idleCloseTimer) {
      clearTimeout(this.idleCloseTimer);
      this.idleCloseTimer = null;
    }
    if (!this.browser) {
      logger.info('Inicializando instancia unica do Chromium...');
      this.browser = await chromium.launch({
        headless: SCRAPER_CONFIG.HEADLESS,
        args: [
          '--no-sandbox', '--disable-setuid-sandbox', '--disable-infobars',
          '--window-position=0,0', '--ignore-certificate-errors',
        ],
      });
    }
    return this.browser;
  }

  async createSession(
    proxy?: ProxyConfig | null,
    sessionData?: InstagramSession | null,
  ): Promise<{ context: BrowserContext; page: Page }> {
    const browser = await this.getBrowser();
    const contextOptions: any = {
      userAgent: sessionData?.user_agent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      hasTouch: false,
    };
    if (proxy) contextOptions.proxy = { server: proxy.url };

    const context = await browser.newContext(contextOptions);
    this.activeContexts++;
    if (sessionData) {
      const loaded = await new SessionManager().loadSessionToContext(sessionData, context);
      if (loaded) logger.info(`Sessao ${sessionData.id} carregada no contexto.`);
    }
    const page = await context.newPage();
    this.activePages++;
    return { context, page };
  }

  async closeSession(context: BrowserContext, page: Page) {
    try {
      if (page && !page.isClosed()) await page.close();
      this.activePages = Math.max(0, this.activePages - 1);
      if (context) await context.close();
      this.activeContexts = Math.max(0, this.activeContexts - 1);
    } catch (error: any) {
      logger.warn(`Erro ao fechar sessao do browser: ${error.message}`);
    }

    // Release Chromium RAM shortly after the sequential queue finishes.
    if (this.activeContexts === 0 && this.browser && !this.idleCloseTimer) {
      this.idleCloseTimer = setTimeout(async () => {
        if (this.activeContexts !== 0 || !this.browser) return;
        try {
          await this.browser.close();
          logger.info('Chromium encerrado apos periodo ocioso.');
        } catch (error: any) {
          logger.warn(`Erro ao encerrar Chromium: ${error.message}`);
        } finally {
          this.browser = null;
          this.idleCloseTimer = null;
        }
      }, 60_000);
    }
  }
}
