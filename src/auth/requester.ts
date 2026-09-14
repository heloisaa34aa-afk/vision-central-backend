import type { Request } from 'express';
import { supabase } from '../feedWorker/supabaseClient';

export interface Requester {
  id: string;
  email: string;
  role: 'admin' | 'client';
  status: 'pending' | 'active' | 'suspended';
  clienteId: string | null;
}

export async function getRequester(req: Request): Promise<Requester> {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new Error('AUTH_REQUIRED');

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) throw new Error('INVALID_SESSION');

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('role,status,cliente_id,email')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.status !== 'active') throw new Error('ACCESS_DENIED');

  return {
    id: userData.user.id,
    email: profile.email || userData.user.email || '',
    role: profile.role,
    status: profile.status,
    clienteId: profile.cliente_id || null,
  };
}
