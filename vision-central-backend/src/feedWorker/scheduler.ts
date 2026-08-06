import { db } from './database';
import { logger } from './logger';
import { syncFeedSource } from './syncFeed';

// Intervalo de verificação: 5 minutos
const CHECK_INTERVAL = 5 * 60 * 1000;

let schedulerIntervalId: NodeJS.Timeout | null = null;

export function startScheduler() {
  if (schedulerIntervalId !== null) {
    logger.warn('Tentativa de iniciar o Scheduler ignorada: Scheduler já iniciado');
    return;
  }
  logger.info('Scheduler iniciado');

  // Executa o primeiro check imediatamente, e depois a cada 5 min
  checkSources();
  schedulerIntervalId = setInterval(checkSources, CHECK_INTERVAL);
}

async function checkSources() {
  try {
    logger.info('Scheduler executando');
    const sources = await db.getActiveFeedSourcesToSync();
    logger.info(`Quantidade de fontes encontradas: ${sources.length}`);

    for (const source of sources) {
      // Processar uma fonte por vez (await)
      await syncFeedSource(source);
    }
  } catch (error: any) {
    logger.error('Erro no ciclo do scheduler', { mensagem: error.message });
  }
}
