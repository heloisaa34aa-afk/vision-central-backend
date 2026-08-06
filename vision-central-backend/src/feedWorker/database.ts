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
      .upsert(midia, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getFeedMediaSlot(sourceId: string) {
    const { data, error } = await supabase
      .from('feed_source_media')
      .select('*')
      .eq('source_id', sourceId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async saveLatestFeedMedia(params: {
    sourceId: string;
    playlistId: string;
    itemId: string;
    name: string;
    type: 'image' | 'video';
    publicUrl: string;
    storagePath: string;
  }) {
    const existing = await this.getFeedMediaSlot(params.sourceId);
    let mediaId = existing?.midia_id as string | undefined;

    if (mediaId) {
      const { error } = await supabase.from('midias').update({
        nome: params.name,
        tipo: params.type,
        origem: 'storage',
        url_storage: params.publicUrl,
        url_externa: null,
        duracao: params.type === 'video' ? 15 : 10,
      }).eq('id', mediaId);
      if (error) throw error;
    } else {
      mediaId = `m-feed-${params.sourceId}`;
      const { data: playlist, error: playlistError } = await supabase
        .from('playlists')
        .select('cliente_id')
        .eq('id', params.playlistId)
        .single();
      if (playlistError) throw playlistError;

      const media = await this.createMidia({
        id: mediaId,
        cliente_id: playlist.cliente_id,
        nome: params.name,
        tipo: params.type,
        origem: 'storage',
        url_storage: params.publicUrl,
        url_externa: null,
        duracao: params.type === 'video' ? 15 : 10,
      });
      mediaId = String(media.id);
      await this.linkMidiaToPlaylist(
        params.playlistId,
        mediaId,
        0,
        `pm-feed-${params.sourceId}`,
      );
    }

    const { error: slotError } = await supabase.from('feed_source_media').upsert({
      source_id: params.sourceId,
      midia_id: mediaId,
      instagram_item_id: params.itemId,
      storage_path: params.storagePath,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source_id' });
    if (slotError) throw slotError;

    await this.touchPlaylistDevices(params.playlistId);
    return { mediaId, previousStoragePath: existing?.storage_path as string | undefined };
  },

  async touchPlaylistDevices(playlistId: string) {
    const tvIds = new Set<string>();
    const { data: directTvs } = await supabase.from('tvs').select('id,config_revision').eq('playlist_id', playlistId);
    for (const tv of directTvs || []) tvIds.add(tv.id);

    const { data: clients } = await supabase.from('clientes').select('id').eq('playlist_id', playlistId);
    const clientIds = (clients || []).map(client => client.id);
    if (clientIds.length > 0) {
      const { data: inheritedTvs } = await supabase.from('tvs').select('id,config_revision').in('cliente_id', clientIds).is('playlist_id', null);
      for (const tv of inheritedTvs || []) tvIds.add(tv.id);
    }

    for (const id of tvIds) {
      const { data: tv } = await supabase.from('tvs').select('config_revision').eq('id', id).single();
      await supabase.from('tvs').update({
        config_revision: Number(tv?.config_revision || 0) + 1,
        ultima_sincronizacao: new Date().toISOString(),
      }).eq('id', id);
    }
  },
  
  async linkMidiaToPlaylist(playlistId: string, midiaId: string, ordem: number, relationId?: string) {
    const { error } = await supabase
      .from('playlist_midias')
      .upsert({
        id: relationId || `pm-${playlistId}-${midiaId}-${Date.now()}`,
        playlist_id: playlistId,
        midia_id: midiaId,
        ordem,
        duracao: 15
      }, { onConflict: 'id' });
    if (error) throw error;
    
    await this.touchPlaylistDevices(playlistId);
  }
};
