import { Router } from 'express';
export const instagramRouter = Router();

instagramRouter.post("/login", async (req, res) => {
  try {
    const { loginToInstagram } = await import("../feedWorker/scraper/login");
    const result = await loginToInstagram();
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(401).json({ error: result.reason || "Falha ao realizar login no Instagram" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
