import { Router } from 'express';
export const feedRouter = Router();

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
