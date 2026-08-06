import { startScheduler } from './scheduler';
import { db } from './database';
import { logger } from './logger';

let isWorkerInitialized = false;

export async function initWorker() {
  if (isWorkerInitialized) {
    logger.warn('Tentativa de iniciar o Worker ignorada: Worker já iniciado');
    return;
  }
  isWorkerInitialized = true;
  logger.info('Worker iniciado');
  
  try {
    // Conectar/Testar conexão ao carregar fontes ativas
    await db.getActiveFeedSources();
    logger.info('Conectado ao banco de dados com sucesso.');
    
    // Iniciar loop de processamento
    startScheduler();
  } catch (error) {
    logger.error('Erro ao inicializar o Worker', error);
  }
}
