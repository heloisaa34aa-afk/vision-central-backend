import { supabase } from '../supabaseClient';
import { encrypt, decrypt } from './crypto';
import { logger } from '../logger';
import { BrowserContext } from 'playwright';

export interface InstagramSession {
  id: string;
  username: string;
  encrypted_cookies: string;
  user_agent: string;
  status: 'ACTIVE' | 'INVALID' | 'EXPIRED';
  last_used_at: string;
}

export class SessionManager {
  async getActiveSession(): Promise<InstagramSession | null> {
    try {
      const { data, error } = await supabase
        .from('instagram_sessions')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('last_used_at', { ascending: true })
        .limit(1)
        .single();
      
      if (error || !data) return null;
      
      await supabase.from('instagram_sessions').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
      
      return data;
    } catch (e) {
      logger.error('Erro ao buscar sessão', e);
      return null;
    }
  }

  async saveSession(username: string, context: BrowserContext, userAgent: string) {
    try {
      const state = await context.storageState();
      const stateString = JSON.stringify(state);
      const encrypted = encrypt(stateString);
      
      const { data: existing } = await supabase
        .from('instagram_sessions')
        .select('id')
        .eq('username', username)
        .single();
        
      if (existing) {
        await supabase.from('instagram_sessions').update({
          encrypted_cookies: encrypted,
          user_agent: userAgent,
          status: 'ACTIVE',
          last_used_at: new Date().toISOString()
        }).eq('id', existing.id);
      } else {
        await supabase.from('instagram_sessions').insert({
          username,
          encrypted_cookies: encrypted,
          user_agent: userAgent,
          status: 'ACTIVE',
          last_used_at: new Date().toISOString()
        });
      }
      logger.info(`Sessão salva com sucesso para ${username}`);
    } catch (e: any) {
      logger.error(`Erro ao salvar sessão: ${e.message}`);
    }
  }

  async invalidateSession(id: string) {
    try {
      await supabase.from('instagram_sessions').update({ status: 'INVALID' }).eq('id', id);
      logger.info(`Sessão ${id} invalidada`);
    } catch (e) {
      logger.error('Erro ao invalidar sessão', e);
    }
  }

  async loadSessionToContext(session: InstagramSession, context: BrowserContext) {
    const decrypted = decrypt(session.encrypted_cookies);
    if (!decrypted) return false;
    
    try {
      const state = JSON.parse(decrypted);
      if (state.cookies && state.cookies.length > 0) {
        await context.addCookies(state.cookies);
      }
      return true;
    } catch (e) {
      return false;
    }
  }
}
