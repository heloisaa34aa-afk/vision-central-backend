import { supabase } from '../supabaseClient';
import { logger } from '../logger';

export interface ProxyConfig {
  id: string;
  url: string;
  status: 'ACTIVE' | 'FAILED';
  usage_count: number;
}

export class ProxyManager {
  async getNextProxy(): Promise<ProxyConfig | null> {
    try {
      const { data, error } = await supabase
        .from('proxies')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('usage_count', { ascending: true })
        .limit(1)
        .single();
      
      if (error || !data) return null;
      
      await supabase.from('proxies').update({ usage_count: data.usage_count + 1 }).eq('id', data.id);
      return data;
    } catch (e) {
      return null;
    }
  }

  async markFailed(id: string) {
    try {
      await supabase.from('proxies').update({ status: 'FAILED' }).eq('id', id);
      logger.info(`Proxy ${id} marcado como falho`);
    } catch (e) {
      // ignore
    }
  }
}
