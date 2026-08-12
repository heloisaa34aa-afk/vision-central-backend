import { supabase } from './supabaseClient';
import { deleteFromR2, isR2Configured, uploadToR2 } from '../storage/r2';

export const storage = {
  async uploadMedia(buffer: ArrayBuffer, fileName: string, contentType: string): Promise<string> {
    if (isR2Configured()) {
      return uploadToR2(buffer, fileName, contentType);
    }

    console.warn('[Storage] R2 nao configurado; usando Supabase Storage como fallback.');
    const { data, error } = await supabase.storage
      .from('midias')
      .upload(fileName, buffer, { contentType, upsert: true });
    
    if (error) throw error;
    
    const { data: publicUrlData } = supabase.storage
      .from('midias')
      .getPublicUrl(fileName);
      
    return publicUrlData.publicUrl;
  },

  async removeMedia(fileName?: string | null): Promise<void> {
    if (!fileName) return;
    if (isR2Configured()) {
      await deleteFromR2(fileName);
      return;
    }
    const { error } = await supabase.storage.from('midias').remove([fileName]);
    if (error) throw error;
  }
};
