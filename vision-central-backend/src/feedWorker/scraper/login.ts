import { chromium, Page } from 'playwright';
import { SessionManager } from './sessionManager';
import { logger } from '../logger';
import { SCRAPER_CONFIG } from './config';
import * as fs from 'fs';

export interface LoginResult {
  success: boolean;
  reason?: string;
  url?: string;
  selectorFound?: string;
}

async function findFirstExistingSelector(page: Page, selectors: string[]): Promise<string | null> {
  const combined = selectors.join(', ');
  try {
    await page.waitForSelector(combined, { timeout: 15000 });
  } catch (e) {
    return null;
  }
  
  for (const sel of selectors) {
    if (await page.locator(sel).count() > 0) {
      return sel;
    }
  }
  return null;
}

export async function loginToInstagram(): Promise<LoginResult> {
  logger.info(`[LOGIN] Abrindo navegador para login manual`);
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    const startUrl = 'https://www.instagram.com/accounts/login/';
    logger.info(`[LOGIN] Acessando URL inicial: ${startUrl}`);
    await page.goto(startUrl, { waitUntil: 'networkidle' });
    
    logger.info(`[LOGIN] Aguardando o usuário realizar o login manualmente e resolver desafios (captcha, 2FA)...`);
    
    let isSuccess = false;
    let finalUrl = '';
    const maxWaitTime = 5 * 60 * 1000; // 5 minutos de tolerância para resolver desafios
    const checkInterval = 2000; // checa a cada 2 segundos
    let elapsedTime = 0;

    while (elapsedTime < maxWaitTime) {
      if (page.isClosed()) {
        logger.error(`[LOGIN] Navegador fechado pelo usuário antes da conclusão.`);
        return { success: false, reason: 'Navegador fechado prematuramente' };
      }
      
      finalUrl = page.url();
      const isFeedRedirect = finalUrl === 'https://www.instagram.com/' || finalUrl.startsWith('https://www.instagram.com/?');
      
      const isHome = await page.evaluate(() => !!document.querySelector('svg[aria-label="Home"], svg[aria-label="Página inicial"]')).catch(() => false);
      const isSaveLogin = await page.evaluate(() => {
        const text = document.body.innerText || '';
        return text.toLowerCase().includes('save your login info') || 
               text.toLowerCase().includes('salvar suas informações de login') || 
               text.toLowerCase().includes('save info') || 
               text.toLowerCase().includes('salvar informações');
      }).catch(() => false);
      const isNotifications = await page.evaluate(() => {
        const text = document.body.innerText || '';
        return text.toLowerCase().includes('turn on notifications') || 
               text.toLowerCase().includes('ativar notificações');
      }).catch(() => false);

      if (isFeedRedirect || isHome || isSaveLogin || isNotifications) {
        logger.info(`[LOGIN] Condição de sucesso atingida. Tela final detectada.`);
        isSuccess = true;
        break;
      }

      await page.waitForTimeout(checkInterval);
      elapsedTime += checkInterval;
    }

    if (!isSuccess) {
      logger.error(`[LOGIN] Tempo limite excedido aguardando login manual.`);
      return { success: false, reason: 'Tempo limite excedido' };
    }

    const userAgent = await page.evaluate(() => navigator.userAgent);
    const sessionManager = new SessionManager();
    const globalUsername = 'global_session';
    await sessionManager.saveSession(globalUsername, context, userAgent);
    logger.info(`[LOGIN] Login manual concluído com sucesso e sessão criptografada gravada na nuvem.`);
    
    return { success: true, url: finalUrl };
  } catch (error: any) {
    logger.error(`[LOGIN] Erro durante o login manual no Instagram: ${error.message}`);
    return { success: false, reason: error.message };
  } finally {
    await browser.close().catch(() => {});
  }
}
