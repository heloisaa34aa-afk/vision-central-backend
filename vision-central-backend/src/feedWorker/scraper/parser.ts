import { FeedPost, FeedMedia } from './types';
import { logger } from '../logger';

export function parseNetworkResponse(responseJson: any): FeedPost[] {
  const posts: FeedPost[] = [];
  try {
    // Tenta encontrar a estrutura de dados do Instagram
    // Isso varia bastante, é apenas um parser genérico para o exemplo
    // Procurando nos edges de graphql ou na estrutura atual da API web do IG
    let items = [];

    // Estrutura 1: xdt_api__v1__feed__user_timeline_graphql_connection
    const timeline = responseJson?.data?.xdt_api__v1__feed__user_timeline_graphql_connection?.edges;
    if (timeline) {
      items = timeline.map((edge: any) => edge.node);
    } 
    // Estrutura 2: user.edge_owner_to_timeline_media
    else if (responseJson?.graphql?.user?.edge_owner_to_timeline_media?.edges) {
      items = responseJson.graphql.user.edge_owner_to_timeline_media.edges.map((e: any) => e.node);
    }
    // Estrutura 3: items array (API v1)
    else if (responseJson?.items) {
      items = responseJson.items;
    }

    for (const item of items) {
      const post = parseItem(item);
      if (post) posts.push(post);
    }
  } catch (error: any) {
    logger.error('Erro ao parsear resposta de rede', error);
  }
  return posts;
}

function parseItem(item: any): FeedPost | null {
  try {
    const id = item.id || item.pk;
    const shortcode = item.shortcode || item.code;
    
    if (!id || !shortcode) return null;

    let caption = '';
    if (item.caption?.text) {
      caption = item.caption.text;
    } else if (item.edge_media_to_caption?.edges?.[0]?.node?.text) {
      caption = item.edge_media_to_caption.edges[0].node.text;
    }

    let publishedAt = new Date();
    if (item.taken_at) {
      publishedAt = new Date(item.taken_at * 1000);
    } else if (item.taken_at_timestamp) {
      publishedAt = new Date(item.taken_at_timestamp * 1000);
    }

    const likes = item.like_count || item.edge_media_preview_like?.count || 0;
    const comments = item.comment_count || item.edge_media_to_comment?.count || 0;

    const media: FeedMedia[] = [];

    // Carrossel
    if (item.carousel_media || item.edge_sidecar_to_children) {
      const children = item.carousel_media || item.edge_sidecar_to_children?.edges?.map((e: any) => e.node) || [];
      for (const child of children) {
        media.push(parseMediaNode(child));
      }
    } else {
      // Única mídia
      media.push(parseMediaNode(item));
    }

    return {
      id: String(id),
      shortcode,
      url: `https://www.instagram.com/p/\${shortcode}/`,
      caption,
      publishedAt,
      media,
      likes,
      comments
    };
  } catch (error) {
    return null;
  }
}

function parseMediaNode(node: any): FeedMedia {
  const isVideo = node.media_type === 2 || node.is_video;
  const url = isVideo ? (node.video_versions?.[0]?.url || node.video_url) : (node.image_versions2?.candidates?.[0]?.url || node.display_url);
  const thumbnail = isVideo ? (node.image_versions2?.candidates?.[0]?.url || node.display_url) : undefined;
  
  return {
    type: isVideo ? 'video' : 'image',
    url: url || '',
    thumbnail
  };
}

export async function parseHtmlFallback(page: any): Promise<FeedPost[]> {
  logger.info('Iniciando fallback HTML parse');
  // Em uma implementação real do fallback, iteraríamos os elementos da página (artigos).
  // Devido à complexidade e mudanças frequentes do DOM, o parser da network é mais robusto.
  // Vamos retornar vazio neste mockup.
  return [];
}
