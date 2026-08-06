import { FeedSource } from '../types';
import { supabase } from './supabaseClient';

export const db = {
  async getFeedSourceById(id: string): Promise<FeedSource | null> {
    const { data, error } = await supabase
      .from('feed_sources')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async getActiveFeedSourcesToSync(): Promise<FeedSource[]> {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('feed_sources')
      .select('*')
      .eq('ativo', true)
      .or(`proxima_execucao.lte.${now},proxima_execucao.is.null`);
    if (error) throw error;
    return data || [];
  },

  async getActiveFeedSources(): Promise<FeedSource[]> {
    const { data, error } = await supabase
      .from('feed_sources')
      .select('*')
      .eq('ativo', true);
    if (error) throw error;
    return data || [];
  },
  
  async updateFeedSource(id: string, updates: Partial<FeedSource>) {
    const { error } = await supabase
      .from('feed_sources')
      .update(updates)
      .eq('id', id);
    if (error) throw error;
  },
  
  async createMidia(midia: any) {
    const { data, error } = await supabase
      .from('midias')
      .insert(midia)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  
  async linkMidiaToPlaylist(playlistId: string, midiaId: string, ordem: number) {
    const { error } = await supabase
      .from('playlist_midias')
      .insert({
        playlist_id: playlistId,
        midia_id: midiaId,
        ordem,
        duracao: 15
      });
    if (error) throw error;
    
    // Increment config_revision to trigger Android sync
    try {
      await supabase.rpc('increment_playlist_revision', { p_id: playlistId });
    } catch(e) {
      // ignore if RPC doesn't exist yet, try direct update
      const { data: p } = await supabase.from('playlists').select('config_revision').eq('id', playlistId).single();
      if (p) {
        await supabase.from('playlists').update({ config_revision: (p.config_revision || 0) + 1 }).eq('id', playlistId);
      }
    }
  }
};
