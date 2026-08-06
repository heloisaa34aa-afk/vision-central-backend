import { Router } from 'express';
import { getVapidPublicKey, removeSubscription, saveSubscription, sendPush } from '../alerts/push';
import { supabase } from '../feedWorker/supabaseClient';

export const alertsRouter = Router();

alertsRouter.get('/public-key', (_req, res) => {
  try {
    res.json({ publicKey: getVapidPublicKey() });
  } catch (error: any) {
    res.status(503).json({ error: error.message });
  }
});

alertsRouter.post('/subscribe', async (req, res) => {
  try {
    await saveSubscription(req.body?.subscription, req.get('user-agent'));
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

alertsRouter.post('/unsubscribe', async (req, res) => {
  try {
    if (!req.body?.endpoint) return res.status(400).json({ error: 'Endpoint obrigatório.' });
    await removeSubscription(req.body.endpoint);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

alertsRouter.post('/test', async (req, res) => {
  try {
    if (!req.body?.endpoint) return res.status(400).json({ error: 'Ative as notificações primeiro.' });
    const delivered = await sendPush({
      title: 'Vision Central',
      body: 'Notificações configuradas corretamente.',
      type: 'test',
      tag: 'vision-central-test',
    }, req.body.endpoint);
    res.json({ success: delivered > 0 });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

alertsRouter.get('/events', async (_req, res) => {
  const { data, error } = await supabase
    .from('alert_events')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});
