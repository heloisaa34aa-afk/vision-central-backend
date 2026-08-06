import { instagramGraph } from './instagramGraph';

export interface ScrapedPost {
  id: string;
  type: 'image' | 'video';
  mediaUrl: string;
  thumbnailUrl?: string;
}

export const scraper = {
  async run(tipo: string, perfil: string, ultimoItemId?: string, connectionId?: string | null): Promise<ScrapedPost[]> {
    if (tipo !== 'instagram') {
      throw new Error(`Scraper para o tipo '${tipo}' não implementado.`);
    }

    if (!connectionId) {
      throw new Error('Conecte uma conta profissional do Instagram e associe-a a esta fonte.');
    }

    const officialPosts = await instagramGraph.getLatestMedia(connectionId);
    if (officialPosts.length > 0) {
      const latestId = officialPosts[0].id.split('_')[0];
      return ultimoItemId === latestId ? [] : officialPosts;
    }
    return [];
  }
};
