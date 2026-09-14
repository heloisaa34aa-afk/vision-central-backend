import { Router } from 'express';
import { getVapidPublicKey, removeSubscription, saveSubscription, sendPush } from '../alerts/push';
import { supabase } from '../feedWorker/supabaseClient';
import { getRequester } from '../auth/requester';

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
    const requester = await getRequester(req);
    await saveSubscription(req.body?.subscription, req.get('user-agent'), { userId: requester.id, role: requester.role });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

alertsRouter.post('/unsubscribe', async (req, res) => {
  try {
    const requester = await getRequester(req);
    if (!req.body?.endpoint) return res.status(400).json({ error: 'Endpoint obrigatório.' });
    await removeSubscription(req.body.endpoint, requester.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

alertsRouter.post('/test', async (req, res) => {
  try {
    const requester = await getRequester(req);
    if (!req.body?.endpoint) return res.status(400).json({ error: 'Ative as notificações primeiro.' });
    const delivered = await sendPush({
      title: 'Vision Central',
      body: 'Notificações configuradas corretamente.',
      type: 'test',
      tag: 'vision-central-test',
    }, { onlyEndpoint: req.body.endpoint, onlyUserId: requester.id });
    res.json({ success: delivered > 0 });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

alertsRouter.get('/events', async (req, res) => {
  let requester;
  try {
    requester = await getRequester(req);
  } catch {
    return res.status(401).json({ error: 'Sessão inválida ou acesso não liberado.' });
  }
  let query = supabase
    .from('alert_events')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(100);
  if (requester.role !== 'admin') {
    const { data: ownedClients, error: clientError } = await supabase.from('clientes').select('id').eq('owner_user_id', requester.id);
    if (clientError) return res.status(500).json({ error: clientError.message });
    const clientIds = (ownedClients || []).map(client => client.id);
    if (clientIds.length === 0) return res.json([]);
    query = query.in('cliente_id', clientIds);
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});
