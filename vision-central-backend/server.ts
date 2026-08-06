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
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/health", healthRouter);
app.use("/api/instagram", instagramRouter);
app.use("/api/feed", feedRouter);
app.use("/api/apk", apkRouter);
app.use("/api/gemini", geminiRouter);

// Start Server
app.get("/", (_, res) => {
  res.json({
    status: "Vision Central Backend",
    online: true,
    version: "1.0.0"
  });
});
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Backend] Server running on port ${PORT}`);
  
  // Start Feed Worker
  initWorker();
});
