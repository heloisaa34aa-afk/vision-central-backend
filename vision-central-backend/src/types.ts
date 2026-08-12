export interface FeedSource {
  id: string;
  playlist_id: string;
  tipo: 'instagram';
  perfil: string;
  intervalo_horas: number;
  horario_execucao?: string | null;
  timezone?: string | null;
  ativo: boolean;
  instagram_connection_id?: string | null;
  ultima_execucao?: string | null;
  ultimo_item_id?: string | null;
  proxima_execucao?: string | null;
  quantidade_importada?: number | null;
  status?: string | null;
  ultimo_erro?: string | null;
}

export interface InstagramConnection {
  id: string;
  instagram_user_id: string;
  username: string;
  encrypted_access_token: string;
  token_expires_at?: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  last_used_at?: string | null;
}
