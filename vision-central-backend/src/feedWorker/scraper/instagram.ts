import { FeedProvider, FeedPost, FeedMedia } from './types';
import { BrowserManager } from './browser';
import { parseNetworkResponse } from './parser';
import { SCRAPER_CONFIG } from './config';
import { randomDelay, deduplicatePosts } from '../utils';
import { logger } from '../logger';
import { Page, BrowserContext } from 'playwright';
import { SessionManager, InstagramSession } from './sessionManager';
import { ProxyManager, ProxyConfig } from './proxyManager';
import { MetricsLogger } from './metrics';
import os from 'os';

export class InstagramScraper implements FeedProvider {
  private sessionManager = new SessionManager();
  private proxyManager = new ProxyManager();

  async getPosts(perfil: string, ultimoItemId?: string): Promise<{ status: string; posts: FeedPost[] }> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    const browserManager = BrowserManager.getInstance();
    let status = 'SUCCESS';
    let allPosts: FeedPost[] = [];
    let networkPosts: FeedPost[] = [];
    let retries = 0;
    
    let currentSession: InstagramSession | null = await this.sessionManager.getActiveSession();
    let currentProxy: ProxyConfig | null = await this.proxyManager.getNextProxy();
    
    let sessionResult;
    try {
      sessionResult = await browserManager.createSession(currentProxy, currentSession);
    } catch (err: any) {
      logger.error(`Erro ao criar sessão do browser: ${err.message}`);
      return { status: 'ERROR', posts: [] };
    }

    let { context, page } = sessionResult;

