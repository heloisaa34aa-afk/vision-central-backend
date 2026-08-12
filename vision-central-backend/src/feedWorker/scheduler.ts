import { db } from './database';
import { logger } from './logger';
import { syncFeedSource } from './syncFeed';

// Intervalo de verificação: 5 minutos
const CHECK_INTERVAL = 5 * 60 * 1000;
const PROFILE_DELAY_MS = Math.max(5_000, Number(process.env.INSTAGRAM_PROFILE_DELAY_MS || 45_000));

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

function wait(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
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

    let groupIndex = 0;
    for (const [profile, profileSources] of groups) {
      if (groupIndex > 0) {
        logger.info(`Aguardando intervalo seguro antes de consultar @${profile}`, { milliseconds: PROFILE_DELAY_MS });
        await wait(PROFILE_DELAY_MS);
      }
      // Fontes repetidas usam o cache em memoria do scraper; o perfil e consultado uma vez.
      for (const source of profileSources) await syncFeedSource(source);
      groupIndex++;
    }
    return { started: true, sources: sources.length, profiles: groups.size };
  } catch (error: any) {
    logger.error('Erro no ciclo do scheduler', { mensagem: error.message });
    throw error;
  } finally {
    cycleRunning = false;
  }
}
