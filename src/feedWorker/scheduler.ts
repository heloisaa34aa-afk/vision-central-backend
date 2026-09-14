import { db } from './database';
import { logger } from './logger';

// Intervalo de verificação: 5 minutos
const CHECK_INTERVAL = 5 * 60 * 1000;

let schedulerIntervalId: NodeJS.Timeout | null = null;
let cycleRunning = false;

export function startScheduler() {
  if (schedulerIntervalId !== null) {
    logger.warn('Tentativa de iniciar o Scheduler ignorada: Scheduler já iniciado');
    return;
  }
  logger.info('Scheduler iniciado');

  // Executa o primeiro check imediatamente, e depois a cada 5 min
  runDueSources('startup');
  schedulerIntervalId = setInterval(() => void runDueSources('internal'), CHECK_INTERVAL);
}

function normalizeProfile(value: string) {
  return value.trim().replace(/^@+/, '').toLowerCase();
}

export async function runDueSources(origin = 'manual-cron'): Promise<{ started: boolean; sources: number; profiles: number }> {
  if (cycleRunning) {
    logger.warn(`Ciclo do scheduler ignorado (${origin}): outro ciclo esta em andamento.`);
    return { started: false, sources: 0, profiles: 0 };
  }

  cycleRunning = true;
  try {
    logger.info(`Scheduler executando (${origin})`);
    const sources = await db.getActiveFeedSourcesToSync();
    logger.info(`Quantidade de fontes encontradas: ${sources.length}`);

    const groups = new Map<string, typeof sources>();
    for (const source of sources) {
      const profile = normalizeProfile(source.perfil);
      groups.set(profile, [...(groups.get(profile) || []), source]);
    }

    for (const [profile, profileSources] of groups) {
      for (const source of profileSources) {
        await db.enqueueFeedJob(source.id);
        await db.updateFeedSource(source.id, { status: 'queued', ultimo_erro: null });
      }
      logger.info(`Perfil colocado na fila do coletor`, { perfil: profile, fontes: profileSources.length });
    }
    return { started: true, sources: sources.length, profiles: groups.size };
  } catch (error: any) {
    logger.error('Erro no ciclo do scheduler', { mensagem: error.message });
    throw error;
  } finally {
    cycleRunning = false;
  }
}
