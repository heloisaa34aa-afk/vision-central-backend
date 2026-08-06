import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { SCRAPER_CONFIG } from './config';
import { logger } from '../logger';
import { ProxyConfig } from './proxyManager';
import { SessionManager, InstagramSession } from './sessionManager';

export class BrowserManager {
  private static instance: BrowserManager;
  private browser: Browser | null = null;
  public activeContexts = 0;
  public activePages = 0;

  private constructor() {}

  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      logger.info('Inicializando instância única do Chromium...');
      this.browser = await chromium.launch({
        headless: SCRAPER_CONFIG.HEADLESS,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox', 
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--window-position=0,0',
          '--ignore-certificate-errors',
          '--ignore-certificate-errors-spki-list'
        ]
      });
    }
    return this.browser;
  }

  async createSession(proxy?: ProxyConfig | null, sessionData?: InstagramSession | null): Promise<{ context: BrowserContext, page: Page }> {
    const browser = await this.getBrowser();
    
    const contextOptions: any = {
      userAgent: sessionData?.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      hasTouch: false,
    };

    if (proxy) {
      contextOptions.proxy = { server: proxy.url };
    }

    const context = await browser.newContext(contextOptions);
    this.activeContexts++;
    
    if (sessionData) {
      const sessionManager = new SessionManager();
      const loaded = await sessionManager.loadSessionToContext(sessionData, context);
      if (loaded) {
         logger.info(`Sessão ${sessionData.id} carregada no contexto.`);
      }
    }

    const page = await context.newPage();
    this.activePages++;

    return { context, page };
  }

  async closeSession(context: BrowserContext, page: Page) {
    logger.info('Fechando aba e contexto da sincronização...');
    try {
      if (page && !page.isClosed()) {
        await page.close();
        this.activePages--;
      }
      if (context) {
        await context.close();
        this.activeContexts--;
      }
    } catch (e: any) {
      logger.warn(`Erro ao fechar sessão: ${e.message}`);
    }
  }
}
