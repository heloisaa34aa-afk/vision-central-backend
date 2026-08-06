import { Router } from 'express';
export const apkRouter = Router();

apkRouter.post("/heartbeat", async (req, res) => {
  const { deviceId, token } = req.body;
  if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });
  
  try {
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
