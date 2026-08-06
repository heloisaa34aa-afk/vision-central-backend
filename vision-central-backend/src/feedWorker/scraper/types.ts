export interface FeedMedia {
  type: 'image' | 'video';
  url: string;
  thumbnail?: string;
  width?: number;
  height?: number;
}

export interface FeedPost {
  id: string;
  shortcode: string;
  url: string;
  caption: string;
  publishedAt: Date;
  media: FeedMedia[];
  likes?: number;
  comments?: number;
  location?: string;
}

export interface FeedProvider {
  getPosts(perfil: string): Promise<{ status: string; posts: FeedPost[] }>;
  // Outros métodos conforme interface solicitada se necessário
  // downloadMedia()
  // normalize()
}
