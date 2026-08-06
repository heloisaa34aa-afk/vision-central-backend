import { InstagramScraper } from './scraper/instagram';
import { FeedPost } from './scraper/types';

export interface ScrapedPost {
  id: string;
  type: 'image' | 'video';
  mediaUrl: string;
  thumbnailUrl?: string;
}

export const scraper = {
  async run(tipo: string, perfil: string, ultimoItemId?: string): Promise<ScrapedPost[]> {
    if (tipo !== 'instagram') {
      throw new Error(`Scraper para o tipo '${tipo}' não implementado.`);
    }

    const instagramScraper = new InstagramScraper();
    const { status, posts } = await instagramScraper.getPosts(perfil, ultimoItemId);
    
    if (status === 'SUCCESS') {
      const flattenedPosts: ScrapedPost[] = [];
      for (const post of posts) {
        if (post.media && post.media.length > 0) {
          // For carousels, map each media to a separate post
          for (let i = 0; i < post.media.length; i++) {
            const media = post.media[i];
            flattenedPosts.push({
              id: `${post.shortcode}_${i}`, // Using shortcode_index to maintain uniqueness
              type: media.type,
              mediaUrl: media.url,
              thumbnailUrl: media.thumbnail
            });
          }
        }
      }
      return flattenedPosts;
    }
    
    return [];
  }
};


