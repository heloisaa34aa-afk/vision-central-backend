import express from "express";
import dotenv from "dotenv";
import cors from "cors";

import { initWorker } from "./src/feedWorker/worker";
import { healthRouter } from "./src/routes/health";
import { instagramRouter } from "./src/routes/instagram";
import { feedRouter } from "./src/routes/feed";
import { apkRouter } from "./src/routes/apk";
import { geminiRouter } from "./src/routes/gemini";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Rota principal
app.get("/", (_req, res) => {
  res.json({
    status: "Vision Central Backend",
    online: true,
    version: "1.0.0",
  });
});

// Rotas da API
app.use("/api/health", healthRouter);
app.use("/api/instagram", instagramRouter);
app.use("/api/feed", feedRouter);
app.use("/api/apk", apkRouter);
app.use("/api/gemini", geminiRouter);

// Iniciar servidor
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Backend] Server running on port ${PORT}`);

  // Iniciar o worker do feed
  initWorker();
});
