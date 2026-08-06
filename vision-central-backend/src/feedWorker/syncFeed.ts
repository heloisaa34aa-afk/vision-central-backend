import { FeedSource } from '../types';
import { logger } from './logger';
import { db } from './database';
import { downloadMedia } from './downloadMedia';
import { storage } from './storage';
import { scraper } from './scraper';
import { chunkArray } from './utils';

// Para controle de concorrência
const activeSyncs = new Set<string>();

export async function syncFeedSource(sourceOrId: FeedSource | string) {
  let source: FeedSource;

  if (typeof sourceOrId === 'string') {
    try {
      const data = await db.getFeedSourceById(sourceOrId);
      if (!data) {
        logger.error(`Fonte de feed não encontrada para o id: ${sourceOrId}`);
        return;
      }
      source = data;
    } catch (err: any) {
      logger.error(`Erro ao buscar fonte de feed para o id: ${sourceOrId}`, err);
      return;
    }
  } else {
    source = sourceOrId;
  }

  if (activeSyncs.has(source.id)) {
    logger.info(`Sincronização já em andamento para o perfil: ${source.perfil}`);
    return;
  }

  activeSyncs.add(source.id);
  const startTime = Date.now();

  try {
    logger.info(`Iniciando sincronização`, { perfil: source.perfil, playlist: source.playlist_id, ultimo_item_id: source.ultimo_item_id });

    // 1. Executar Scraper
    let ultimoItemId = source.ultimo_item_id || undefined;
    const posts = await scraper.run(source.tipo, source.perfil, ultimoItemId);

    let newPosts = 0;
    let ignoredPosts = 0;
    // O scraper retorna os posts mais recentes primeiro. O primeiro shortcode inédito será nosso novo ultimo_item_id.
    let newLatestItemId = ultimoItemId;
    if (posts.length > 0) {
      // Como pode ter múltiplas mídias com o mesmo shortcode, pegamos o id do primeiro post retornado.
      newLatestItemId = posts[0].id.split('_')[0]; 
    }
    
    logger.info(`Quantidade de posts encontrados: ${posts.length}`);

    const chunks = chunkArray(posts, 3);
    
    for (const chunk of chunks) {
      await Promise.all(chunk.map(async (post: any, index: number) => {
        // Se a mídia já foi sincronizada ou está anterior ao shortcode (já tratado no scraper), apenas garanta segurança
        if (ultimoItemId && post.id.startsWith(ultimoItemId)) {
          ignoredPosts++;
          return;
        }

        try {
          logger.info(`Download iniciado`, { id: post.id, url: post.mediaUrl });
          const { buffer, contentType } = await downloadMedia(post.mediaUrl);
          logger.info(`Download concluído`, { id: post.id, tamanho: buffer.byteLength, tipo: contentType });

          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const fileName = `feed/${source.tipo}/${source.perfil}/${year}/${month}/${post.id}-${Date.now()}`;
          
          logger.info(`Upload iniciado`, { id: post.id, arquivo: fileName });
          const publicUrl = await storage.uploadMedia(buffer, fileName, contentType);
          logger.info(`Upload concluído`, { id: post.id, caminho_salvo: fileName, bucket: 'midias', url: publicUrl });

          const prefix = source.tipo.toUpperCase();
          const midia = await db.createMidia({
            nome: `${prefix} @${source.perfil} - ${post.id}`,
            tipo: post.type,
            url_storage: publicUrl,
            duracao: post.type === 'video' ? 15 : 10,
          });
          logger.info(`Registro criado em midias`, { midia_id: midia.id, playlist_id: source.playlist_id, url: publicUrl, shortcode: post.id });

          await db.linkMidiaToPlaylist(source.playlist_id, midia.id, 0);
          logger.info(`Relacionamento criado em playlist_midias`, { playlist_id: source.playlist_id, midia_id: midia.id, ordem: 0 });
          newPosts++;
        } catch (err: any) {
          logger.warn(`Erro ao processar post ${post.id}`, err.message);
        }
      }));
    }

    const timeTaken = Math.round((Date.now() - startTime) / 1000);

    logger.info(`Sincronização concluída`, {
      perfil: source.perfil,
      posts_encontrados: posts.length,
      novos: newPosts,
      ignorados: ignoredPosts,
      tempo: `${timeTaken} segundos`,
      status: 'Sucesso'
    });

    const proximaExecucao = new Date(Date.now() + source.intervalo_horas * 60 * 60 * 1000).toISOString();
    logger.info(`Próxima execução calculada`, { proxima_execucao: proximaExecucao });

    // Atualizar registro no banco
    await db.updateFeedSource(source.id, {
      ultima_execucao: new Date().toISOString(),
      ultimo_item_id: newLatestItemId || null,
      proxima_execucao: proximaExecucao,
      quantidade_importada: (source.quantidade_importada || 0) + newPosts,
      status: 'success',
      ultimo_erro: null
    });
    logger.info(`Feed atualizado`);

  } catch (error: any) {
    logger.error('Erro na sincronização', {
      perfil: source.perfil,
      horario: new Date().toISOString(),
      mensagem: error.message,
      stack: error.stack
    });
    await db.updateFeedSource(source.id, {
      status: 'error',
      ultimo_erro: error.message
    });
  } finally {
    activeSyncs.delete(source.id);
  }
}
