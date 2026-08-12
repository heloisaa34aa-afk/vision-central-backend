import { InstagramScraper } from './scraper/instagram';

export interface ScrapedPost {
  id: string;
  type: 'image' | 'video';
  mediaUrl: string;
  thumbnailUrl?: string;
}

const publicScraper = new InstagramScraper();
const profileCache = new Map<string, { createdAt: number; posts: ScrapedPost[] }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function normalizeProfile(value: string): string {
  const profile = value.trim().replace(/^@+/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(profile)) {
    throw new Error('Perfil do Instagram invalido. Informe somente o @ do perfil.');
  }
  return profile;
}

export const scraper = {
  async run(tipo: string, perfil: string, ultimoItemId?: string, _connectionId?: string | null): Promise<ScrapedPost[]> {
    if (tipo !== 'instagram') {
      throw new Error(`Scraper para o tipo '${tipo}' não implementado.`);
    }

    const normalizedProfile = normalizeProfile(perfil);
    const cached = profileCache.get(normalizedProfile);
    let publicPosts: ScrapedPost[];

    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
      publicPosts = cached.posts;
    } else {
      const result = await publicScraper.getPosts(normalizedProfile);
      if (result.status === 'PRIVATE') throw new Error('Perfil privado ou indisponivel para consulta publica.');
      if (result.status === 'NOT_FOUND') throw new Error('Perfil do Instagram nao encontrado.');
      if (result.status === 'LOGIN_WALL') throw new Error('Instagram bloqueou temporariamente a consulta publica.');
      if (result.status !== 'SUCCESS') throw new Error('Nao foi possivel consultar o perfil publico agora.');

      publicPosts = result.posts.slice(0, 1).flatMap(post => {
        const media = post.media.find(item => Boolean(item.url)) || post.media.find(item => Boolean(item.thumbnail));
        if (!media) return [];
        const useVideo = media.type === 'video' && Boolean(media.url);
        return [{
          id: `${post.shortcode}_0`,
          type: useVideo ? 'video' as const : 'image' as const,
          mediaUrl: useVideo ? media.url : (media.url || media.thumbnail || ''),
          thumbnailUrl: media.thumbnail,
        }];
      });
      profileCache.set(normalizedProfile, { createdAt: Date.now(), posts: publicPosts });
    }

    if (publicPosts.length > 0) {
      const latestId = publicPosts[0].id.split('_')[0];
      return ultimoItemId === latestId ? [] : publicPosts;
    }
    return [];
  }
};
