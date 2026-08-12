import { Page } from 'playwright';
import { FeedProvider, FeedPost, FeedMedia } from './types';
import { BrowserManager } from './browser';
import { parseNetworkResponse } from './parser';
import { SCRAPER_CONFIG } from './config';
import { deduplicatePosts, randomDelay } from '../utils';
import { logger } from '../logger';

export class InstagramScraper implements FeedProvider {
  async getPosts(perfil: string, ultimoItemId?: string): Promise<{ status: string; posts: FeedPost[] }> {
    const browserManager = BrowserManager.getInstance();
    let session: Awaited<ReturnType<BrowserManager['createSession']>> | null = null;
    const networkPosts: FeedPost[] = [];

    try {
      // Public scraping only: no customer password and no OAuth token is sent to the browser.
      session = await browserManager.createSession(null, null);
      const { page } = session;
      page.on('response', async response => {
        if (!response.url().includes('/graphql/query') && !response.url().includes('/api/v1/feed/user/')) return;
        try { networkPosts.push(...parseNetworkResponse(await response.json())); } catch { /* response was not JSON */ }
      });

      const profileUrl = `https://www.instagram.com/${encodeURIComponent(perfil)}/`;
      const response = await page.goto(profileUrl, {
        waitUntil: 'domcontentloaded',
        timeout: SCRAPER_CONFIG.REQUEST_TIMEOUT,
      });
      if (response?.status() === 404) return { status: 'NOT_FOUND', posts: [] };

      await randomDelay(1_000, 2_000);
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const privateProfile = bodyText.includes('This Account is Private') ||
        bodyText.includes('Esta conta é privada');
      if (privateProfile) return { status: 'PRIVATE', posts: [] };

      const firstHref = await page
        .locator('a[href^="/p/"], a[href^="/reel/"]')
        .first()
        .getAttribute('href')
        .catch(() => null);

      if (!firstHref) {
        const loginWall = page.url().includes('/accounts/login') ||
          bodyText.includes('Log in to Instagram') ||
          bodyText.includes('Faça login no Instagram');
        if (loginWall) return { status: 'LOGIN_WALL', posts: [] };

        const fallback = this.normalizeNetworkPosts(networkPosts, ultimoItemId);
        return { status: fallback.length > 0 ? 'SUCCESS' : 'ERROR', posts: fallback };
      }

      const post = await this.readLatestPost(page, firstHref, ultimoItemId);
      if (post) return { status: 'SUCCESS', posts: [post] };

      const fallback = this.normalizeNetworkPosts(networkPosts, ultimoItemId);
      return { status: fallback.length > 0 ? 'SUCCESS' : 'ERROR', posts: fallback };
    } catch (error: any) {
      logger.error(`Erro ao consultar perfil publico @${perfil}`, error);
      return { status: 'ERROR', posts: [] };
    } finally {
      if (session) await browserManager.closeSession(session.context, session.page);
    }
  }

  private normalizeNetworkPosts(posts: FeedPost[], ultimoItemId?: string): FeedPost[] {
    const normalized = deduplicatePosts(posts)
      .filter(post => !ultimoItemId || post.shortcode !== ultimoItemId)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    return normalized.slice(0, 1);
  }

  private async readLatestPost(page: Page, href: string, ultimoItemId?: string): Promise<FeedPost | null> {
    const shortcode = href.match(/\/(?:p|reel)\/([^/?#]+)/)?.[1];
    if (!shortcode || shortcode === ultimoItemId) return null;

    const postUrl = new URL(href, 'https://www.instagram.com').toString();
    logger.info(`Abrindo publicacao mais recente: ${shortcode}`);
    await page.goto(postUrl, {
      waitUntil: 'domcontentloaded',
      timeout: SCRAPER_CONFIG.REQUEST_TIMEOUT,
    });
    await page.waitForSelector('article, meta[property="og:image"]', { timeout: 10_000 }).catch(() => null);
    await randomDelay(800, 1_500);

    const publishedValue = await page.locator('article time').first().getAttribute('datetime').catch(() => null);
    const caption = await page.locator('meta[property="og:description"]').getAttribute('content').catch(() => '') || '';
    const videoUrl = await page
      .locator('meta[property="og:video:secure_url"], meta[property="og:video"]')
      .first().getAttribute('content').catch(() => null)
      || await page.locator('article video').first().getAttribute('src').catch(() => null);
    const imageUrl = await page.locator('meta[property="og:image"]').first().getAttribute('content').catch(() => null)
      || await page.locator('article img').evaluateAll(images => {
        const ranked = images
          .map(element => {
            const image = element as HTMLImageElement;
            return { src: image.currentSrc || image.src, area: image.naturalWidth * image.naturalHeight };
          })
          .filter(image => Boolean(image.src))
          .sort((a, b) => b.area - a.area);
        return ranked[0]?.src || null;
      }).catch(() => null);

    const media: FeedMedia[] = videoUrl
      ? [{ type: 'video', url: videoUrl, thumbnail: imageUrl || undefined }]
      : imageUrl ? [{ type: 'image', url: imageUrl }] : [];
    if (media.length === 0) return null;

    return {
      id: shortcode,
      shortcode,
      url: postUrl,
      caption,
      publishedAt: publishedValue ? new Date(publishedValue) : new Date(),
      media,
    };
  }
}
