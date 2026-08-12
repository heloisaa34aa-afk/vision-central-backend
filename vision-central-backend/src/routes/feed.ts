import { Router } from 'express';
export const feedRouter = Router();

function validCronSecret(req: any): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const authorization = String(req.get('authorization') || '');
  const headerSecret = String(req.get('x-cron-secret') || '');
  return authorization === `Bearer ${expected}` || headerSecret === expected;
}

feedRouter.post('/run-due', async (req, res) => {
  if (!process.env.CRON_SECRET?.trim()) {
    return res.status(503).json({ error: 'CRON_SECRET nao configurado no backend.' });
  }
  if (!validCronSecret(req)) return res.status(401).json({ error: 'Nao autorizado.' });

  try {
    const { runDueSources } = await import('../feedWorker/scheduler');
    // A resposta e imediata para o agendador externo nao expirar enquanto o Chromium trabalha.
    void runDueSources('external-cron').catch(error => console.error('[Feed Cron]', error));
    return res.status(202).json({ success: true, message: 'Fila diaria iniciada.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

feedRouter.post("/sync/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const { syncFeedSource } = await import("../feedWorker/syncFeed");
    const { db } = await import("../feedWorker/database");
    
    const source = await db.getFeedSourceById(id);
    if (!source) {
      return res.status(404).json({ error: "Fonte de feed não encontrada" });
    }
    
    // Run sync in background so we don't block the request if it takes too long
    syncFeedSource(source).catch(e => console.error("Sync error:", e));
    
    res.json({ success: true, message: "Sincronização iniciada" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
