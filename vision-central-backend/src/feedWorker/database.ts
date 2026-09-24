import { FeedSource } from '../types';
import { supabase } from './supabaseClient';

export const db = {
  async enqueueFeedJob(sourceId: string, availableAt?: string) {
    const { data: existing } = await supabase.from('feed_jobs').select('*')
      .eq('source_id', sourceId).in('status', ['pending', 'processing']).maybeSingle();
    if (existing) return existing;
    const { data, error } = await supabase.from('feed_jobs').insert({
      source_id: sourceId,
      ...(availableAt ? { available_at: availableAt } : {}),
    }).select().single();
    if (error?.code === '23505') {
      const { data: raced, error: racedError } = await supabase.from('feed_jobs').select('*')
        .eq('source_id', sourceId).in('status', ['pending', 'processing']).single();
      if (racedError) throw racedError;
      return raced;
    }
    if (error) throw error;
    return data;
  },

  async claimFeedJob(workerId: string) {
    const { data, error } = await supabase.rpc('claim_feed_job', { p_worker_id: workerId, p_lock_seconds: 900 });
    if (error) throw error;
    return data?.[0] || null;
  },

  async getFeedJob(id: string) {
    const { data, error } = await supabase.from('feed_jobs').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async updateFeedJob(id: string, updates: Record<string, unknown>) {
    const { error } = await supabase.from('feed_jobs').update(updates).eq('id', id);
    if (error) throw error;
  },

  async getActiveFeedJobForSources(sourceIds: string[]) {
    if (sourceIds.length === 0) return null;
    const { data, error } = await supabase.from('feed_jobs').select('*')
      .in('source_id', sourceIds).in('status', ['pending', 'processing'])
      .order('requested_at', { ascending: true }).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  },

  async completeActiveFeedJobsForSources(sourceIds: string[], itemId: string) {
    if (sourceIds.length === 0) return;
    const { error } = await supabase.from('feed_jobs').update({
      status: 'completed', completed_at: new Date().toISOString(), result_item_id: itemId,
      locked_at: null, locked_by: null, lock_expires_at: null, error: null,
    }).in('source_id', sourceIds).in('status', ['pending', 'processing']);
    if (error) throw error;
  },

  async removeFeedSourceMedia(sourceId: string) {
    const slot = await this.getFeedMediaSlot(sourceId);
    const fallbackMediaId = `m-feed-${sourceId}`;
    let fallbackMedia: { id: string } | null = null;
    if (!slot?.midia_id) {
      const { data, error } = await supabase.from('midias').select('id').eq('id', fallbackMediaId).maybeSingle();
      if (error) throw error;
      fallbackMedia = data;
    }
    const mediaId = slot?.midia_id || fallbackMedia?.id;
    const playlistIds = new Set<string>();

    if (mediaId) {
      const { data: links, error: linksReadError } = await supabase
        .from('playlist_midias')
        .select('playlist_id')
        .eq('midia_id', mediaId);
      if (linksReadError) throw linksReadError;
      for (const link of links || []) {
        if (link.playlist_id) playlistIds.add(String(link.playlist_id));
      }

      const { error: linkError } = await supabase.from('playlist_midias').delete().eq('midia_id', mediaId);
      if (linkError) throw linkError;
      const { error: slotError } = await supabase.from('feed_source_media').delete().eq('source_id', sourceId);
      if (slotError) throw slotError;
      const { error: mediaError } = await supabase.from('midias').delete().eq('id', mediaId);
      if (mediaError) throw mediaError;
    }

    for (const playlistId of playlistIds) await this.touchPlaylistDevices(playlistId);
    return { storagePath: slot?.storage_path as string | undefined, playlistIds: [...playlistIds] };
  },

  async deactivateFeedSource(sourceId: string) {
    await this.updateFeedSource(sourceId, { ativo: false, status: 'inactive', ultimo_erro: null });
    const { error: jobsError } = await supabase.from('feed_jobs').delete().eq('source_id', sourceId);
    if (jobsError) throw jobsError;
    return this.removeFeedSourceMedia(sourceId);
  },

  async deleteFeedSourceAndMedia(sourceId: string) {
    const removed = await this.removeFeedSourceMedia(sourceId);
    const { error: jobsError } = await supabase.from('feed_jobs').delete().eq('source_id', sourceId);
    if (jobsError) throw jobsError;
    const { error: sourceError } = await supabase.from('feed_sources').delete().eq('id', sourceId);
    if (sourceError) throw sourceError;
    return removed;
  },
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
    durationSeconds?: number;
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
        duracao: params.type === 'video' ? Math.max(1, Math.ceil(params.durationSeconds || 15)) : 10,
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
        duracao: params.type === 'video' ? Math.max(1, Math.ceil(params.durationSeconds || 15)) : 10,
      });
      mediaId = String(media.id);
      await this.linkMidiaToPlaylist(
        params.playlistId,
        mediaId,
        0,
        `pm-feed-${params.sourceId}`,
        params.type === 'video' ? Math.max(1, Math.ceil(params.durationSeconds || 15)) : 10,
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

  async getActiveFeedSourcesByProfile(profile: string): Promise<FeedSource[]> {
    const normalized = profile.trim().replace(/^@+/, '').toLowerCase();
    const sources = await this.getActiveFeedSources();
    return sources.filter(source => source.perfil.trim().replace(/^@+/, '').toLowerCase() === normalized);
  },

  async updateFeedMediaDuration(sourceId: string, durationSeconds: number) {
    const slot = await this.getFeedMediaSlot(sourceId);
    if (!slot?.midia_id) return;
    const duration = Math.max(1, Math.ceil(durationSeconds));
    const { error: mediaError } = await supabase.from('midias').update({ duracao: duration }).eq('id', slot.midia_id);
    if (mediaError) throw mediaError;
    const { data: links, error: linkError } = await supabase.from('playlist_midias')
      .update({ duracao: duration })
      .eq('midia_id', slot.midia_id)
      .select('playlist_id');
    if (linkError) throw linkError;
    const playlistIds = new Set((links || []).map(link => String(link.playlist_id)).filter(Boolean));
    for (const playlistId of playlistIds) await this.touchPlaylistDevices(playlistId);
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
  
  async linkMidiaToPlaylist(playlistId: string, midiaId: string, ordem: number, relationId?: string, duration = 15) {
    const { error } = await supabase
      .from('playlist_midias')
      .upsert({
        id: relationId || `pm-${playlistId}-${midiaId}-${Date.now()}`,
        playlist_id: playlistId,
        midia_id: midiaId,
        ordem,
        duracao: duration
      }, { onConflict: 'id' });
    if (error) throw error;
    
    await this.touchPlaylistDevices(playlistId);
  }
};
