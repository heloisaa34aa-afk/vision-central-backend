import webpush, { PushSubscription } from 'web-push';
import { supabase } from '../feedWorker/supabaseClient';

export interface AlertPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  type?: 'offline' | 'recovered' | 'test';
}

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY não configuradas.');
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return publicKey;
}

export function getVapidPublicKey() {
  return configureWebPush();
}

export async function saveSubscription(subscription: PushSubscription, userAgent?: string) {
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    throw new Error('Assinatura de notificação inválida.');
  }

  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    user_agent: userAgent || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });

  if (error) throw error;
}

export async function removeSubscription(endpoint: string) {
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;
}

export async function sendPush(payload: AlertPayload, onlyEndpoint?: string) {
  configureWebPush();

  let query = supabase.from('push_subscriptions').select('endpoint,p256dh,auth');
  if (onlyEndpoint) query = query.eq('endpoint', onlyEndpoint);
  const { data, error } = await query;
  if (error) throw error;

  const serialized = JSON.stringify({ url: '/', ...payload });
  let delivered = 0;

  for (const item of data || []) {
    try {
      await webpush.sendNotification({
        endpoint: item.endpoint,
        keys: { p256dh: item.p256dh, auth: item.auth },
      }, serialized);
      delivered += 1;
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', item.endpoint);
      } else {
        console.error('[Alerts] Falha ao enviar notificação:', error?.message || error);
      }
    }
  }

  return delivered;
}
