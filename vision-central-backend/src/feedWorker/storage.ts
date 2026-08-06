import { supabase } from './supabaseClient';

export const storage = {
  async uploadMedia(buffer: ArrayBuffer, fileName: string, contentType: string): Promise<string> {
    const { data, error } = await supabase.storage
      .from('midias')
      .upload(fileName, buffer, { contentType, upsert: true });
    
    if (error) throw error;
    
    const { data: publicUrlData } = supabase.storage
      .from('midias')
      .getPublicUrl(fileName);
      
    return publicUrlData.publicUrl;
  }
};