    try {
      page.on('response', async (response) => {
        if (response.url().includes('/graphql/query') || response.url().includes('/api/v1/feed/user/')) {
          try {
            const json = await response.json();
            const parsed = parseNetworkResponse(json);
            if (parsed.length > 0) networkPosts.push(...parsed);
          } catch (e) {}
        }
      });

      const url = `https://www.instagram.com/${perfil}/`;
      logger.info(`Acessando perfil: ${url}`);
      
      let loaded = false;
      for (let attempt = 1; attempt <= SCRAPER_CONFIG.MAX_RETRIES; attempt++) {
        retries = attempt - 1;
        try {
          const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: SCRAPER_CONFIG.REQUEST_TIMEOUT });
          
          if (response?.status() === 404) {
            status = 'NOT_FOUND';
            loaded = false;
            break;
          }
          
          const pageText = await page.evaluate(() => document.body.innerText);
          const isLoginWall = page.url().includes('/accounts/login') || pageText.includes('Log In') || pageText.includes('Entrar') || pageText.includes('Log in to Instagram');
          
          if (isLoginWall) {
            logger.warn(`Login wall detectado na tentativa ${attempt}`);
            
            if (currentSession) {
               await this.sessionManager.invalidateSession(currentSession.id);
            }
            
            if (attempt === SCRAPER_CONFIG.MAX_RETRIES) {
               status = 'LOGIN_WALL';
               await page.screenshot({ path: `error-loginwall-${perfil}-${Date.now()}.png` }).catch(() => {});
               loaded = false;
               break;
            }
            
            // Rotate proxy and session
            await browserManager.closeSession(context, page);
            if (currentProxy) await this.proxyManager.markFailed(currentProxy.id);
            
            currentSession = await this.sessionManager.getActiveSession();
            currentProxy = await this.proxyManager.getNextProxy();
            const newSess = await browserManager.createSession(currentProxy, currentSession);
            context = newSess.context;
            page = newSess.page;
            
            await randomDelay(2000, 5000);
            continue;
          }
          
          loaded = true;
          break;
        } catch (error) {
          logger.warn(`Tentativa ${attempt} falhou ao acessar ${perfil}`);
          if (attempt === SCRAPER_CONFIG.MAX_RETRIES) {
             await page.screenshot({ path: `error-timeout-${perfil}-${Date.now()}.png` }).catch(() => {});
             throw error;
          }
          await randomDelay(1000 * Math.pow(2, attempt), 2000 * Math.pow(2, attempt));
        }
      }

      if (loaded) {
        const userAgent = await page.evaluate(() => navigator.userAgent);
        await this.sessionManager.saveSession('global_session', context, userAgent);

        const isPrivate = await page.evaluate(() => {
          return document.body.innerText.includes('This Account is Private') || document.body.innerText.includes('Esta conta é privada');
        });

        if (isPrivate) {
          logger.warn(`Perfil privado: ${perfil}`);
          status = 'PRIVATE';
        } else {
          await randomDelay(2000, 4000);

          try {
             const scrapedPosts = await this.scrapeViaUI(page, ultimoItemId);
             allPosts.push(...scrapedPosts);
             logger.info(`Posts capturados via UI: ${scrapedPosts.length}`);
          } catch (uiError: any) {
             logger.warn(`Falha na estratégia de UI principal, caindo para Fallback (Network). Erro: ${uiError.message}`);
             await page.screenshot({ path: `error-uifallback-${perfil}-${Date.now()}.png` }).catch(() => {});
          }
        }
      }
      
      if (allPosts.length === 0 && networkPosts.length > 0) {
        logger.info(`Usando Fallback: Posts capturados pela Network: ${networkPosts.length}`);
        allPosts.push(...networkPosts);
      }

      allPosts = deduplicatePosts(allPosts);
      allPosts.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
      
      if (ultimoItemId) {
        const index = allPosts.findIndex(p => p.shortcode === ultimoItemId);
        if (index !== -1) {
          allPosts = allPosts.slice(0, index);
        }
      }

      if (!ultimoItemId && allPosts.length > SCRAPER_CONFIG.MAX_POSTS) {
        allPosts = allPosts.slice(0, SCRAPER_CONFIG.MAX_POSTS);
      }
      
      logger.info(`Posts realmente retornados: ${allPosts.length}`);

    } catch (error: any) {
      logger.error(`Erro ao fazer scrape do perfil ${perfil}`, error);
      status = 'ERROR';
      try {
         await page.screenshot({ path: `error-fatal-${perfil}-${Date.now()}.png` });
      } catch (e) {}
    } finally {
      await browserManager.closeSession(context, page);
      
      const endTime = Date.now();
      const endMemory = process.memoryUsage().heapUsed;
      const memDiff = Math.max(0, (endMemory - startMemory) / 1024 / 1024);
      
      await MetricsLogger.logSync({
         perfil,
         tempo_ms: endTime - startTime,
         memoria_mb: parseFloat(memDiff.toFixed(2)),
         cpu_percent: os.loadavg()[0],
         proxy_usado: currentProxy?.id,
         sessao_usada: currentSession?.id,
         retries,
         status,
         posts_encontrados: allPosts.length
      });
    }

    return { status, posts: allPosts };
  }

  private async scrapeViaUI(page: Page, ultimoItemId?: string): Promise<FeedPost[]> {
    const posts: FeedPost[] = [];
    
    const postLinks = await page.locator('a[href^="/p/"], a[href^="/reel/"]').all();
    if (postLinks.length === 0) {
      logger.warn('Nenhum link de post encontrado na grade.');
      return posts;
    }

    logger.info('Abrindo a primeira publicação...');
    await postLinks[0].click();
    
    let count = 0;
    while (count < SCRAPER_CONFIG.MAX_POSTS) {
      await page.waitForSelector('article', { timeout: 10000 }).catch(() => null);
      await randomDelay(1500, 3000);
      
      const currentUrl = page.url();
      const shortcodeMatch = currentUrl.match(/\/(p|reel)\/([^\/]+)/);
      const shortcode = shortcodeMatch ? shortcodeMatch[2] : null;
      
      if (!shortcode) {
        logger.warn('Não foi possível extrair shortcode da URL da publicação.');
        break;
      }
      
      if (ultimoItemId && shortcode === ultimoItemId) {
        logger.info(`Encontrado último post sincronizado (${shortcode}). Parando scraping UI.`);
        break;
      }

      logger.info(`Extraindo post: ${shortcode}`);

      let publishedAt = new Date();
      try {
        const timeElement = await page.locator('article time').first();
        const datetime = await timeElement.getAttribute('datetime');
        if (datetime) {
          publishedAt = new Date(datetime);
        }
      } catch (e) {}

      let caption = '';
      try {
         caption = await page.locator('article h1').innerText({ timeout: 1000 }).catch(() => '');
         if (!caption) {
            caption = await page.locator('article span[dir="auto"]').first().innerText({ timeout: 1000 }).catch(() => '');
         }
      } catch(e) {}

      const mediaElements: FeedMedia[] = [];
      try {
         const hasVideo = await page.locator('article video').count() > 0;
         if (hasVideo) {
            const videoUrl = await page.locator('article video').first().getAttribute('src');
            const poster = await page.locator('article video').first().getAttribute('poster');
            mediaElements.push({
               type: 'video',
               url: videoUrl || '',
               thumbnail: poster || undefined
            });
         } else {
            const imgs = await page.locator('article img[style*="object-fit: cover"]').all();
            if (imgs.length > 0) {
                const src = await imgs[0].getAttribute('src');
                mediaElements.push({
                   type: 'image',
                   url: src || ''
                });
            } else {
                const firstImg = await page.locator('article img').first().getAttribute('src').catch(() => null);
                if (firstImg) {
                    mediaElements.push({
                        type: 'image',
                        url: firstImg
                    });
                }
            }
         }
      } catch (e) {}

      if (mediaElements.length > 0 && mediaElements[0].url) {
        posts.push({
          id: shortcode,
          shortcode,
          url: currentUrl,
          caption,
          publishedAt,
          media: mediaElements
        });
      }

      const nextButtons = await page.locator('svg[aria-label="Next"], svg[aria-label="Avançar"]').all();
      if (nextButtons.length === 0) {
         logger.info('Sem botão próximo (Next/Avançar).');
         break;
      }
      
      const nextButton = page.locator('svg[aria-label="Next"], svg[aria-label="Avançar"]').first().locator('..');
      
      if (await nextButton.count() > 0) {
         await nextButton.first().click();
      } else {
         break;
      }
      
      count++;
    }

    return posts;
  }
}
