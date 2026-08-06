import { createHmac, timingSafeEqual } from 'crypto';
import { supabase } from './supabaseClient';
import { decrypt, encrypt } from './scraper/crypto';
import { InstagramConnection } from '../types';

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH_URL = 'https://graph.instagram.com';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variavel ${name} nao configurada.`);
  return value;
}

function callbackUrl(): string {
  return `${requiredEnv('BACKEND_PUBLIC_URL').replace(/\/$/, '')}/api/instagram/callback`;
}

function encodeState(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', requiredEnv('SESSION_SECRET')).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function decodeState(state: string): { createdAt: number } {
  const [body, signature] = state.split('.');
  if (!body || !signature) throw new Error('Estado OAuth invalido.');
  const expected = createHmac('sha256', requiredEnv('SESSION_SECRET')).update(body).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('Estado OAuth invalido.');
  }
  const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!decoded.createdAt || Date.now() - decoded.createdAt > 10 * 60 * 1000) {
    throw new Error('O link de conexao expirou. Tente novamente.');
  }
  return decoded;
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.error_message || `Instagram respondeu ${response.status}`);
  return data;
}

export const instagramGraph = {
  getAuthorizationUrl(): string {
    const params = new URLSearchParams({
      client_id: requiredEnv('INSTAGRAM_APP_ID'),
      redirect_uri: callbackUrl(),
      response_type: 'code',
      scope: 'instagram_business_basic',
      enable_fb_login: '0',
      force_authentication: '1',
      state: encodeState({ createdAt: Date.now() }),
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchangeCode(code: string, state: string): Promise<{ username: string }> {
    decodeState(state);
    const form = new URLSearchParams({
      client_id: requiredEnv('INSTAGRAM_APP_ID'),
      client_secret: requiredEnv('INSTAGRAM_APP_SECRET'),
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl(),
      code: code.replace(/#_$/, ''),
    });
    const shortResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form,
    });
    const shortToken = await shortResponse.json().catch(() => ({}));
    if (!shortResponse.ok || !shortToken.access_token) {
      throw new Error(shortToken?.error_message || 'Nao foi possivel obter o token do Instagram.');
    }

    const longParams = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: requiredEnv('INSTAGRAM_APP_SECRET'),
      access_token: shortToken.access_token,
    });
    const longToken = await getJson(`${GRAPH_URL}/access_token?${longParams.toString()}`);
    const accessToken = longToken.access_token || shortToken.access_token;
    const profile = await getJson(`${GRAPH_URL}/me?fields=user_id,username,name&access_token=${encodeURIComponent(accessToken)}`);
    const instagramUserId = String(profile.user_id || profile.id || shortToken.user_id);
    const expiresAt = longToken.expires_in
      ? new Date(Date.now() + Number(longToken.expires_in) * 1000).toISOString()
      : null;

    const { error } = await supabase.from('instagram_connections').upsert({
      instagram_user_id: instagramUserId,
      username: profile.username,
      encrypted_access_token: encrypt(accessToken),
      token_expires_at: expiresAt,
      status: 'ACTIVE',
      last_used_at: new Date().toISOString(),
    }, { onConflict: 'instagram_user_id' });
    if (error) throw error;
    return { username: profile.username };
  },

  async getStatus(): Promise<{ connected: boolean; connectionId?: string; username?: string; expiresAt?: string | null }> {
    const { data } = await supabase
      .from('instagram_connections')
      .select('id,username,token_expires_at,status')
      .eq('status', 'ACTIVE')
      .order('last_used_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data
      ? { connected: true, connectionId: data.id, username: data.username, expiresAt: data.token_expires_at }
      : { connected: false };
  },

  async getLatestMedia(connectionId?: string | null): Promise<Array<{ id: string; type: 'image' | 'video'; mediaUrl: string; thumbnailUrl?: string }>> {
    let query = supabase.from('instagram_connections').select('*').eq('status', 'ACTIVE');
    if (connectionId) query = query.eq('id', connectionId);
    const { data, error } = await query.order('last_used_at', { ascending: false }).limit(1).maybeSingle();
    if (error || !data) throw new Error('Nenhuma conta profissional do Instagram esta conectada.');

    const connection = data as InstagramConnection;
    let token: string = decrypt(connection.encrypted_access_token) || '';
    if (!token) throw new Error('Nao foi possivel abrir o token do Instagram. Confira SESSION_ENCRYPTION_KEY.');
    const expiresSoon = !connection.token_expires_at || new Date(connection.token_expires_at).getTime() < Date.now() + 7 * 24 * 60 * 60 * 1000;
    if (expiresSoon) {
      const refreshParams = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token });
      const refreshed = await getJson(`${GRAPH_URL}/refresh_access_token?${refreshParams.toString()}`);
      if (refreshed.access_token) token = refreshed.access_token;
      await supabase.from('instagram_connections').update({
        encrypted_access_token: encrypt(token),
        token_expires_at: refreshed.expires_in
          ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString()
          : connection.token_expires_at,
        last_used_at: new Date().toISOString(),
      }).eq('id', connection.id);
    }
    const fields = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,children{media_type,media_url,thumbnail_url}';
    const response = await getJson(`${GRAPH_URL}/me/media?fields=${encodeURIComponent(fields)}&limit=1&access_token=${encodeURIComponent(token)}`);
    const latest = response?.data?.[0];
    if (!latest) return [];
    await supabase.from('instagram_connections').update({ last_used_at: new Date().toISOString() }).eq('id', connection.id);

    const children = latest.children?.data;
    const mediaItems = Array.isArray(children) && children.length > 0 ? children : [latest];
    return mediaItems
      .map((item: any, index: number) => ({
        id: `${latest.id}_${index}`,
        type: item.media_type === 'VIDEO' ? 'video' as const : 'image' as const,
        mediaUrl: item.media_url,
        thumbnailUrl: item.thumbnail_url,
      }))
      .filter((item: any) => Boolean(item.mediaUrl));
  },
};
