import { supabase } from '../supabaseClient';
import { logger } from '../logger';

export class MetricsLogger {
  static async logSync(data: {
    perfil: string;
    tempo_ms: number;
    memoria_mb: number;
    cpu_percent: number;
    proxy_usado?: string;
    sessao_usada?: string;
    retries: number;
    status: string;
    posts_encontrados: number;
  }) {
    try {
      await supabase.from('instagram_sync_logs').insert([{
        ...data,
        data_hora: new Date().toISOString()
      }]);
    } catch (e) {
      logger.error('Erro ao salvar métricas no banco', e);
    }
  }
}
