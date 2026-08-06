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
    const posts = await scraper.run(source.tipo, source.perfil, ultimoItemId, source.instagram_connection_id);

    let newPosts = 0;
    let ignoredPosts = 0;
    let processingError: Error | null = null;
    // O item só pode ser marcado como processado depois de ser salvo no banco.
    let newLatestItemId = ultimoItemId;
    
    logger.info(`Quantidade de posts encontrados: ${posts.length}`);

    // A fonte representa sempre a publicacao mais recente. Atualizamos um
    // unico item estavel na playlist para evitar crescimento infinito e para
    // o player trocar de conteudo sem mudar a ordem configurada.
    const latestPost = posts[0];
    if (latestPost) {
      const chunks = chunkArray([latestPost], 1);
      for (const chunk of chunks) {
        await Promise.all(chunk.map(async (post: any) => {
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
          const extension = contentType.includes('video') ? 'mp4' : contentType.includes('png') ? 'png' : 'jpg';
          const fileName = `feed/${source.tipo}/${source.id}/${year}/${month}/${post.id}-${Date.now()}.${extension}`;
          
          logger.info(`Upload iniciado`, { id: post.id, arquivo: fileName });
          const publicUrl = await storage.uploadMedia(buffer, fileName, contentType);
          logger.info(`Upload concluído`, { id: post.id, caminho_salvo: fileName, bucket: 'midias', url: publicUrl });

          const prefix = source.tipo.toUpperCase();
          const saved = await db.saveLatestFeedMedia({
            sourceId: source.id,
            playlistId: source.playlist_id,
            itemId: post.id,
            name: `${prefix} @${source.perfil} - postagem mais recente`,
            type: post.type,
            publicUrl,
            storagePath: fileName,
          });
          logger.info(`Midia dinamica atualizada`, { midia_id: saved.mediaId, playlist_id: source.playlist_id, shortcode: post.id });
          if (saved.previousStoragePath && saved.previousStoragePath !== fileName) {
            await storage.removeMedia(saved.previousStoragePath).catch(error => logger.warn('Nao foi possivel limpar a midia anterior', error));
          }
          newPosts++;
          newLatestItemId = post.id.split('_')[0];
        } catch (err: any) {
          processingError = err instanceof Error ? err : new Error(String(err));
          logger.warn(`Erro ao processar post ${post.id}`, err.message);
        }
        }));
      }
    }

    if (latestPost && newPosts === 0 && ignoredPosts === 0 && processingError) {
      throw processingError;
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
