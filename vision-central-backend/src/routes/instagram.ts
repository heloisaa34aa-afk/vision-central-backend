import { Router } from 'express';
import { instagramGraph } from '../feedWorker/instagramGraph';
export const instagramRouter = Router();

instagramRouter.get('/status', async (_req, res) => {
  try {
    res.json(await instagramGraph.getStatus());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

instagramRouter.get('/connect', (_req, res) => {
  try {
    res.json({ authorizationUrl: instagramGraph.getAuthorizationUrl() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

instagramRouter.get('/callback', async (req, res) => {
  const frontend = (process.env.FRONTEND_URL || '').split(',')[0].replace(/\/$/, '');
  try {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code || !state) throw new Error('O Instagram nao devolveu a autorizacao esperada.');
    const result = await instagramGraph.exchangeCode(code, state);
    res.redirect(`${frontend}/?instagram=connected&username=${encodeURIComponent(result.username)}`);
  } catch (err: any) {
    res.redirect(`${frontend}/?instagram=error&message=${encodeURIComponent(err.message)}`);
  }
});

// Compatibilidade com o botao antigo: devolve o link OAuth em vez de abrir
// um navegador invisivel no Render.
instagramRouter.post('/login', (_req, res) => {
  try {
    res.json({ success: true, authorizationUrl: instagramGraph.getAuthorizationUrl() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
