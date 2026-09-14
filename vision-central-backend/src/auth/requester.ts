import type { Request } from 'express';
import { supabase } from '../feedWorker/supabaseClient';

export interface Requester {
  id: string;
  email: string;
  role: 'admin' | 'client';
  status: 'pending' | 'active' | 'suspended';
}

export async function getRequester(req: Request): Promise<Requester> {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new Error('AUTH_REQUIRED');

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) throw new Error('INVALID_SESSION');

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('role,status,email')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.status !== 'active') throw new Error('ACCESS_DENIED');

  if (profile.role !== 'admin') {
    const { data: plan, error: planError } = await supabase
      .from('account_subscriptions')
      .select('status,ends_at')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    const expired = Boolean(plan?.ends_at && new Date(plan.ends_at).getTime() < Date.now());
    if (planError || !plan || expired || !['trial', 'active'].includes(plan.status)) throw new Error('PLAN_INACTIVE');
  }

  return {
    id: userData.user.id,
    email: profile.email || userData.user.email || '',
    role: profile.role,
    status: profile.status,
  };
}
